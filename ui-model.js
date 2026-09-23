// Public score sharing carries only the mode/date and a fresh-game entry flag.
export const SERVICE_NAME = '2048_plusplus';
const labels = {classic:'클래식 4×4',daily:'오늘의 도전',zen:'여유 모드 5×5',league:'친구 대결'};
export const modeLabel = mode => labels[mode] || labels.classic;
export function shareRecord({mode,day,score,moves,highest,bestStreak},href) {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  // Public score sharing never exposes private invitation or account parameters.
  const targetMode = mode === 'league' ? 'daily' : Object.hasOwn(labels,mode) ? mode : 'classic';
  url.searchParams.set('play','1');
  url.searchParams.set('mode',targetMode);
  if (targetMode === 'daily') url.searchParams.set('date',day);
  const number = n => Number(n).toLocaleString('ko-KR');
  const title = SERVICE_NAME+' · '+modeLabel(mode);
  const text = [title+(targetMode==='daily'?' ('+day+')':''),number(score)+'점 · '+number(moves)+'수 · 타일 '+number(highest),targetMode==='daily'?'같은 퍼즐, 새 판으로 도전해요.':'새 판으로 도전해요.',url.href].join('\n');
  return {title,text,url:url.href,mode:modeLabel(mode),day,score:number(score),moves:number(moves),highest:number(highest),streak:'×'+number(bestStreak)};
}
