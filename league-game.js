import { createBoard, createRng } from './engine.js';
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{24,64}$/.test(value);
const directions = new Set(['left','right','up','down']);
export function validRun(run) {
  return Boolean(run && id(run.id) && id(run.roomId) && id(run.userId) &&
    /^\d{4}-\d{2}-\d{2}$/.test(run.day) && Number.isInteger(run.seed) && run.seed>=0 && run.seed<=0xffffffff &&
    Number.isSafeInteger(run.createdAt) && run.createdAt>=0);
}
export function createRankedState(run) {
  if(!validRun(run))throw new TypeError('Invalid server run');
  const rng=createRng(run.seed);
  return {board:createBoard(4,rng),score:0,moves:0,seed:rng.state,streak:0,bestStreak:0,undoUsed:0,history:[],won:false,continued:false,over:false,run:{id:run.id,roomId:run.roomId,userId:run.userId,day:run.day,seed:run.seed,createdAt:run.createdAt},trace:[],submitted:false};
}
export function rankedAttempt(state) {
  if(!validRun(state?.run) || !Array.isArray(state.trace) || state.trace.length>10000 || state.trace.some(value=>!directions.has(value)))return null;
  return {...state.run,moves:[...state.trace],submitted:Boolean(state.submitted)};
}
