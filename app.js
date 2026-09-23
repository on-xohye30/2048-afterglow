import { slide, canMove, spawn, createBoard, createRng, maxTile } from './engine.js';

const $ = selector => document.querySelector(selector);
const STORE = 'afterglow2048:v1';
const MODES = {classic:{size:4,name:'클래식',undos:3},daily:{size:4,name:'오늘의 도전',undos:0},zen:{size:5,name:'여유 모드',undos:Infinity}};
const directions = {ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down',a:'left',d:'right',w:'up',s:'down'};
const fmt = value => value.toLocaleString('ko-KR');
const dateInSeoul = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const hash = text => {let n=2166136261;for(const c of text){n=Math.imul(n^c.charCodeAt(0),16777619);}return n>>>0;};
let storageOK=true, saved={};
try{saved=JSON.parse(localStorage.getItem(STORE)||'{}')||{};}catch{storageOK=false;}
if(typeof saved!=='object'||Array.isArray(saved)) saved={};
if(!saved.games||typeof saved.games!=='object'||Array.isArray(saved.games)) saved.games={};
if(!saved.best||typeof saved.best!=='object'||Array.isArray(saved.best)) saved.best={};
let mode=MODES[saved.mode]?saved.mode:'classic';
let day=dateInSeoul();
let state, busy=false, generation=0, timer, audio, sound=Boolean(saved.sound);
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let theme=saved.theme==='dark'?'dark':'light';
const gameKey=()=>mode==='daily'?'daily:'+day:mode;
const isBoard=(b,size)=>Array.isArray(b)&&b.length===size*size&&b.some(Boolean)&&b.every(v=>Number.isSafeInteger(v)&&v>=0&&(v===0||(v>=2&&Math.log2(v)%1===0)));
function validState(s,size){return s&&isBoard(s.board,size)&&Number.isSafeInteger(s.score)&&s.score>=0&&Number.isSafeInteger(s.moves)&&s.moves>=0&&Number.isInteger(s.seed)&&s.seed>=0&&s.seed<=4294967295;}
function randomSeed(){const numbers=new Uint32Array(1);crypto.getRandomValues(numbers);return numbers[0];}
function freshState(){const rng=createRng(mode==='daily'?hash('afterglow-v1:'+day):randomSeed());return {board:createBoard(MODES[mode].size,rng),score:0,moves:0,seed:rng.state,streak:0,bestStreak:0,undoUsed:0,history:[],won:false,continued:false,over:false};}
function persist(){
  saved.mode=mode;saved.theme=theme;saved.sound=sound;saved.games[gameKey()]=state;
  saved.best[mode]=Math.max(Number(saved.best[mode])||0,state.score);
  const oldDaily=Object.keys(saved.games).filter(k=>k.startsWith('daily:')).sort().reverse().slice(7);for(const k of oldDaily)delete saved.games[k];
  try{localStorage.setItem(STORE,JSON.stringify(saved));}catch{if(storageOK){storageOK=false;toast('브라우저 저장 공간이 없어 이번 진행은 자동 저장되지 않아요.');}}
}
function loadMode(){
  const candidate=saved.games[gameKey()];
  state=validState(candidate,MODES[mode].size)?candidate:freshState();
  state.history=Array.isArray(state.history)?state.history.filter(h=>validState(h,MODES[mode].size)).slice(-100):[];
  state.undoUsed=Number.isInteger(state.undoUsed)&&state.undoUsed>=0?state.undoUsed:0;
  state.streak=Number.isInteger(state.streak)&&state.streak>=0?state.streak:0;
  state.bestStreak=Number.isInteger(state.bestStreak)&&state.bestStreak>=0?state.bestStreak:0;
  state.won=maxTile(state.board)>=2048;state.over=!canMove(state.board);state.continued=Boolean(state.continued);
  renderAll();persist();
}
function applyTheme(){document.documentElement.dataset.theme=theme;$('#theme-btn').setAttribute('aria-pressed',String(theme==='dark'));$('#theme-btn').setAttribute('aria-label',theme==='dark'?'라이트 모드 켜기':'다크 모드 켜기');document.querySelector('meta[name="theme-color"]').content=theme==='dark'?'#18251f':'#f6f3ec';}
function applySound(){const b=$('#sound-btn');b.setAttribute('aria-pressed',String(sound));b.setAttribute('aria-label',sound?'효과음 끄기':'효과음 켜기');b.innerHTML=sound?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Zm5 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Zm5 4 5 6m0-6-5 6"/></svg>';}
function playTone(merged){if(!sound)return;try{audio ||= new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();const now=audio.currentTime;const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.type='sine';oscillator.frequency.setValueAtTime(merged?390+Math.min(state.streak,8)*45:210,now);gain.gain.setValueAtTime(.035,now);gain.gain.exponentialRampToValueAtTime(.001,now+.11);oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(now);oscillator.stop(now+.12);}catch{}}
function tile(value,index,extra=''){
  const size=MODES[mode].size;const outer=document.createElement('div');outer.className='tile '+(value>=1024?'big ':'')+(value>2048?'huge ':'')+extra;outer.dataset.value=value;outer.dataset.index=index;
  outer.style.setProperty('--x',index%size);outer.style.setProperty('--y',Math.floor(index/size));outer.setAttribute('role','img');outer.setAttribute('aria-label',(Math.floor(index/size)+1)+'행 '+(index%size+1)+'열: '+value);
  const inner=document.createElement('span');inner.className='tile-inner';inner.textContent=value;outer.append(inner);return outer;
}
function renderBoard(newIndex=null,merges=[]){
  const size=MODES[mode].size,board=$('#board');board.style.setProperty('--size',size);board.dataset.size=size;
  if($('#board-cells').childElementCount!==size*size){$('#board-cells').replaceChildren(...Array.from({length:size*size},()=>{const c=document.createElement('div');c.className='cell';return c;}));}
  $('#tiles').replaceChildren(...state.board.flatMap((value,index)=>value?[tile(value,index,(index===newIndex?'new ':'')+(merges.includes(index)?'merged':''))]:[]));
}
const undoAvailable=()=>state.history.length>0&&state.undoUsed<MODES[mode].undos;
function renderStats(){
  $('#score').textContent=fmt(state.score);$('#best').textContent=fmt(Math.max(Number(saved.best[mode])||0,state.score));$('#move-count').textContent=fmt(state.moves)+' 수';
  const remain=MODES[mode].undos-state.undoUsed;$('#undo-label').textContent=mode==='daily'?'되돌리기 없음':'되돌리기 · '+(remain===Infinity?'∞':remain);$('#undo-btn').disabled=!undoAvailable();
  const top=maxTile(state.board),level=Math.max(0,Math.min(10,Math.log2(top)-1)),next=top*2;
  $('#highest').textContent=fmt(top);$('#target-tile').textContent=next;$('#target-tile').style.fontSize=next>=10000?'23px':'';
  $('#target-progress-label').textContent=level+' / 10';$('#target-progress').setAttribute('aria-valuenow',level);$('#target-progress-fill').style.width=(level/10*100)+'%';
  $('#target-copy').textContent=top===2?'2 + 2, 첫 번째 합치기를 해볼까요?':top>=2048?'2048을 넘었어요. 한계를 더 넓혀봐요!':fmt(top)+' + '+fmt(top)+', 다음 숫자가 기다려요.';
  $('#streak-number').textContent=state.streak;$('#streak-copy').textContent=state.streak>1?state.streak+'수 연속 합치기! 최고 '+state.bestStreak+'수':state.bestStreak>0?'이번 판 최고 연속 '+state.bestStreak+'수':'합치기를 이어가 보세요.';
  $('.streak-card').classList.toggle('active',state.streak>1);
  $('#daily-date').textContent=day.replaceAll('-',' . ')+' · KST';
  $('#mode-caption').textContent=mode==='daily'?day+' · 되돌리기 없는 오늘의 퍼즐':mode==='zen'?'넓어진 보드, 서두르지 않아도 괜찮아요.':'같은 숫자 둘이 만나면, 더 큰 하나로.';
  for(const button of document.querySelectorAll('[data-mode]')){const active=button.dataset.mode===mode;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
  $('#game-panel').setAttribute('aria-labelledby','mode-'+mode);
  const win=state.won&&!state.continued;$('#game-overlay').hidden=!win&&!state.over;
  if(win){$('#overlay-kicker').textContent='YOU MADE IT';$('#overlay-title').textContent='2048, 해냈어요!';$('#overlay-copy').textContent=fmt(state.score)+'점. 이제 4096을 향해 가볼까요?';$('#overlay-primary').textContent='계속 플레이';$('#overlay-secondary').textContent='새 게임';$('#overlay-secondary').hidden=false;}
  else if(state.over){$('#overlay-kicker').textContent='NICELY PLAYED';$('#overlay-title').textContent='이번 판도 멋졌어요.';$('#overlay-copy').textContent=fmt(state.score)+'점 · 가장 큰 타일 '+fmt(top)+' · '+fmt(state.moves)+'수';$('#overlay-primary').textContent=mode==='daily'?'같은 퍼즐 다시 도전':'다시 도전';$('#overlay-secondary').textContent='한 수 되돌리기';$('#overlay-secondary').hidden=!undoAvailable();}
}
function renderAll(){renderBoard();renderStats();}
function toast(text){clearTimeout(timer);$('#toast').textContent=text;$('#toast').hidden=false;timer=setTimeout(()=>{$('#toast').hidden=true;},3000);}
function checkDay(){const today=dateInSeoul();if(today===day)return false;persist();day=today;if(mode==='daily'){generation++;busy=false;loadMode();toast('새로운 날이에요. 오늘의 퍼즐을 준비했어요.');return true;}renderStats();return false;}
function selectMode(next){if(!MODES[next]||next===mode)return;persist();generation++;busy=false;day=dateInSeoul();mode=next;loadMode();$('#game-status').textContent=MODES[mode].name+' 모드. 점수 '+state.score+'.';}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function move(direction){
  if(busy||document.querySelector('dialog[open]')||checkDay()||state.over||(state.won&&!state.continued))return;
  const result=slide(state.board,direction);if(!result.changed)return;
  busy=true;const token=++generation;
  const previous={...state,board:[...state.board]};delete previous.history;
  if(MODES[mode].undos>0){state.history.push(previous);if(state.history.length>100)state.history.shift();}
  const rng=createRng(state.seed),spawned=spawn(result.board,rng);
  state.board=spawned.board;state.seed=rng.state;state.score+=result.scoreGain;state.moves++;state.streak=result.merges.length?state.streak+1:0;state.bestStreak=Math.max(state.bestStreak,state.streak);state.over=!canMove(state.board);state.won=maxTile(state.board)>=2048;persist();
  if(!reducedMotion.matches){for(const t of result.transitions){const el=$('#tiles').querySelector('[data-index="'+t.from+'"]');if(el){el.style.setProperty('--x',t.to%MODES[mode].size);el.style.setProperty('--y',Math.floor(t.to/MODES[mode].size));if(t.merged)el.style.zIndex='2';}}await delay(125);}
  if(token!==generation)return;
  renderBoard(spawned.index,result.merges);renderStats();playTone(result.merges.length>0);
  if(result.scoreGain){const gain=$('#score-gain');gain.textContent='+'+fmt(result.scoreGain);gain.classList.remove('show');void gain.offsetWidth;gain.classList.add('show');}
  if(state.won&&!state.continued){$('#game-status').textContent='2048 달성! 점수 '+state.score;$('#overlay-primary').focus();}
  else if(state.over){$('#game-status').textContent='게임 종료. '+state.score+'점. 가장 큰 타일 '+maxTile(state.board);$('#overlay-primary').focus();}
  else $('#game-status').textContent=state.moves+'수. '+state.score+'점. 가장 큰 타일 '+maxTile(state.board)+(result.scoreGain?'. 이번 이동 '+result.scoreGain+'점':'');
  busy=false;
}
function undo(){if(busy||checkDay()||!undoAvailable())return;const used=state.undoUsed+1,history=state.history,previous=history.pop();state={...previous,board:[...previous.board],history,undoUsed:used};generation++;renderAll();persist();toast('한 수 되돌렸어요. 다른 방향으로 가볼까요?');$('#board').focus({preventScroll:true});}
function restart(){generation++;busy=false;day=dateInSeoul();state=freshState();renderAll();persist();$('#board').focus({preventScroll:true});toast(mode==='daily'?'오늘과 같은 퍼즐로 다시 시작해요.':'새로운 한 판, 가볍게 시작해요.');}
function requestRestart(){if(busy)return;if(state.moves>0)$('#restart-dialog').showModal();else restart();}
for(const b of document.querySelectorAll('[data-mode]'))b.addEventListener('click',()=>{selectMode(b.dataset.mode);$('#board').focus({preventScroll:true});});
$('.mode-tabs').addEventListener('keydown',event=>{const keys=['ArrowLeft','ArrowRight','Home','End'];if(!keys.includes(event.key))return;event.preventDefault();event.stopPropagation();const modes=Object.keys(MODES),i=modes.indexOf(mode),next=event.key==='Home'?0:event.key==='End'?2:(i+(event.key==='ArrowRight'?1:2))%3;selectMode(modes[next]);$('#mode-'+mode).focus();});
$('#daily-card').addEventListener('click',()=>{selectMode('daily');$('#board').focus({preventScroll:true});});
for(const b of document.querySelectorAll('[data-direction]'))b.addEventListener('click',()=>move(b.dataset.direction));
document.addEventListener('keydown',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||event.isComposing||document.querySelector('dialog[open]'))return;
  if(event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  const key=event.key.length===1?event.key.toLowerCase():event.key;
  if(directions[key]){event.preventDefault();move(directions[key]);}else if(key==='u'){event.preventDefault();undo();}else if(key==='r'&&!event.repeat){event.preventDefault();requestRestart();}
});
let pointer=null;
$('#board').addEventListener('pointerdown',event=>{if(!event.isPrimary||event.button!==0)return;pointer={x:event.clientX,y:event.clientY,id:event.pointerId};$('#board').setPointerCapture(event.pointerId);});
$('#board').addEventListener('pointerup',event=>{if(!pointer||event.pointerId!==pointer.id)return;const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;pointer=null;if(Math.max(Math.abs(dx),Math.abs(dy))<22)return;move(Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'down':'up');});
$('#board').addEventListener('pointercancel',()=>{pointer=null;});
$('#undo-btn').addEventListener('click',undo);$('#new-btn').addEventListener('click',requestRestart);$('#restart-cancel').addEventListener('click',()=>$('#restart-dialog').close());$('#restart-confirm').addEventListener('click',()=>{$('#restart-dialog').close();restart();});
$('#overlay-primary').addEventListener('click',()=>{if(state.won&&!state.continued){state.continued=true;renderStats();persist();$('#board').focus({preventScroll:true});}else restart();});
$('#overlay-secondary').addEventListener('click',()=>{if(state.won&&!state.continued)requestRestart();else undo();});
$('#help-btn').addEventListener('click',()=>$('#help-dialog').showModal());
$('#theme-btn').addEventListener('click',()=>{theme=theme==='light'?'dark':'light';applyTheme();persist();});
$('#sound-btn').addEventListener('click',()=>{sound=!sound;applySound();persist();playTone(true);toast(sound?'효과음을 켰어요.':'효과음을 껐어요.');});
$('#share-btn').addEventListener('click',async()=>{
  const text=['2048 Afterglow · '+MODES[mode].name+(mode==='daily'?' ('+day+')':''),fmt(state.score)+'점 · '+fmt(state.moves)+'수','가장 큰 타일 '+fmt(maxTile(state.board))+' · 최고 연속 합치기 '+state.bestStreak+'수',mode==='daily'?'같은 퍼즐에서 나와 한 판 어때요?':'한 수 더, 가볍게 즐겨봐요.',location.href.split('#')[0].split('?')[0]].join('\n');
  try{if(!navigator.clipboard)throw new Error('clipboard unavailable');await navigator.clipboard.writeText(text);toast('기록과 게임 링크를 복사했어요.');}catch{$('#share-text').value=text;$('#share-dialog').showModal();$('#share-text').focus();$('#share-text').select();}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDay();});
window.addEventListener('pagehide',persist);
window.addEventListener('storage',event=>{if(event.key===STORE&&event.newValue){try{const other=JSON.parse(event.newValue);for(const key of Object.keys(MODES)){saved.best[key]=Math.max(Number(saved.best[key])||0,Number(other.best?.[key])||0);}renderStats();}catch{}}});
applyTheme();applySound();loadMode();
if(!storageOK)toast('이 브라우저에서는 기록 저장이 제한될 수 있어요.');
