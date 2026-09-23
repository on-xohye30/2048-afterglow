import { slide, spawn, createBoard, createRng, maxTile } from '../engine.js';

// Replay-validated, not bot-proof. Kakao tokens are used once and never persisted.
// Retention: OAuth 10m, sessions 14d, rate windows <=10m; scheduled cleanup removes
// expired credentials/buckets, runs older than 2d, scores older than 90d. Accounts
// persist until deletion. Leaving a room removes that member's scores and runs.
const DAY = 86400000;
const KST = 9 * 3600000;
const SESSION = '__Host-afterglow_session';
const STATE = '__Host-afterglow_oauth';
const ID = /^[A-Za-z0-9_-]{24,64}$/;
const DIRS = new Set(['left', 'right', 'up', 'down']);
const CSP = "default-src 'self'; script-src 'self' https://t1.kakaocdn.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.kakao.com https://*.kakao.co.kr; frame-src https://*.kakao.com; object-src 'none'; base-uri 'none'; form-action 'self' https://*.kakao.com; frame-ancestors 'none'";
class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new HttpError(status, code, message); };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
});
const random = (length = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const hash = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
};
const cookie = (name, value, age) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
function cookies(request) {
  const result = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) result[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return result;
}
function publicOrigin(env) {
  try {
    const url = new URL(env.PUBLIC_ORIGIN);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch { fail(503, 'CONFIG_REQUIRED', 'A valid HTTPS PUBLIC_ORIGIN is required.'); }
}
function authConfigured(env) {
  try { publicOrigin(env); return Boolean(env.KAKAO_APPROVED_FOR_GAME === 'true' && env.KAKAO_REST_API_KEY && env.KAKAO_CLIENT_SECRET && env.DB); }
  catch { return false; }
}
const kstDay = time => new Date(time + KST).toISOString().slice(0, 10);
function monday(day) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function dailySeed(day) {
  let seed = 2166136261;
  for (const c of 'afterglow-v1:' + day) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
  return seed >>> 0;
}
function text(value, min, max, label) {
  if (typeof value !== 'string') fail(400, 'INVALID_INPUT', `${label} must be plain text.`);
  const clean = value.normalize('NFC').trim();
  const length = Array.from(clean).length;
  if (length < min || length > max || /[<>\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(clean))
    fail(400, 'INVALID_INPUT', `${label} must contain ${min}-${max} plain-text characters.`);
  return clean;
}
async function body(request, keys) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || ''))
    fail(415, 'JSON_REQUIRED', 'Use application/json.');
  const length = request.headers.get('Content-Length');
  if (length && Number(length) > 131072) fail(413, 'BODY_TOO_LARGE', 'Request body exceeds 128KB.');
  if (!request.body) fail(400, 'INVALID_JSON', 'A JSON object is required.');
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 131072) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE', 'Request body exceeds 128KB.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(400, 'INVALID_JSON', 'A valid JSON object is required.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      Object.keys(parsed).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(parsed, key)))
    fail(400, 'INVALID_INPUT', 'Unexpected or missing request fields.');
  return parsed;
}
async function noBody(request) {
  if (!request.body) return;
  // Empty-object bodies are allowed for clients using a generic JSON API helper.
  await body(request, []);
}
const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
function guardedError(error) {
  if (error instanceof HttpError) return error;
  const message = String(error?.message || '');
  for (const [needle, code, description] of [
    ['room_capacity', 'ROOM_FULL', 'This room already has 30 members.'],
    ['owner_capacity', 'ROOM_LIMIT', 'You can create at most five owned rooms.'],
    ['run_capacity', 'RUN_LIMIT', 'You already have 100 active runs today.'],
    ['rate_capacity', 'RATE_LIMITED', 'Please try again later.'],
  ]) if (message.includes(needle)) return new HttpError(code === 'RATE_LIMITED' || code === 'RUN_LIMIT' ? 429 : 409, code, description);
  return new HttpError(500, 'INTERNAL_ERROR', 'The request could not be completed.');
}
function secure(response, api) {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (api) { headers.set('Cache-Control', 'no-store'); headers.set('Pragma', 'no-cache'); }
  headers.delete('Access-Control-Allow-Origin');
  headers.delete('Access-Control-Allow-Credentials');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Inject only HTTP/time for tests; there is deliberately no authentication bypass. */
export function createWorker({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  async function limit(db, scope, subject, maximum, window = 600000) {
    const time = now();
    const key = scope + ':' + await hash(subject);
    // Reclaim expired rows before enforcing a hard 10,000-subject bound.
    await stmt(db, 'DELETE FROM rate_buckets WHERE expires_at <= ?', time).run();
    const row = await stmt(db, `INSERT INTO rate_buckets(key,hits,expires_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET hits=rate_buckets.hits+1
      WHERE rate_buckets.hits < ? RETURNING hits`, key, time + window, maximum).first();
    if (!row) fail(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
  }
  async function session(request, db, required = true) {
    const token = cookies(request)[SESSION];
    if (!token || !ID.test(token)) {
      if (required) fail(401, 'AUTH_REQUIRED', 'Sign in with Kakao first.');
      return null;
    }
    const tokenHash = await hash(token);
    const row = await stmt(db, `SELECT s.user_id AS id,u.nickname FROM sessions s
      JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`, tokenHash, now()).first();
    if (!row) {
      if (required) fail(401, 'AUTH_REQUIRED', 'Your session has expired. Sign in again.');
      return null;
    }
    return { ...row, tokenHash, csrfToken: await hash('csrf:' + token) };
  }
  async function room(db, id) {
    const row = await stmt(db, `SELECT r.id,r.name,r.owner_id AS ownerId,
      (SELECT COUNT(*) FROM memberships WHERE room_id=r.id) AS memberCount FROM rooms r WHERE r.id=?`, id).first();
    if (!row) fail(404, 'ROOM_NOT_FOUND', 'Room not found.');
    return row;
  }
  async function member(db, roomId, userId) {
    const row = await stmt(db, 'SELECT 1 AS ok FROM memberships WHERE room_id=? AND user_id=?', roomId, userId).first();
    if (!row) fail(403, 'MEMBERSHIP_REQUIRED', 'Only room members can access this.');
  }
  async function kakaoJSON(url, options) {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Kakao request failed');
    return response.json();
  }
  async function oauth(request, env, url, callback) {
    if (env.KAKAO_APPROVED_FOR_GAME !== 'true') fail(503, 'KAKAO_APPROVAL_REQUIRED', 'Game services require prior Kakao approval.');
    if (!authConfigured(env)) fail(503, 'AUTH_NOT_CONFIGURED', 'Kakao sign-in is not configured.');
    const origin = publicOrigin(env), db = env.DB;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    await limit(db, callback ? 'auth-callback' : 'auth-start', ip, callback ? 40 : 20);
    const redirectUri = origin + '/api/auth/kakao/callback';
    if (!callback) {
      const state = random();
      await stmt(db, 'DELETE FROM oauth_states WHERE expires_at <= ?', now()).run();
      const inserted = await stmt(db, `INSERT INTO oauth_states(state_hash,expires_at)
        SELECT ?,? WHERE (SELECT COUNT(*) FROM oauth_states)<10000 RETURNING state_hash`, await hash(state), now() + 600000).first();
      if (!inserted) fail(429, 'RATE_LIMITED', 'Please try again later.');
      const target = new URL('https://kauth.kakao.com/oauth/authorize');
      target.search = new URLSearchParams({ client_id: env.KAKAO_REST_API_KEY, redirect_uri: redirectUri,
        response_type: 'code', scope: 'profile_nickname', state }).toString();
      return new Response(null, { status: 302, headers: { Location: target.href, 'Set-Cookie': cookie(STATE, state, 600) } });
    }
    const headers = new Headers({ Location: origin + '/?league=1' });
    headers.append('Set-Cookie', cookie(STATE, '', 0));
    try {
      const state = url.searchParams.get('state'), saved = cookies(request)[STATE];
      if (!state || !ID.test(state) || !equal(state, saved)) throw new Error();
      const consumed = await stmt(db, 'DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING state_hash', await hash(state), now()).first();
      if (!consumed || url.searchParams.has('error')) throw new Error();
      const code = url.searchParams.get('code');
      if (!code || code.length > 4096) throw new Error();
      const token = await kakaoJSON('https://kauth.kakao.com/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: env.KAKAO_REST_API_KEY,
          client_secret: env.KAKAO_CLIENT_SECRET, redirect_uri: redirectUri, code }),
      });
      if (typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 8192) throw new Error();
      const profile = await kakaoJSON('https://kapi.kakao.com/v2/user/me', {
        headers: { Authorization: 'Bearer ' + token.access_token },
      });
      // Kakao IDs must remain exact; refuse unsafe JSON numeric IDs instead of rounding.
      if (!(typeof profile.id === 'string' && /^\d{1,32}$/.test(profile.id)) &&
          !(Number.isSafeInteger(profile.id) && profile.id > 0)) throw new Error();
      let nickname = 'Kakao player';
      try { nickname = text(profile.kakao_account?.profile?.nickname ?? profile.properties?.nickname, 2, 16, 'Nickname'); } catch { /* Safe minimal fallback. */ }
      const userId = random(18), opaque = random();
      const result = await db.batch([
        stmt(db, `INSERT INTO users(id,kakao_id,nickname,created_at) VALUES (?,?,?,?)
          ON CONFLICT(kakao_id) DO NOTHING`, userId, String(profile.id), nickname, now()),
        stmt(db, `INSERT INTO sessions(token_hash,user_id,created_at,expires_at)
          SELECT ?,id,?,? FROM users WHERE kakao_id=?`, await hash(opaque), now(), now() + 14 * DAY, String(profile.id)),
      ]);
      if (!result[1]?.meta?.changes) throw new Error();
      headers.append('Set-Cookie', cookie(SESSION, opaque, 14 * 86400));
    } catch {
      // Never expose authorization codes, provider payloads, IDs or access tokens.
      headers.set('Location', origin + '/?league=1&authError=oauth_failed');
    }
    return new Response(null, { status: 302, headers });
  }
  async function route(request, env) {
    const url = new URL(request.url), p = url.pathname, method = request.method;
    if (!p.startsWith('/api/') && p !== '/api') {
      if (!['GET', 'HEAD'].includes(method)) fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    if (p === '/api/config' && method === 'GET') return json({ enabled: true, authConfigured: authConfigured(env),
      kakaoApprovalRequired: env.KAKAO_APPROVED_FOR_GAME !== 'true', kakaoJavascriptKey: env.KAKAO_APPROVED_FOR_GAME === 'true' ? env.KAKAO_JS_KEY || '' : '', maxRoomMembers: 30 });
    if (!env.DB) fail(503, 'DATABASE_NOT_CONFIGURED', 'The league database is not configured.');
    const db = env.DB;
    const routes = [
      [/^\/api\/config$/, ['GET']], [/^\/api\/me$/, ['GET', 'PATCH', 'DELETE']],
      [/^\/api\/auth\/kakao(?:\/callback)?$/, ['GET']], [/^\/api\/logout$/, ['POST']],
      [/^\/api\/rooms$/, ['POST']], [/^\/api\/invites\/[A-Za-z0-9_-]+$/, ['GET']],
      [/^\/api\/rooms\/[A-Za-z0-9_-]+$/, ['GET']],
      [/^\/api\/rooms\/[A-Za-z0-9_-]+\/(?:join|leave|runs)$/, ['POST']],
      [/^\/api\/runs\/[A-Za-z0-9_-]+\/submit$/, ['POST']],
    ];
    const matched = routes.find(([pattern]) => pattern.test(p));
    if (!matched) fail(404, 'NOT_FOUND', 'Endpoint not found.');
    if (!matched[1].includes(method)) fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    if (p.startsWith('/api/auth/kakao')) return oauth(request, env, url, p.endsWith('/callback'));
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (mutation) {
      const origin = publicOrigin(env);
      if (url.origin !== origin || request.headers.get('Origin') !== origin ||
          ['cross-site', 'same-site'].includes(request.headers.get('Sec-Fetch-Site')))
        fail(403, 'ORIGIN_REJECTED', 'Use the same-origin app to make changes.');
    }
    if (p.startsWith('/api/invites/')) {
      await limit(db, 'invite', request.headers.get('CF-Connecting-IP') || 'unknown', 120, 60000);
      const r = await room(db, p.split('/')[3]);
      return json({ name: r.name, memberCount: r.memberCount });
    }
    const user = await session(request, db, !(p === '/api/me' && method === 'GET'));
    if (!user) return json({ user: null });
    if (mutation) {
      if (!equal(request.headers.get('X-CSRF-Token'), user.csrfToken)) fail(403, 'CSRF_REJECTED', 'Refresh the app and try again.');
      await limit(db, 'mutation', user.id, 120, 60000);
    }
    if (p === '/api/me') {
      if (method === 'GET') {
        const list = await stmt(db, `SELECT r.id,r.name,r.owner_id AS ownerId,
          (SELECT COUNT(*) FROM memberships WHERE room_id=r.id) AS memberCount
          FROM memberships m JOIN rooms r ON r.id=m.room_id WHERE m.user_id=? ORDER BY r.created_at,r.id`, user.id).all();
        return json({ user: { id: user.id, nickname: user.nickname }, csrfToken: user.csrfToken, rooms: list.results });
      }
      if (method === 'PATCH') {
        const input = await body(request, ['nickname']);
        const nickname = text(input.nickname, 2, 16, 'Nickname');
        await stmt(db, 'UPDATE users SET nickname=? WHERE id=?', nickname, user.id).run();
        return json({ user: { id: user.id, nickname } });
      }
      await noBody(request);
      await db.batch([
        stmt(db, `DELETE FROM rooms WHERE owner_id=? AND NOT EXISTS
          (SELECT 1 FROM memberships WHERE room_id=rooms.id AND user_id<>?)`, user.id, user.id),
        stmt(db, `UPDATE rooms SET owner_id=(SELECT user_id FROM memberships
          WHERE room_id=rooms.id AND user_id<>? ORDER BY joined_at,user_id LIMIT 1) WHERE owner_id=?`, user.id, user.id),
        stmt(db, 'DELETE FROM users WHERE id=?', user.id),
      ]);
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(SESSION, '', 0) });
    }
    if (p === '/api/logout') {
      await noBody(request);
      await stmt(db, 'DELETE FROM sessions WHERE token_hash=?', user.tokenHash).run();
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(SESSION, '', 0) });
    }
    if (p === '/api/rooms') {
      await limit(db, 'rooms', user.id, 30);
      const input = await body(request, ['name']), name = text(input.name, 2, 24, 'Room name'), id = random(18);
      await db.batch([stmt(db, 'INSERT INTO rooms(id,name,owner_id,created_at) VALUES (?,?,?,?)', id, name, user.id, now()),
        stmt(db, 'INSERT INTO memberships(room_id,user_id,joined_at) VALUES (?,?,?)', id, user.id, now())]);
      return json({ room: await room(db, id) });
    }
    const parts = p.split('/'), id = parts[3], action = parts[4];
    if (parts[2] === 'rooms') {
      if (action === 'join') {
        await noBody(request); await limit(db, 'rooms', user.id, 30);
        await room(db, id);
        await stmt(db, 'INSERT INTO memberships(room_id,user_id,joined_at) VALUES (?,?,?) ON CONFLICT DO NOTHING', id, user.id, now()).run();
        return json({ room: await room(db, id) });
      }
      await member(db, id, user.id);
      if (action === 'leave') {
        await noBody(request); await limit(db, 'rooms', user.id, 30);
        await db.batch([
          stmt(db, `UPDATE rooms SET owner_id=(SELECT user_id FROM memberships WHERE room_id=? AND user_id<>?
            ORDER BY joined_at,user_id LIMIT 1) WHERE id=? AND owner_id=?
            AND EXISTS(SELECT 1 FROM memberships WHERE room_id=? AND user_id<>?)`, id, user.id, id, user.id, id, user.id),
          stmt(db, 'DELETE FROM rooms WHERE id=? AND owner_id=?', id, user.id),
          stmt(db, 'DELETE FROM memberships WHERE room_id=? AND user_id=?', id, user.id),
        ]);
        return json({ ok: true });
      }
      if (action === 'runs') {
        await noBody(request); await limit(db, 'runs', user.id, 120);
        const createdAt = now(), day = kstDay(createdAt), seed = dailySeed(day), runId = random(18);
        const expires = Math.min(createdAt + DAY, Date.parse(day + 'T00:00:00Z') - KST + DAY);
        await stmt(db, 'INSERT INTO runs(id,room_id,user_id,day,seed,created_at,expires_at) VALUES (?,?,?,?,?,?,?)',
          runId, id, user.id, day, seed, createdAt, expires).run();
        return json({ run: { id: runId, roomId: id, day, seed, userId: user.id, createdAt } });
      }
      const period = url.searchParams.get('period') || 'daily';
      if (!['daily', 'weekly'].includes(period)) fail(400, 'INVALID_PERIOD', 'Period must be daily or weekly.');
      const day = kstDay(now());
      const rows = await stmt(db, `SELECT s.user_id AS userId,u.nickname,SUM(s.score) AS score,
        MAX(s.max_tile) AS maxTile,SUM(s.moves) AS moves,COUNT(*) AS days,MAX(s.submitted_at) AS submittedAt
        FROM scores s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.room_id=s.room_id AND m.user_id=s.user_id
        WHERE s.room_id=? AND s.day>=? AND s.day<=? GROUP BY s.user_id
        ORDER BY score DESC,maxTile DESC,moves ASC,submittedAt ASC,s.user_id ASC`, id, period === 'weekly' ? monday(day) : day, day).all();
      const entries = rows.results.map((r, i) => ({ rank: i + 1, userId: r.userId, nickname: r.nickname,
        score: r.score, maxTile: r.maxTile, moves: r.moves, ...(period === 'weekly' ? { days: r.days } : {}) }));
      return json({ room: await room(db, id), day, period, entries, myRank: entries.find(e => e.userId === user.id)?.rank ?? null });
    }
    // Validate an entire attempt before making either of the transactional writes.
    const input = await body(request, ['moves']);
    if (!Array.isArray(input.moves) || input.moves.length < 1 || input.moves.length > 10000 || input.moves.some(m => !DIRS.has(m)))
      fail(400, 'INVALID_MOVES', 'Provide 1-10000 valid directions.');
    await limit(db, 'submit', user.id, 60, 60000);
    const run = await stmt(db, 'SELECT * FROM runs WHERE id=?', id).first();
    if (!run || run.user_id !== user.id) fail(404, 'RUN_NOT_FOUND', 'Run not found.');
    await member(db, run.room_id, user.id);
    if (run.submitted_at !== null) fail(409, 'RUN_SUBMITTED', 'This run has already been submitted.');
    const time = now();
    if (run.expires_at <= time || run.day !== kstDay(time)) fail(410, 'RUN_EXPIRED', 'This run has expired. Start today’s run.');
    const rng = createRng(run.seed); let board = createBoard(4, rng), score = 0;
    for (const direction of input.moves) {
      const result = slide(board, direction);
      if (!result.changed) fail(400, 'INVALID_REPLAY', 'The replay contains a move that did not change the board.');
      score += result.scoreGain; board = spawn(result.board, rng).board;
    }
    const tile = maxTile(board), count = input.moves.length, nonce = random(18);
    // Unique per-submit nonce prevents a concurrent/retried caller from updating
    // the score after losing the submitted flag compare-and-swap. D1 batch is atomic.
    const result = await db.batch([
      stmt(db, `UPDATE runs SET submitted_at=?,submit_nonce=?,score=?,max_tile=?,moves=?
        WHERE id=? AND user_id=? AND submitted_at IS NULL AND expires_at>? AND day=?
        AND EXISTS(SELECT 1 FROM memberships WHERE room_id=runs.room_id AND user_id=runs.user_id) RETURNING id`,
        time, nonce, score, tile, count, id, user.id, time, kstDay(time)),
      stmt(db, `INSERT INTO scores(room_id,user_id,day,score,max_tile,moves,submitted_at)
        SELECT room_id,user_id,day,score,max_tile,moves,submitted_at FROM runs WHERE id=? AND submit_nonce=?
        ON CONFLICT(room_id,user_id,day) DO UPDATE SET score=excluded.score,max_tile=excluded.max_tile,
          moves=excluded.moves,submitted_at=excluded.submitted_at
        WHERE excluded.score>scores.score OR (excluded.score=scores.score AND excluded.max_tile>scores.max_tile)
          OR (excluded.score=scores.score AND excluded.max_tile=scores.max_tile AND excluded.moves<scores.moves)
        RETURNING score`, id, nonce),
    ]);
    if (!result[0].results?.length) fail(409, 'RUN_UNAVAILABLE', 'This run is no longer available.');
    return json({ result: { score, maxTile: tile, moves: count, personalBest: Boolean(result[1].results?.length), day: run.day }, roomId: run.room_id });
  }
  return {
    async fetch(request, env) {
      const api = new URL(request.url).pathname.startsWith('/api');
      try { return secure(await route(request, env), api); }
      catch (error) {
        const e = guardedError(error);
        return secure(json({ error: { code: e.code, message: e.message } }, e.status,
          e.status === 429 ? { 'Retry-After': '60' } : {}), api);
      }
    },
    async scheduled(_controller, env) {
      if (!env.DB) return;
      const time = now();
      await env.DB.batch([
        stmt(env.DB, 'DELETE FROM oauth_states WHERE expires_at<=?', time),
        stmt(env.DB, 'DELETE FROM sessions WHERE expires_at<=?', time),
        stmt(env.DB, 'DELETE FROM rate_buckets WHERE expires_at<=?', time),
        stmt(env.DB, 'DELETE FROM runs WHERE created_at<?', time - 2 * DAY),
        stmt(env.DB, 'DELETE FROM scores WHERE day<?', kstDay(time - 90 * DAY)),
      ]);
    },
  };
}
export default createWorker();
