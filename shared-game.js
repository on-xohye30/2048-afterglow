// Shared links start independent rounds. They never read/write the normal game slot.
export const SHARED_GAME_PREFIX = 'afterglow2048:v1:shared:';
const soloModes = new Set(['classic','daily','zen']);
const idPattern = /^[a-f0-9]{32}$/;
const validDay = (value,today) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value && value <= today;
export function resolveSharedLaunch({href,today,navigationType='navigate',historyState=null,createId}) {
  const params = new URL(href).searchParams;
  // Invitations/authenticated room entry are not public score-share links.
  if (params.has('room') || params.has('league')) return null;
  const requested = params.get('mode');
  if (params.get('play') !== '1' && !soloModes.has(requested) && requested !== 'league') return null;
  const mode = requested === 'league' ? 'daily' : soloModes.has(requested) ? requested : 'classic';
  const pinnedDay = mode === 'daily' && validDay(params.get('date'),today) ? params.get('date') : null;
  const day = pinnedDay || today;
  const signature = mode+':'+(mode === 'daily' ? day : 'any');
  const previous = historyState?.plusplusShare;
  const restoring = ['reload','back_forward'].includes(navigationType) && previous?.signature === signature && idPattern.test(previous?.id || '');
  const id = restoring ? previous.id : createId();
  if (!idPattern.test(id)) throw new TypeError('Invalid shared round identifier');
  return {id,mode,day,pinnedDay,signature,restoring};
}
export function sharedHistoryState(previous,launch) {
  const next = previous && typeof previous === 'object' && !Array.isArray(previous) ? {...previous} : {};
  if (launch) next.plusplusShare = {id:launch.id,signature:launch.signature};
  else delete next.plusplusShare;
  return next;
}
export const sharedGameKey = launch => SHARED_GAME_PREFIX+launch.id;
export function readSharedGame(storage,launch,mode,day) {
  try {
    const value=JSON.parse(storage.getItem(sharedGameKey(launch)) || 'null');
    if (value?.version !== 1 || value.mode !== mode || (mode === 'daily' && value.day !== day)) return null;
    return value.state || null;
  } catch { return null; }
}
export function writeSharedGame(storage,launch,mode,day,state,now=Date.now()) {
  storage.setItem(sharedGameKey(launch),JSON.stringify({version:1,mode,day,state,updatedAt:now}));
  // Bound isolated histories without ever deleting classic/daily/zen/league saves.
  const others=[];
  for(let i=0;i<storage.length;i++){
    const key=storage.key(i);
    if(!key?.startsWith(SHARED_GAME_PREFIX) || key===sharedGameKey(launch))continue;
    let at=0;try{at=Number(JSON.parse(storage.getItem(key)).updatedAt)||0;}catch{}
    others.push({key,at});
  }
  others.sort((a,b)=>b.at-a.at);
  for(const old of others.slice(7))storage.removeItem(old.key);
}
