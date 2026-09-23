import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as shared from './shared-game.js';
import * as engine from './engine.js';
import * as ranked from './league-game.js';
import { shareRecord, modeLabel } from './ui-model.js';

const { SHARED_GAME_PREFIX, resolveSharedLaunch, sharedHistoryState, sharedGameKey, readSharedGame, writeSharedGame } = shared;
const TODAY = '2026-09-23';
const ROOT = 'https://example.test/game/';
const STORE = 'afterglow2048:v1';
const GAME = STORE + ':game:';
const ID1 = '1'.repeat(32), ID2 = '2'.repeat(32);
const launch = (query = '?play=1&mode=classic', extra = {}) => resolveSharedLaunch({ href: ROOT + query, today: TODAY, createId: () => ID1, ...extra });
const json = value => JSON.parse(JSON.stringify(value));
const gameState = (score = 128, size = 4) => ({ board: [2, 2, ...Array(size * size - 2).fill(0)], score, moves: 7, seed: 123, history: [], undoUsed: 0, streak: 0, bestStreak: 0, won: false, continued: false, over: false });
class Storage {
  constructor(entries = {}) {
    Object.defineProperty(this, 'removed', { value: [] });
    for (const [key, value] of Object.entries(entries)) this.setItem(key, value);
  }
  get length() { return Object.keys(this).length; }
  key(index) { return Object.keys(this)[index] ?? null; }
  getItem(key) { return Object.hasOwn(this, key) ? this[key] : null; }
  setItem(key, value) { this[key] = String(value); }
  removeItem(key) { this.removed.push(key); delete this[key]; }
}

