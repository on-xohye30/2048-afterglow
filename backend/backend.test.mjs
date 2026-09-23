import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createWorker } from './worker.mjs';
import { createRng, createBoard, slide, spawn, maxTile } from '../engine.js';

const ORIGIN = 'https://game.example';
const schema = readFileSync(new URL('./migrations/0001.sql', import.meta.url), 'utf8');
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(schema); }
  prepare(sql) {
    const make = args => ({
      bind: (...values) => make(values),
      execute: () => { const results=this.db.prepare(sql).all(...args); const changes=this.db.prepare('SELECT changes() AS n').get().n;return {results,meta:{changes}}; },
      first: async () => make(args).execute().results[0] ?? null,
      all: async () => make(args).execute(),
      run: async () => make(args).execute(),
    });
    return make([]);
  }
  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE');
    try {const results=statements.map(s=>s.execute());this.db.exec('COMMIT');return results;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
function fixture() {
  let time=Date.parse('2026-09-23T03:00:00Z');
  const db=new D1();
  const worker=createWorker({now:()=>time});
  const env={DB:db,PUBLIC_ORIGIN:ORIGIN,ASSETS:{fetch:async()=>new Response('static asset')}};
  function client(){
    const jar=new Map();let csrf;
    const req=async(path,{method='GET',data,headers={},withCSRF=true}={})=>{
      const h=new Headers(headers);if(jar.size)h.set('Cookie',Array.from(jar,([k,v])=>k+'='+v).join('; '));
      if(method!=='GET'){if(!h.has('Origin'))h.set('Origin',ORIGIN);if(withCSRF&&csrf)h.set('X-CSRF-Token',csrf);}
      if(data!==undefined)h.set('Content-Type','application/json');
      const response=await worker.fetch(new Request(ORIGIN+path,{method,headers:h,...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
      for(const entry of response.headers.getSetCookie()){const pair=entry.split(';')[0],at=pair.indexOf('=');const name=pair.slice(0,at),value=pair.slice(at+1);if(value)jar.set(name,value);else jar.delete(name);}
      let value=null;if(response.headers.get('Content-Type')?.includes('application/json'))value=await response.json();
      return {response,value,status:response.status};
    };
    return {req,login:async id=>{const connected=await req('/api/auth/nickname',{method:'POST',data:{nickname:'테스터'+id,consent:true}});assert.equal(connected.status,201);assert.ok(connected.response.headers.getSetCookie().some(cookie=>cookie.startsWith('__Host-afterglow_session=')&&cookie.includes('HttpOnly')&&cookie.includes('Secure')&&cookie.includes('SameSite=Lax')));const me=await req('/api/me');csrf=me.value.csrfToken;assert.ok(csrf);return me.value.user;}};
  }
  return {db,worker,env,client,setTime:value=>{time=Date.parse(value);},advance:ms=>{time+=ms;}};
}
async function setup(){const f=fixture(),a=f.client(),b=f.client(),outsider=f.client();const alice=await a.login(101),bob=await b.login(202);const made=await a.req('/api/rooms',{method:'POST',data:{name:'친구들의 방'}});assert.equal(made.status,200);const room=made.value.room;return {...f,a,b,outsider,alice,bob,room};}
function replay(seed,count=30){const rng=createRng(seed);let board=createBoard(4,rng),score=0;const moves=[];for(let i=0;i<count;i++){const dirs=['left','down','right','up'];let result,dir;for(let j=0;j<4;j++){dir=dirs[(i+j)%4];result=slide(board,dir);if(result.changed)break;}if(!result.changed)break;score+=result.scoreGain;board=spawn(result.board,rng).board;moves.push(dir);}return {moves,score,maxTile:maxTile(board)};}
async function run(c,room,count=30){const started=await c.req('/api/rooms/'+room+'/runs',{method:'POST',data:{}});assert.equal(started.status,200);const proof=replay(started.value.run.seed,count);const submitted=await c.req('/api/runs/'+started.value.run.id+'/submit',{method:'POST',data:{moves:proof.moves}});return {started,proof,submitted};}

test('config does not claim authentication when database or origin are missing',async()=>{const f=fixture();const r=await f.worker.fetch(new Request(ORIGIN+'/api/config'),{DB:f.db});assert.equal((await r.json()).authConfigured,false);const staticR=await f.worker.fetch(new Request(ORIGIN+'/'),f.env);assert.equal(staticR.headers.get('X-Content-Type-Options'),'nosniff');});
test('nickname entry requires consent, valid input and same origin',async()=>{const f=fixture(),c=f.client();assert.equal((await c.req('/api/auth/nickname',{method:'POST',data:{nickname:'테스터',consent:false}})).status,400);assert.equal((await c.req('/api/auth/nickname',{method:'POST',data:{nickname:'테스터',consent:true},headers:{Origin:'https://attacker.example'}})).status,403);assert.equal((await c.req('/api/auth/nickname',{method:'POST',data:{nickname:'<script>',consent:true}})).status,400);await c.login(101);assert.equal((await c.req('/api/auth/nickname',{method:'POST',data:{nickname:'다른계정',consent:true}})).status,409);});
test('nickname entry stores only hashed session and sets secure cookies',async()=>{const f=fixture(),c=f.client();await c.login(101);const row=f.db.db.prepare('SELECT token_hash FROM sessions').get();assert.match(row.token_hash,/^[a-f0-9]{64}$/);const me=await c.req('/api/me');assert.deepEqual(Object.keys(me.value.user).sort(),['id','nickname']);assert.equal(me.response.headers.get('Cache-Control'),'no-store');assert.equal(me.response.headers.get('Access-Control-Allow-Origin'),null);});
test('room membership protects all rankings and run creation',async()=>{const f=await setup();assert.equal((await f.outsider.req('/api/rooms/'+f.room.id)).status,401);assert.equal((await f.b.req('/api/rooms/'+f.room.id)).status,403);assert.equal((await f.b.req('/api/rooms/'+f.room.id+'/runs',{method:'POST',data:{}})).status,403);const invite=await f.outsider.req('/api/invites/'+f.room.id);assert.deepEqual(Object.keys(invite.value).sort(),['memberCount','name']);});
test('CSRF and same-origin checks reject unauthorized writes',async()=>{const f=await setup();assert.equal((await f.a.req('/api/rooms',{method:'POST',data:{name:'두번째 방'},withCSRF:false})).status,403);assert.equal((await f.a.req('/api/rooms',{method:'POST',data:{name:'두번째 방'},headers:{Origin:'https://attacker.example'}})).status,403);});
test('join is idempotent; two users can submit replay-validated scores',async()=>{const f=await setup();await f.b.req('/api/rooms/'+f.room.id+'/join',{method:'POST',data:{}});const joined=await f.b.req('/api/rooms/'+f.room.id+'/join',{method:'POST',data:{}});assert.equal(joined.value.room.memberCount,2);const ar=await run(f.a,f.room.id,35),br=await run(f.b,f.room.id,12);assert.equal(ar.submitted.status,200);assert.equal(ar.submitted.value.result.score,ar.proof.score);assert.equal(ar.submitted.value.result.maxTile,ar.proof.maxTile);assert.equal(br.submitted.status,200);const board=await f.b.req('/api/rooms/'+f.room.id+'?period=daily');assert.equal(board.value.entries.length,2);assert.ok(board.value.entries[0].score>=board.value.entries[1].score);assert.ok(board.value.myRank>0);});
test('score injection, unknown directions, no-op and empty traces are rejected',async()=>{const f=await setup();let r=await f.a.req('/api/rooms/'+f.room.id+'/runs',{method:'POST',data:{}});const endpoint='/api/runs/'+r.value.run.id+'/submit';for(const data of [{moves:[]},{moves:['hack']},{moves:['left'],score:999999},{moves:Array(10001).fill('left')}])assert.equal((await f.a.req(endpoint,{method:'POST',data})).status,400);assert.equal((await f.a.req(endpoint,{method:'POST',data:{moves:['left','left']}})).status,400);const proof=replay(r.value.run.seed,1);let b=createBoard(4,createRng(r.value.run.seed));const noOp=['left','right','up','down'].find(d=>!slide(b,d).changed);if(noOp)assert.equal((await f.a.req(endpoint,{method:'POST',data:{moves:[noOp]}})).status,400);assert.equal((await f.a.req(endpoint,{method:'POST',data:{moves:proof.moves}})).status,200);});
test('run ownership and duplicate submissions are enforced',async()=>{const f=await setup();await f.b.req('/api/rooms/'+f.room.id+'/join',{method:'POST',data:{}});const r=await f.a.req('/api/rooms/'+f.room.id+'/runs',{method:'POST',data:{}});const moves=replay(r.value.run.seed,5).moves;const endpoint='/api/runs/'+r.value.run.id+'/submit';assert.equal((await f.b.req(endpoint,{method:'POST',data:{moves}})).status,404);assert.equal((await f.a.req(endpoint,{method:'POST',data:{moves}})).status,200);assert.equal((await f.a.req(endpoint,{method:'POST',data:{moves}})).status,409);});
test('concurrent duplicate submit counts only once',async()=>{const f=await setup();const r=await f.a.req('/api/rooms/'+f.room.id+'/runs',{method:'POST',data:{}});const moves=replay(r.value.run.seed,4).moves;const results=await Promise.all([1,2].map(()=>f.a.req('/api/runs/'+r.value.run.id+'/submit',{method:'POST',data:{moves}})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(f.db.db.prepare('SELECT COUNT(*) n FROM scores').get().n,1);});
test('daily best is preserved and weekly score sums daily bests',async()=>{const f=await setup();const high=await run(f.a,f.room.id,40);await run(f.a,f.room.id,3);let board=await f.a.req('/api/rooms/'+f.room.id);assert.equal(board.value.entries[0].score,high.proof.score);f.setTime('2026-09-24T03:00:00Z');const next=await run(f.a,f.room.id,10);board=await f.a.req('/api/rooms/'+f.room.id+'?period=weekly');assert.equal(board.value.entries[0].score,high.proof.score+next.proof.score);assert.equal(board.value.entries[0].days,2);});
test('KST midnight expires old runs and changes the shared daily seed',async()=>{const f=await setup();f.setTime('2026-09-23T14:59:59Z');const before=await f.a.req('/api/rooms/'+f.room.id+'/runs',{method:'POST',data:{}});f.advance(2000);const after=await f.a.req('/api/rooms/'+f.room.id+'/runs',{method:'POST',data:{}});assert.notEqual(before.value.run.seed,after.value.run.seed);const expired=await f.a.req('/api/runs/'+before.value.run.id+'/submit',{method:'POST',data:{moves:replay(before.value.run.seed,2).moves}});assert.equal(expired.status,410);assert.equal(after.value.run.day,'2026-09-24');});
test('nickname and room inputs reject markup and overly long text',async()=>{const f=await setup();for(const nickname of ['x','<script>','a'.repeat(17)])assert.equal((await f.a.req('/api/me',{method:'PATCH',data:{nickname}})).status,400);assert.equal((await f.a.req('/api/me',{method:'PATCH',data:{nickname:'새 닉네임'}})).status,200);assert.equal((await f.a.req('/api/rooms',{method:'POST',data:{name:'<방>'}})).status,400);});
test('owner leaves without deleting another member records',async()=>{const f=await setup();await f.b.req('/api/rooms/'+f.room.id+'/join',{method:'POST',data:{}});await run(f.b,f.room.id,8);await f.a.req('/api/rooms/'+f.room.id+'/leave',{method:'POST',data:{}});const board=await f.b.req('/api/rooms/'+f.room.id);assert.equal(board.value.room.ownerId,f.bob.id);assert.equal(board.value.entries.length,1);assert.equal((await f.a.req('/api/rooms/'+f.room.id)).status,403);});
test('account deletion transfers owned room, removes personal data and logs out',async()=>{const f=await setup();await f.b.req('/api/rooms/'+f.room.id+'/join',{method:'POST',data:{}});await run(f.a,f.room.id,4);await run(f.b,f.room.id,5);assert.equal((await f.a.req('/api/me',{method:'DELETE',data:{}})).status,200);assert.equal((await f.a.req('/api/me')).value.user,null);const b=await f.b.req('/api/rooms/'+f.room.id);assert.equal(b.value.room.ownerId,f.bob.id);assert.equal(b.value.entries.length,1);assert.equal(f.db.db.prepare('SELECT COUNT(*) n FROM users WHERE id=?').get(f.alice.id).n,0);});
test('logout invalidates the current session',async()=>{const f=await setup();assert.equal((await f.a.req('/api/logout',{method:'POST',data:{}})).status,200);assert.equal((await f.a.req('/api/me')).value.user,null);});
test('room capacity trigger is enforced atomically and owned room limit is bounded',async()=>{const f=await setup();for(let i=1;i<30;i++){const uid='test-user-'+i;f.db.db.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run(uid,'device:'+(500+i),'테스트',0,0);f.db.db.prepare('INSERT INTO memberships VALUES (?,?,?)').run(f.room.id,uid,0);}const joined=await f.b.req('/api/rooms/'+f.room.id+'/join',{method:'POST',data:{}});assert.equal(joined.status,409);for(let i=0;i<4;i++)assert.equal((await f.a.req('/api/rooms',{method:'POST',data:{name:'새 방 '+i}})).status,200);assert.equal((await f.a.req('/api/rooms',{method:'POST',data:{name:'제한 초과'}})).status,409);});
test('scheduled cleanup removes expired rows and inactive accounts',async()=>{const f=await setup();await run(f.a,f.room.id,4);f.advance(91*86400000);await f.worker.scheduled({},f.env);for(const table of ['sessions','runs','scores','rate_buckets'])assert.equal(f.db.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);assert.equal(f.db.db.prepare('SELECT COUNT(*) n FROM users').get().n,0);});

test('service has no Kakao API or SDK configuration',async()=>{const f=fixture();const config=await f.worker.fetch(new Request(ORIGIN+'/api/config'),f.env);const result=await config.json();assert.equal(result.authConfigured,true);assert.equal(result.authMode,'device-nickname');assert.equal(result.kakaoJavascriptKey,undefined);assert.equal((await f.worker.fetch(new Request(ORIGIN+'/api/auth/kakao'),f.env)).status,404);});
test('device session renews on visits, expires after 90 days of inactivity',async()=>{const f=fixture(),c=f.client();await c.login(101);f.advance(80*86400000);assert.ok((await c.req('/api/me')).value.user);f.advance(80*86400000);assert.ok((await c.req('/api/me')).value.user);f.advance(91*86400000);assert.equal((await c.req('/api/me')).value.user,null);await f.worker.scheduled({},f.env);assert.equal(f.db.db.prepare('SELECT COUNT(*) n FROM users').get().n,0);});

test('inactive owner cleanup keeps active friends and transfers the room',async()=>{const f=await setup();await f.b.req('/api/rooms/'+f.room.id+'/join',{method:'POST',data:{}});f.advance(89*86400000);await f.b.req('/api/me');f.advance(2*86400000);await f.worker.scheduled({},f.env);const board=await f.b.req('/api/rooms/'+f.room.id);assert.equal(board.status,200);assert.equal(board.value.room.ownerId,f.bob.id);assert.equal(board.value.room.memberCount,1);assert.equal(f.db.db.prepare('SELECT COUNT(*) n FROM users').get().n,1);});

test('fractional-day visits renew the database session as well as the cookie',async()=>{const f=fixture(),c=f.client();await c.login(101);f.advance(0.5*86400000);await c.req('/api/me');f.advance(89.75*86400000);assert.ok((await c.req('/api/me')).value.user);});
test('cleanup does not delete a session renewed inside a last-seen throttle hour',async()=>{const f=await setup();f.advance(80*86400000);await f.a.req('/api/rooms/'+f.room.id);f.advance(30*60000);await f.a.req('/api/me');f.advance(90*86400000-15*60000);await f.worker.scheduled({},f.env);assert.ok((await f.a.req('/api/me')).value.user);});
