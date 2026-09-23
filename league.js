// No social provider API is used. Session cookies are HttpOnly.
// All user-supplied labels are rendered with textContent, never HTML.
const $ = selector => document.querySelector(selector);
const FRIENDS_ORIGIN='https://2048-afterglow.on-xohye30.workers.dev';
const STATIC_HOST='on-xohye30.github.io';
const IDENTITY_SIGNAL='afterglow2048:identity-change';
const INVITE_KEY = 'afterglow2048:pending-invite';
const ROOM_ID = /^[A-Za-z0-9_-]{24,64}$/;
const format = n => Number(n || 0).toLocaleString('ko-KR');
const errorMessages = {
  AUTH_REQUIRED:'닉네임으로 먼저 시작해 주세요.', AUTH_NOT_CONFIGURED:'친구방 서버가 아직 연결되지 않았어요.', CONSENT_REQUIRED:'개인정보 안내와 기록 표시 동의를 확인해 주세요.', ALREADY_CONNECTED:'이미 연결된 기기예요. 새로고침해 주세요.',
  DATABASE_NOT_CONFIGURED:'친구방 저장 서버가 아직 연결되지 않았어요.', CONFIG_REQUIRED:'친구방 서버 설정이 필요해요.',
  MEMBERSHIP_REQUIRED:'이 방에 참가한 사람만 순위를 볼 수 있어요.', ROOM_NOT_FOUND:'초대받은 방을 찾을 수 없어요.',
  ROOM_FULL:'이 방은 30명으로 가득 찼어요.', ROOM_LIMIT:'내가 만든 방은 최대 5개까지예요.',
  RATE_LIMITED:'요청이 많아요. 잠시 후 다시 시도해 주세요.', RUN_LIMIT:'진행 중인 대결이 많아요. 잠시 후 다시 시도해 주세요.',
  RUN_EXPIRED:'한국 시간으로 날짜가 바뀌었어요. 오늘의 대결을 새로 시작해 주세요.',
  RUN_SUBMITTED:'이미 등록된 대결이에요. 순위를 새로고침해 주세요.', RUN_UNAVAILABLE:'이미 종료되었거나 사용할 수 없는 대결이에요.',
  RUN_NOT_FOUND:'현재 계정의 대결을 찾을 수 없어요.', INVALID_REPLAY:'이동 기록을 검증할 수 없어요. 새 대결로 다시 도전해 주세요.',
  INVALID_MOVES:'등록할 이동 기록이 없거나 기록이 너무 길어요.', INVALID_INPUT:'이름 길이를 확인해 주세요. 특수 제어 문자와 < >는 사용할 수 없어요.',
  CSRF_REJECTED:'기기 연결 상태를 새로고침한 뒤 다시 시도해 주세요.', ORIGIN_REJECTED:'게임 서버와 같은 주소에서 접속해 주세요.',
};
export function initLeague(game) {
  let config=null, me=null, csrf='', rooms=[], roomId='', period='daily', rankingVersion=0, pending=false, confirmation=null;
  let invite='';
  const params=new URL(location.href).searchParams;
  try {invite=params.get('room') || localStorage.getItem(INVITE_KEY) || '';if(ROOM_ID.test(invite))localStorage.setItem(INVITE_KEY,invite);else invite='';}catch{invite=ROOM_ID.test(params.get('room')||'')?params.get('room'):'';}
  const dialog=$('#league-dialog');
  const message=(text,error=false)=>{const el=$('#league-status');el.textContent=text;el.classList.toggle('is-error',error);};
  async function api(path,{method='GET',data}={}) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try {
      const headers={Accept:'application/json'};
      if(method!=='GET'){headers['Content-Type']='application/json';headers['X-CSRF-Token']=csrf;}
      const response=await fetch('/api'+path,{method,headers,credentials:'same-origin',cache:'no-store',signal:controller.signal,...(method==='GET'?{}:{body:JSON.stringify(data??{})})});
      if(!response.headers.get('Content-Type')?.includes('application/json'))throw Object.assign(new Error('Unavailable'),{code:'SERVER_UNAVAILABLE'});
      const result=await response.json();
      if(!response.ok)throw Object.assign(new Error('API request failed'),{code:result.error?.code||'SERVER_ERROR'});
      return result;
    }finally{clearTimeout(timer);}
  }
  function showError(error){if(error.code==='AUTH_REQUIRED')dropIdentity();message(errorMessages[error.code] || '연결이 원활하지 않아요. 기록은 이 브라우저에 남아 있으니 잠시 후 다시 시도해 주세요.',true);}
  async function action(button,work) {
    if(pending)return;pending=true;button.disabled=true;message('처리 중이에요…');
    try{await work();}catch(error){showError(error);}finally{pending=false;button.disabled=false;}
  }
  function clearInvite(){invite='';try{localStorage.removeItem(INVITE_KEY);}catch{}const url=new URL(location.href);url.searchParams.delete('room');history.replaceState(null,'',url);$('#league-invite').hidden=true;}
  function inviteURL(){const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('league','1');url.searchParams.set('room',roomId);return url.href;}
  function ask(text,work){confirmation=work;$('#league-confirm-copy').textContent=text;$('#league-confirm').hidden=false;$('#league-confirm-ok').focus();}
  function currentAttempt(){const attempt=game.getAttempt();return attempt && me && attempt.userId===me.id && attempt.roomId===roomId ? attempt : null;}
  function renderAttempt(){const attempt=currentAttempt();$('#league-resume').hidden=!attempt||attempt.submitted;$('#league-submit').hidden=!attempt||attempt.submitted||!attempt.moves.length;$('#league-run-hint').textContent=attempt&&!attempt.submitted?'진행 중: '+format(attempt.moves.length)+'수. 기록 등록을 누르면 이번 대결이 종료돼요. 한국 시간 자정 전에 등록해 주세요.':'새 대결은 같은 일일 퍼즐에서 시작해요. 연습 모드의 기록은 순위에 올라가지 않아요.';}
  function renderAccount(){
    $('#league-login').hidden=Boolean(me);$('#league-account').hidden=!me;$('#league-lobby').hidden=!me;$('#league-delete-account').hidden=!me;
    $('#league-nickname').textContent=me?.nickname||'';$('#league-join').disabled=!me;$('#league-join').textContent=me?'이 방에 참가하기':'먼저 닉네임으로 시작하기';
    const select=$('#league-room-select');select.replaceChildren();for(const room of rooms){const option=document.createElement('option');option.value=room.id;option.textContent=room.name;select.append(option);}
    if(!rooms.some(r=>r.id===roomId))roomId=rooms[0]?.id||'';select.value=roomId;select.disabled=!rooms.length;
    if(!rooms.length){const option=document.createElement('option');option.textContent='아직 참가한 방이 없어요';select.append(option);}
    $('#league-room-panel').hidden=!me||!roomId;
    $('#friends-card-label').textContent=me?me.nickname+' · 내 친구방 '+rooms.length+'개 ↗':'닉네임으로 친구방 시작하기 ↗';
  }
  function broadcastIdentity(kind){try{localStorage.setItem(IDENTITY_SIGNAL,Date.now()+':'+kind);}catch{}}
  function dropIdentity(){rankingVersion++;game.clearIdentity();me=null;csrf='';rooms=[];roomId='';$('#league-enter-name').value='';$('#league-consent').checked=false;$('#league-nickname-form').hidden=true;renderAccount();}
  async function refreshMe(){const data=await api('/me');const attempt=game.getAttempt();if((me&&me.id!==data.user?.id)||(attempt&&attempt.userId!==data.user?.id))game.clearIdentity();me=data.user;csrf=data.csrfToken||'';rooms=data.rooms||[];if(invite&&rooms.some(r=>r.id===invite)){roomId=invite;clearInvite();}renderAccount();}
  async function showInvite(){if(!invite)return;let data;try{data=await api('/invites/'+invite);}catch(error){if(error.code==='ROOM_NOT_FOUND'){clearInvite();return;}throw error;}$('#league-invite').hidden=false;$('#league-invite-name').textContent=data.name;$('#league-invite-description').textContent=data.memberCount+'명이 기다리는 방이에요. 참가하면 게임 닉네임과 등록한 기록이 방 안에 공개돼요.';}
  async function refreshRanking(){
    if(!me||!roomId)return;const version=++rankingVersion;const data=await api('/rooms/'+roomId+'?period='+period);if(version!==rankingVersion)return;
    $('#league-room-panel').hidden=false;$('#league-room-title').textContent=data.room.name;$('#league-member-count').textContent=data.room.memberCount+' / 30명';
    $('#league-rank-caption').textContent=period==='daily'?data.day+' · KST':'월요일부터 오늘까지 · KST';
    for(const b of document.querySelectorAll('[data-period]'))b.setAttribute('aria-pressed',String(b.dataset.period===period));
    const body=$('#league-ranking');body.replaceChildren();
    for(const entry of data.entries){const tr=document.createElement('tr');if(entry.userId===me.id)tr.className='is-me';for(const [i,value] of [entry.rank,entry.nickname+(entry.userId===me.id?' (나)':''),format(entry.score),format(entry.maxTile)].entries()){const td=document.createElement(i===1?'th':'td');if(i===1)td.scope='row';td.textContent=value;tr.append(td);}body.append(tr);}
    $('#league-empty').hidden=data.entries.length>0;$('#league-my-rank').textContent=data.myRank?'내 순위 '+data.myRank+'위 · '+data.entries.length+'명 참가':'아직 등록한 기록이 없어요.';
    $('#league-native-share').hidden=!navigator.share;renderAttempt();
  }
  async function refresh(){await refreshMe();await showInvite();await refreshRanking();}
  async function open(){
    if(location.hostname===STATIC_HOST){const target=new URL(FRIENDS_ORIGIN);target.searchParams.set('league','1');if(invite)target.searchParams.set('room',invite);location.assign(target.href);return;}
    if(!dialog.open)dialog.showModal();$('#league-copy-box').hidden=true;$('#league-confirm').hidden=true;
    if(!config?.enabled){$('#league-login').hidden=true;message('친구 대결 서버가 아직 연결되지 않았어요. 혼자 플레이는 계속 이용할 수 있어요.',true);return;}
    if(!config.authConfigured){$('#league-login').hidden=true;message('친구방 서버 설정을 확인 중이에요. 잠시 후 다시 시도해 주세요.',true);return;}
    message('친구방을 불러오는 중이에요…');try{await refresh();message('친구방 순위는 참가자에게만 보여요.');}catch(error){showError(error);}
  }
  async function copyInvite(){const url=inviteURL();try{await navigator.clipboard.writeText(url);message('초대 링크를 복사했어요. 카톡에 붙여넣어 보내세요.');}catch{$('#league-copy-text').value=url;$('#league-copy-box').hidden=false;$('#league-copy-text').focus();$('#league-copy-text').select();message('아래 링크를 직접 복사해 주세요.');}}
  async function startRun(){const result=await api('/rooms/'+roomId+'/runs',{method:'POST'});game.startRun(result.run);dialog.close();game.toast('친구 대결 시작! 오늘은 모두 같은 퍼즐이에요.');}
  $('#friends-card').addEventListener('click',open);document.addEventListener('afterglow:league-open',open);$('#league-close').addEventListener('click',()=>dialog.close());
  $('#league-enter-form').addEventListener('submit',event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');action(button,async()=>{await api('/auth/nickname',{method:'POST',data:{nickname:$('#league-enter-name').value,consent:$('#league-consent').checked}});await refresh();broadcastIdentity('connected');message(invite?'닉네임을 연결했어요. 초대받은 방에 참가해 주세요.':'닉네임을 연결했어요. 새 친구방을 만들거나 초대 링크를 열어 보세요.');});});
  $('#league-refresh').addEventListener('click',()=>action($('#league-refresh'),async()=>{await refresh();message('최신 순위로 갱신했어요.');}));
  $('#league-room-select').addEventListener('change',async event=>{roomId=event.target.value;try{await refreshRanking();message('');}catch(error){showError(error);}});
  $('#league-create-form').addEventListener('submit',event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');action(button,async()=>{const result=await api('/rooms',{method:'POST',data:{name:$('#league-room-name').value}});roomId=result.room.id;$('#league-room-name').value='';await refresh();message('친구방을 만들었어요. 카톡으로 초대해 보세요.');});});
  $('#league-join').addEventListener('click',()=>action($('#league-join'),async()=>{const result=await api('/rooms/'+invite+'/join',{method:'POST'});roomId=result.room.id;clearInvite();await refresh();message('방에 참가했어요. 같은 퍼즐로 겨뤄볼까요?');}));
  $('#league-dismiss-invite').addEventListener('click',clearInvite);
  for(const button of document.querySelectorAll('[data-period]'))button.addEventListener('click',async()=>{period=button.dataset.period;try{await refreshRanking();}catch(error){showError(error);}});
  $('#league-copy').addEventListener('click',copyInvite);
  $('#league-native-share').addEventListener('click',async()=>{try{await navigator.share({title:'2048 Afterglow · 친구 대결',text:'같은 퍼즐, 우리끼리 한 판! 친구방에서 기록을 겨뤄요.',url:inviteURL()});}catch(error){if(error.name!=='AbortError')await copyInvite();}});
  $('#league-start').addEventListener('click',()=>{const attempt=currentAttempt();if(attempt&&!attempt.submitted&&attempt.moves.length)ask('현재 대결을 새 판으로 바꿀까요? 아직 등록하지 않은 현재 이동 기록은 복원할 수 없어요.',()=>action($('#league-start'),startRun));else action($('#league-start'),startRun);});
  $('#league-resume').addEventListener('click',()=>{const attempt=currentAttempt();if(attempt){game.resumeRun();dialog.close();}});
  $('#league-submit').addEventListener('click',()=>action($('#league-submit'),async()=>{const attempt=currentAttempt();if(!attempt||!attempt.moves.length)throw {code:'INVALID_MOVES'};const result=await api('/runs/'+attempt.id+'/submit',{method:'POST',data:{moves:attempt.moves}});game.markSubmitted(attempt.id);await refreshRanking();message(format(result.result.score)+'점 등록 완료!'+(result.result.personalBest?' 오늘의 내 최고 기록이에요.':''));}));
  $('#league-leave').addEventListener('click',()=>ask('이 방을 나가면 이 방에 등록한 내 기록과 진행 중인 대결이 삭제돼요. 나갈까요?',()=>action($('#league-leave'),async()=>{await api('/rooms/'+roomId+'/leave',{method:'POST'});roomId='';await refresh();message('방에서 나왔어요.');})));
  $('#league-logout').addEventListener('click',()=>ask('이 기기와의 연결을 끊으면 같은 계정으로 돌아올 수 없어요. 남아 있는 서버 기록까지 지우려면 취소 후 “내 게임 데이터 삭제”를 선택하세요. 연결을 끊을까요?',()=>action($('#league-logout'),async()=>{await api('/logout',{method:'POST'});dropIdentity();broadcastIdentity('clear');message('기기 연결을 해제했어요. 혼자 플레이는 계속할 수 있어요.');})));
  $('#league-edit-name').addEventListener('click',()=>{$('#league-nickname-form').hidden=!$('#league-nickname-form').hidden;$('#league-nickname-input').value=me?.nickname||'';if(!$('#league-nickname-form').hidden)$('#league-nickname-input').focus();});
  $('#league-nickname-form').addEventListener('submit',event=>{event.preventDefault();action(event.currentTarget.querySelector('button'),async()=>{await api('/me',{method:'PATCH',data:{nickname:$('#league-nickname-input').value}});$('#league-nickname-form').hidden=true;await refresh();message('게임 닉네임을 바꿨어요.');});});
  $('#league-delete-account').addEventListener('click',()=>ask('모든 친구방 참가 정보, 게임 계정과 서버 기록을 영구 삭제할까요? 다른 친구의 기록과 혼자 플레이 기록은 남겨요.',()=>action($('#league-delete-account'),async()=>{await api('/me',{method:'DELETE'});dropIdentity();broadcastIdentity('clear');message('서버의 내 게임 데이터를 삭제했어요. 이 브라우저의 혼자 플레이 기록은 남아 있어요.');})));
  $('#league-confirm-cancel').addEventListener('click',()=>{confirmation=null;$('#league-confirm').hidden=true;});$('#league-confirm-ok').addEventListener('click',()=>{const work=confirmation;confirmation=null;$('#league-confirm').hidden=true;work?.();});
  window.addEventListener('storage',async event=>{if(event.key!==IDENTITY_SIGNAL||!event.newValue)return;if(event.newValue.endsWith(':clear')){dropIdentity();message('다른 탭에서 기기 연결이 해제됐어요.');}else{try{await refresh();}catch(error){showError(error);}}});
  setInterval(async()=>{if(dialog.open&&!document.hidden&&me&&roomId&&!pending){try{await refreshRanking();}catch(error){showError(error);}}},20000);
  document.addEventListener('afterglow:league-progress',renderAttempt);
  (async()=>{if(location.hostname===STATIC_HOST){$('#friends-card').hidden=false;$('#friends-card-label').textContent='온라인 친구방 열기 ↗';$('#mode-league').hidden=false;$('.mode-tabs').classList.add('has-league');if(params.has('league')||invite)await open();return;}try{config=await api('/config');if(!config.enabled)return;$('#storage-note').textContent='혼자 플레이는 기기에, 친구 대결은 서버에 저장돼요.';$('#friends-card').hidden=false;$('#mode-league').hidden=false;$('.mode-tabs').classList.add('has-league');if(params.has('league')||invite)await open();}catch{if(params.has('league')||invite)await open();}})();
  return {open};
}