for (const query of ['?play=1', '?play=1&mode=classic', '?play=1&mode=daily&date=2026-09-22', '?play=1&mode=zen', '?mode=classic', '?mode=daily&date=2026-09-22', '?mode=zen', '?mode=league&date=2026-09-22']) {
  test(`fresh navigation never inherits an old round: ${query}`, () => {
    const first = launch(query);
    const storage = new Storage();
    writeSharedGame(storage, first, first.mode, first.day, gameState());
    const next = launch(query, { navigationType: 'navigate', historyState: sharedHistoryState(null, first), createId: () => ID2 });
    assert.equal(next.id, ID2);
    assert.equal(next.restoring, false);
    assert.equal(readSharedGame(storage, next, next.mode, next.day), null);
    assert.deepEqual(readSharedGame(storage, first, first.mode, first.day), gameState());
  });
}
for (const navigationType of ['reload', 'back_forward']) {
  for (const query of ['?play=1&mode=classic', '?mode=daily&date=2026-09-22', '?play=1&mode=zen']) {
    test(`${navigationType} restores only matching history: ${query}`, () => {
      const first = launch(query), storage = new Storage();
      writeSharedGame(storage, first, first.mode, first.day, gameState());
      const next = launch(query, { navigationType, historyState: sharedHistoryState({ unrelated: 7 }, first), createId: () => { throw new Error('must reuse ID'); } });
      assert.equal(next.id, first.id);
      assert.equal(next.restoring, true);
      assert.deepEqual(readSharedGame(storage, next, next.mode, next.day), gameState());
    });
  }
  test(`${navigationType} cannot restore a different daily puzzle even with the same mode`, () => {
    const previous = launch('?mode=daily&date=2026-09-22');
    const result = launch('?mode=daily&date=2026-09-23', { navigationType, historyState: sharedHistoryState(null, previous), createId: () => ID2 });
    assert.equal(result.id, ID2); assert.equal(result.restoring, false);
  });
  for (const previous of [null, {}, { id: ID1, signature: 'zen:any' }, { id: ID1, signature: 'daily:2026-09-22' }, { id: 'bad', signature: 'classic:any' }, { id: 'A'.repeat(32), signature: 'classic:any' }]) {
    test(`${navigationType} rejects missing, invalid or mismatched history ${JSON.stringify(previous)}`, () => {
      const result = launch('?play=1&mode=classic', { navigationType, historyState: { plusplusShare: previous }, createId: () => ID2 });
      assert.equal(result.id, ID2);
      assert.equal(result.restoring, false);
    });
  }
}
for (const query of ['', '?utm_source=friend', '?date=2026-09-22', '?mode=unknown', '?play=0', '?room=secret', '?league=1', '?room=&play=1&mode=daily', '?league=&mode=classic', '?play=1&mode=zen&room=private', '?play=1&mode=league&league=1']) {
  test(`normal and invitation URLs are not shared scopes: ${query || '(normal)'}`, () => {
    assert.equal(launch(query, { createId: () => { throw new Error('must not allocate shared ID'); }, historyState: { plusplusShare: { id: ID1, signature: 'classic:any' } }, navigationType: 'reload' }), null);
  });
}
test('public league score links resolve to a daily puzzle, not a ranked game', () => {
  for (const prefix of ['?mode=league', '?play=1&mode=league']) {
    const result = launch(prefix + '&date=2026-09-22');
    assert.equal(result.mode, 'daily'); assert.equal(result.day, '2026-09-22'); assert.equal(result.pinnedDay, '2026-09-22');
  }
});
test('explicit play with unknown or absent mode defaults safely to classic', () => {
  for (const query of ['?play=1', '?play=1&mode=bogus', '?play=1&mode=__proto__']) assert.equal(launch(query).mode, 'classic');
});
for (const date of ['2026-09-23', '2026-09-22', '2024-02-29', '2000-02-29']) {
  test(`valid historical daily date is pinned: ${date}`, () => {
    const result = launch('?mode=daily&date=' + date);
    assert.equal(result.day, date); assert.equal(result.pinnedDay, date); assert.equal(result.signature, 'daily:' + date);
  });
}
for (const date of ['', 'tomorrow', '2026-9-2', '2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-09-00', '2026-09-31', '2026-09-24', '1900-02-29', '2026-09-23T00:00:00Z', ' 2026-09-22']) {
  test(`invalid/future daily date falls back to today: ${JSON.stringify(date)}`, () => {
    const result = launch('?mode=daily&date=' + encodeURIComponent(date));
    assert.equal(result.day, TODAY); assert.equal(result.pinnedDay, null);
  });
}
test('classic and zen ignore date parameters and retain mode-only signatures', () => {
  for (const mode of ['classic', 'zen']) {
    const result = launch('?mode=' + mode + '&date=2026-09-22');
    assert.equal(result.day, TODAY); assert.equal(result.pinnedDay, null); assert.equal(result.signature, mode + ':any');
  }
});
test('each navigation allocates an independent ID and preserves unrelated history properties', () => {
  let count = 0; const previous = { route: { scroll: 120 }, userFlag: true, plusplusShare: { id: ID1, signature: 'classic:any' } };
  const original = json(previous), ids = [];
  for (let i = 0; i < 5; i++) {
    const result = launch('?play=1', { historyState: previous, createId: () => (++count).toString(16).padStart(32, '0') });
    ids.push(result.id);
    const next = sharedHistoryState(previous, result);
    assert.equal(next.route, previous.route); assert.equal(next.userFlag, true); assert.deepEqual(next.plusplusShare, { id: result.id, signature: result.signature });
  }
  assert.equal(new Set(ids).size, 5); assert.deepEqual(previous, original);
  assert.deepEqual(sharedHistoryState(previous, null), { route: { scroll: 120 }, userFlag: true });
});
test('history helper tolerates non-object history states and removes only its own property', () => {
  for (const previous of [null, undefined, 5, 'text', []]) {
    assert.deepEqual(sharedHistoryState(previous, null), {});
    assert.deepEqual(sharedHistoryState(previous, launch()).plusplusShare, { id: ID1, signature: 'classic:any' });
  }
});
test('invalid generated IDs fail before a storage key is accepted', () => {
  for (const id of ['', 'unsafe/key', 'g'.repeat(32), 'a'.repeat(31), 'a'.repeat(33)]) assert.throws(() => launch('?play=1', { createId: () => id }), TypeError);
});
test('shared state round-trips without consulting or modifying normal saves', () => {
  const normal = Object.fromEntries(['classic', 'daily', 'daily:' + TODAY, 'zen', 'league'].map(mode => [GAME + mode, 'original-' + mode]));
  const storage = new Storage(normal), round = launch();
  assert.equal(readSharedGame(storage, round, 'classic', TODAY), null);
  writeSharedGame(storage, round, 'classic', TODAY, gameState(), 42);
  assert.deepEqual(readSharedGame(storage, round, 'classic', TODAY), gameState());
  assert.deepEqual(JSON.parse(storage.getItem(sharedGameKey(round))), { version: 1, mode: 'classic', day: TODAY, state: gameState(), updatedAt: 42 });
  for (const [key, value] of Object.entries(normal)) assert.equal(storage.getItem(key), value);
});
for (const raw of ['{bad', 'null', 'false', '[]', '{}', '"text"', '{"version":2,"mode":"classic","state":{}}', '{"version":1,"mode":"classic"}']) {
  test(`missing or corrupt storage fails closed: ${raw}`, () => {
    const round = launch(), storage = new Storage({ [sharedGameKey(round)]: raw });
    assert.equal(readSharedGame(storage, round, 'classic', TODAY), null);
  });
}
test('storage read errors safely fall back to a fresh game', () => {
  assert.equal(readSharedGame({ getItem() { throw new Error('blocked'); } }, launch(), 'classic', TODAY), null);
});
test('wrong-mode and wrong-daily-date envelopes never restore', () => {
  const round = launch('?mode=daily&date=2026-09-22'), storage = new Storage();
  for (const value of [{ version: 1, mode: 'classic', day: round.day, state: gameState() }, { version: 1, mode: 'daily', day: TODAY, state: gameState() }, { version: 1, mode: 'daily', state: gameState() }]) {
    storage.setItem(sharedGameKey(round), JSON.stringify(value));
    assert.equal(readSharedGame(storage, round, round.mode, round.day), null);
  }
});
test('cleanup retains at most eight shared saves, newest seven plus current, without touching unrelated keys', () => {
  const protectedEntries = { [STORE]: 'preferences', unrelated: 'keep', 'afterglow2048:v1:sharedish:key': 'keep', 'other:shared:key': 'keep', ...Object.fromEntries(['classic', 'daily', 'daily:' + TODAY, 'zen', 'league'].map(mode => [GAME + mode, 'original-' + mode])) };
  const storage = new Storage(protectedEntries);
  for (let i = 1; i <= 15; i++) {
    const round = { id: i.toString(16).padStart(32, '0') };
    writeSharedGame(storage, round, 'classic', TODAY, gameState(i), i);
    assert.ok(Object.keys(storage).filter(k => k.startsWith(SHARED_GAME_PREFIX)).length <= 8);
  }
  storage.setItem(SHARED_GAME_PREFIX + 'corrupt', '{');
  const current = { id: 'f'.repeat(32) };
  writeSharedGame(storage, current, 'zen', TODAY, gameState(999, 5), -1);
  const keys = Object.keys(storage).filter(k => k.startsWith(SHARED_GAME_PREFIX));
  assert.equal(keys.length, 8); assert.ok(keys.includes(sharedGameKey(current)));
  for (let i = 9; i <= 15; i++) assert.ok(keys.includes(SHARED_GAME_PREFIX + i.toString(16).padStart(32, '0')));
  for (const [key, value] of Object.entries(protectedEntries)) assert.equal(storage.getItem(key), value);
  assert.ok(storage.removed.every(key => key.startsWith(SHARED_GAME_PREFIX)));
});
for (const mode of ['classic', 'daily', 'zen', 'league']) {
  test(`shareRecord ${mode} emits play=1 and only public mode/date parameters`, () => {
    const record = { mode, day: '2026-09-22', score: 987654, moves: 76, highest: 1024, bestStreak: 4, board: [1024, 2] };
    const result = shareRecord(record, ROOT + '?room=private-room&league=1&token=private-token&userId=private-user&code=private-code&board=private-board&score=123&seed=private-seed&play=0#private-hash');
    const url = new URL(result.url), targetMode = mode === 'league' ? 'daily' : mode;
    assert.equal(url.origin + url.pathname, ROOT); assert.equal(url.hash, '');
    assert.equal(url.searchParams.get('play'), '1'); assert.equal(url.searchParams.get('mode'), targetMode);
    assert.deepEqual([...url.searchParams.keys()].sort(), (targetMode === 'daily' ? ['date', 'mode', 'play'] : ['mode', 'play']));
    assert.equal(url.searchParams.get('date'), targetMode === 'daily' ? record.day : null);
    assert.doesNotMatch(result.url, /private|987654|1024/);
    assert.equal(result.mode, modeLabel(mode)); assert.ok(result.text.endsWith(result.url));
    const round = resolveSharedLaunch({ href: result.url, today: TODAY, createId: () => ID1 });
    assert.equal(round.mode, targetMode); assert.equal(round.restoring, false);
  });
}

