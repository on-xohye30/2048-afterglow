import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {SERVICE_NAME,modeLabel,shareRecord} from './ui-model.js';
const record={mode:'classic',day:'2026-09-23',score:1284,moves:96,highest:128,bestStreak:3};
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('public UI and share records use the exact service name',()=>{
  assert.equal(SERVICE_NAME,'2048_plusplus');
  const html=read('index.html');assert.match(html,/<title>2048_plusplus · 한 수 더<\/title>/);
  assert.match(read('privacy.html'),/개인정보 안내 · 2048_plusplus/);
  assert.ok(!/Afterglow|AFTERGLOW|>afterglow</.test(html));
  assert.ok(shareRecord(record,'https://example.com/game/').text.startsWith('2048_plusplus'));
});
test('all four mode labels remain distinct',()=>{
  assert.deepEqual(['classic','daily','zen','league'].map(modeLabel),['클래식 4×4','오늘의 도전','여유 모드 5×5','친구 대결']);
  assert.equal(modeLabel('invalid'),'클래식 4×4');
});
test('share card derives every metric from the current game',()=>{
  const result=shareRecord(record,'https://example.com/game/');
  assert.equal(result.score,'1,284');assert.equal(result.moves,'96');assert.equal(result.highest,'128');assert.equal(result.streak,'×3');
  assert.match(result.text,/1,284점 · 96수/);assert.equal(result.day,record.day);
  assert.equal(record.score,1284);
});
test('daily sharing preserves the exact puzzle date',()=>{
  const result=shareRecord({...record,mode:'daily'},'https://example.com/game/?date=2020-01-01#old');
  const url=new URL(result.url);assert.equal(url.searchParams.get('mode'),'daily');assert.equal(url.searchParams.get('date'),'2026-09-23');assert.equal(url.hash,'');
  assert.match(result.text,/같은 퍼즐/);
});
test('public score sharing strips private room and identity parameters',()=>{
  for(const mode of ['classic','zen','league']){
    const result=shareRecord({...record,mode},'https://example.com/game/?league=1&room=private-room&token=private#secret');
    assert.ok(!/private|secret|token|room|league=/.test(result.url));
    assert.equal(new URL(result.url).pathname,'/game/');
  }
});
test('every static DOM hook exists exactly once after redesign',()=>{
  const html=read('index.html'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for(const file of ['app.js','league.js'])for(const match of read(file).matchAll(/\$\('#([^']+)'\)/g))assert.ok(ids.includes(match[1]),file+' missing '+match[1]);
  assert.match(html,/role="radiogroup"/);assert.equal((html.match(/role="radio"/g)||[]).length,4);
  assert.match(html,/id="restart-cancel" autofocus/);
  assert.ok(!read('app.js').includes("setAttribute('aria-selected'"));
  assert.ok(read('app.js').includes("$('#mode-picker-label').textContent=modeLabel(mode)"));
});
test('save namespace, daily seed, session cookie and invite contract are preserved',()=>{
  assert.match(read('app.js'),/const STORE = 'afterglow2048:v1'/);
  assert.match(read('app.js'),/hash\('afterglow-v1:'/);
  assert.match(read('backend/worker.mjs'),/__Host-afterglow_session/);
  assert.match(read('backend/worker.mjs'),/'afterglow-v1:'/);
  assert.match(read('league.js'),/afterglow2048:pending-invite/);
});
test('reference fonts are self-hosted with required licenses and no external requests',()=>{
  const css=read('assets/fonts/fonts.css');assert.ok(!/https?:|@import/.test(css));
  const paths=[...css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)].map(m=>m[1]);assert.equal(paths.length,5);
  for(const p of paths)assert.ok(existsSync(new URL('assets/fonts/'+p,import.meta.url)));
  for(const name of ['gowunbatang','ibmplexsanskr','dmserifdisplay'])assert.match(read('assets/fonts/'+name+'-OFL.txt'),/SIL OPEN FONT LICENSE/);
});
