// Presentation only: game saves, seeds, sessions and replay rules stay unchanged.
export const SERVICE_NAME = '2048_plusplus';
const labels = {classic:'클래식 4×4',daily:'오늘의 도전',zen:'여유 모드 5×5',league:'친구 대결'};
export const modeLabel = mode => labels[mode] || labels.classic;
export function shareRecord({mode,day,score,moves,highest,bestStreak},href) {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  // Public score sharing never exposes private invitation or account parameters.
  if (mode !== 'league') url.searchParams.set('mode',Object.hasOwn(labels,mode)?mode:'classic');
  if (mode === 'daily') url.searchParams.set('date',day);
  const number = n => Number(n).toLocaleString('ko-KR');
  const title = SERVICE_NAME+' · '+modeLabel(mode);
  const text = [title+(mode==='daily'?' ('+day+')':''),number(score)+'점 · '+number(moves)+'수','가장 큰 타일 '+number(highest)+' · 최고 연속 합치기 '+number(bestStreak)+'수',mode==='daily'?'같은 퍼즐에서 나와 한 판 어때요?':'한 수 더, 가볍게 즐겨봐요.',url.href].join('\n');
  return {title,text,url:url.href,mode:modeLabel(mode),day,score:number(score),moves:number(moves),highest:number(highest),streak:'×'+number(bestStreak)};
}