// Execute the real application in a small DOM/storage harness. No browser,
// network, league authentication, or source edits are needed for these checks.
const appSource = readFileSync(new URL('./app.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
class Element {
  constructor() {
    this.listeners = new Map(); this.style = { setProperty() {} }; this.dataset = {}; this.children = []; this.open = false;
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  addEventListener(type, callback) { this.listeners.set(type, [...(this.listeners.get(type) || []), callback]); }
  async fire(type, event = {}) { for (const callback of this.listeners.get(type) || []) await callback(event); }
  setAttribute() {} focus() {} append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  get childElementCount() { return this.children.length; }
  querySelector() { return null; }
  showModal() { this.open = true; } close() { this.open = false; }
}
function boot({ href = ROOT, storage = new Storage(), historyState = null, navigationType = 'navigate', today = TODAY } = {}) {
  const elements = new Map(), document = new Element(), window = new Element(), clock = { day: today };
  const get = selector => { if (!elements.has(selector)) elements.set(selector, new Element()); return elements.get(selector); };
  document.querySelector = selector => selector === 'dialog[open]' ? null : get(selector);
  document.querySelectorAll = () => []; document.createElement = () => new Element(); document.documentElement = new Element();
  document.getElementById = id => get('#' + id); document.dispatchEvent = () => {}; document.hidden = false;
  const location = { href }, history = { state: historyState, replaceState(next, _, url) { this.state = next; location.href = String(url); } };
  window.history = history;
  const context = vm.createContext({ ...engine, ...ranked, ...shared, modeLabel, shareRecord, URL, Intl: { DateTimeFormat: class { format() { return clock.day; } } }, Date, Uint8Array, Uint32Array, crypto: webcrypto, performance: { getEntriesByType: () => [{ type: navigationType }] }, localStorage: storage, location, window, document, matchMedia: () => ({ matches: true, addEventListener() {} }), navigator: {}, setTimeout: () => 1, clearTimeout() {}, CustomEvent: class { constructor(type) { this.type = type; } }, initLeague: options => { context.leagueOptions = options; } });
  vm.runInContext(appSource + '\n;globalThis.appTest = { selectMode, checkDay, move, persist, useLeagueState, get: () => ({mode,day,pinnedDay,sharedLaunch,state,saved}), setState: next => {state=next;} };', context);
  return { api: context.appTest, storage, location, history, clock, window, elements, get, league: context.leagueOptions };
}
const normalStorage = () => new Storage({ [STORE]: JSON.stringify({ mode: 'zen', games: {}, best: {} }), [GAME + 'classic']: JSON.stringify(gameState(100)), [GAME + 'daily:' + TODAY]: JSON.stringify(gameState(200)), [GAME + 'zen']: JSON.stringify(gameState(300, 5)), [GAME + 'league']: JSON.stringify(gameState(400)) });

test('app: shared startup and moves never overwrite any existing normal game slot or preferred mode', async () => {
  const storage = normalStorage(), before = Object.fromEntries(Object.entries(storage));
  const app = boot({ href: ROOT + '?play=1&mode=classic', storage });
  assert.equal(app.api.get().state.moves, 0);
  await app.api.move('left'); await app.api.move('down');
  for (const [key, value] of Object.entries(before)) if (key.startsWith(GAME)) assert.equal(storage.getItem(key), value);
  assert.equal(JSON.parse(storage.getItem(STORE)).mode, 'zen');
  assert.ok(readSharedGame(storage, app.api.get().sharedLaunch, 'classic', TODAY));
});
for (const navigationType of ['reload', 'back_forward']) {
  test(`app: linked-page ${navigationType} keeps the saved board and round ID`, () => {
    const first = boot({ href: ROOT + '?play=1&mode=daily&date=2026-09-22' });
    first.api.setState(gameState(444)); first.api.persist();
    const second = boot({ href: first.location.href, storage: first.storage, historyState: first.history.state, navigationType });
    assert.equal(second.api.get().state.score, 444);
    assert.equal(second.api.get().sharedLaunch.id, first.api.get().sharedLaunch.id);
    assert.equal(second.api.get().day, '2026-09-22');
  });
}
test('app: opening the same shared URL again creates a fresh board even with previous history state', () => {
  const first = boot({ href: ROOT + '?play=1&mode=classic' });
  first.api.setState(gameState(444)); first.api.persist();
  const second = boot({ href: first.location.href, storage: first.storage, historyState: first.history.state });
  assert.equal(second.api.get().state.score, 0); assert.notEqual(second.api.get().sharedLaunch.id, first.api.get().sharedLaunch.id);
});
for (const candidate of [{}, { ...gameState(), board: [2] }, { ...gameState(), board: Array(16).fill(3) }, { ...gameState(), score: -1 }, { ...gameState(), seed: -1 }, { ...gameState(), moves: '7' }]) {
  test(`app: corrupt shared board/state falls back without consuming normal save (${JSON.stringify(candidate)})`, () => {
    const round = launch(), storage = normalStorage();
    writeSharedGame(storage, round, 'classic', TODAY, candidate);
    const app = boot({ href: ROOT + '?play=1&mode=classic', storage, historyState: sharedHistoryState(null, round), navigationType: 'reload' });
    assert.equal(app.api.get().state.score, 0); assert.equal(app.api.get().state.moves, 0); assert.equal(JSON.parse(storage.getItem(GAME + 'classic')).score, 100);
  });
}
test('app: normal and other shared-tab storage events cannot replace a linked board', async () => {
  const storage = normalStorage(), first = boot({ href: ROOT + '?play=1&mode=classic', storage });
  first.api.setState(gameState(444)); first.api.persist();
  const second = boot({ href: ROOT + '?play=1&mode=classic', storage });
  second.api.setState(gameState(888)); second.api.persist();
  await first.window.fire('storage', { key: sharedGameKey(second.api.get().sharedLaunch), newValue: storage.getItem(sharedGameKey(second.api.get().sharedLaunch)) });
  storage.setItem(GAME + 'classic', JSON.stringify(gameState(999)));
  await first.window.fire('storage', { key: GAME + 'classic', newValue: storage.getItem(GAME + 'classic') });
  assert.equal(first.api.get().state.score, 444);
  assert.equal(second.api.get().state.score, 888);
});
test('app: normal tabs still synchronize normal saves and ignore shared saves', async () => {
  const storage = normalStorage(), app = boot({ storage });
  storage.setItem(GAME + 'zen', JSON.stringify(gameState(777, 5)));
  await app.window.fire('storage', { key: GAME + 'zen', newValue: storage.getItem(GAME + 'zen') });
  assert.equal(app.api.get().state.score, 777);
  await app.window.fire('storage', { key: SHARED_GAME_PREFIX + ID1, newValue: JSON.stringify(gameState(999)) });
  assert.equal(app.api.get().state.score, 777);
});
test('app: shared to normal mode restores the correct save and clears only share URL/history metadata', () => {
  const app = boot({ href: ROOT + '?play=1&mode=classic&utm_source=friend#section', storage: normalStorage(), historyState: { route: 123 } });
  app.api.setState(gameState(444)); app.api.persist(); const round = app.api.get().sharedLaunch;
  app.api.selectMode('zen');
  assert.equal(app.api.get().sharedLaunch, null); assert.equal(app.api.get().state.score, 300); assert.equal(app.api.get().mode, 'zen');
  assert.equal(app.location.href, ROOT + '?utm_source=friend#section'); assert.deepEqual(json(app.history.state), { route: 123 });
  assert.equal(readSharedGame(app.storage, round, 'classic', TODAY).score, 444);
  assert.equal(JSON.parse(app.storage.getItem(GAME + 'classic')).score, 100);
});
test('app: resume previous game exits a same-mode shared round without overwriting the normal game', async () => {
  const storage = normalStorage(); storage.setItem(STORE, JSON.stringify({ mode: 'classic', best: {} }));
  const app = boot({ href: ROOT + '?play=1&mode=classic', storage });
  app.api.setState(gameState(444));
  await app.get('#saved-game-resume').fire('click');
  assert.equal(app.api.get().sharedLaunch, null); assert.equal(app.api.get().state.score, 100); assert.equal(app.location.href, ROOT);
});
test('app: shared to league transition preserves shared and normal saves, clears shared history, and writes only the ranked slot', () => {
  const app = boot({ href: ROOT + '?play=1&mode=daily&date=2026-09-22', storage: normalStorage(), historyState: { route: 321 } });
  app.api.setState(gameState(444)); const round = app.api.get().sharedLaunch;
  app.league.startRun({ id: 'i'.repeat(24), roomId: 'r'.repeat(24), userId: 'u'.repeat(24), day: TODAY, seed: 123, createdAt: 1 });
  assert.equal(app.api.get().sharedLaunch, null); assert.equal(app.api.get().mode, 'league');
  assert.equal(app.location.href, ROOT); assert.deepEqual(json(app.history.state), { route: 321 });
  assert.equal(readSharedGame(app.storage, round, 'daily', '2026-09-22').score, 444);
  assert.equal(JSON.parse(app.storage.getItem(GAME + 'classic')).score, 100); assert.equal(JSON.parse(app.storage.getItem(GAME + 'daily:' + TODAY)).score, 200);
  assert.equal(JSON.parse(app.storage.getItem(GAME + 'league')).run.id, 'i'.repeat(24));
});
test('app: pinned historical linked puzzles do not roll over at midnight', () => {
  const app = boot({ href: ROOT + '?play=1&mode=daily&date=2026-09-22' });
  app.api.setState(gameState(444)); app.clock.day = '2026-09-24';
  assert.equal(app.api.checkDay(), false); assert.equal(app.api.get().day, '2026-09-22'); assert.equal(app.api.get().state.score, 444);
});
test('app: unpinned shared daily round retains new-day progress on refresh after midnight', () => {
  const first = boot({ href: ROOT + '?play=1&mode=daily' });
  first.clock.day = '2026-09-24'; assert.equal(first.api.checkDay(), true);
  first.api.setState(gameState(555)); first.api.persist();
  const second = boot({ href: first.location.href, storage: first.storage, historyState: first.history.state, navigationType: 'reload', today: '2026-09-24' });
  assert.equal(second.api.get().state.score, 555, 'history signature must follow an unpinned daily rollover so reload restores the active round');
});
