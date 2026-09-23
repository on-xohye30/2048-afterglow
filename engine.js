/** Pure 2048 rules. All board-returning functions allocate a new array. */
function boardSize(board) {
  if (!Array.isArray(board) || (board.length !== 16 && board.length !== 25)) {
    throw new RangeError('Board must be a flat array of 16 (4x4) or 25 (5x5) tiles.');
  }
  for (let i = 0; i < board.length; i += 1) {
    const value = board[i];
    if (!Number.isSafeInteger(value) || value < 0 ||
        (value !== 0 && (value < 2 || 2 ** Math.round(Math.log2(value)) !== value))) {
      throw new TypeError('Each tile must be zero or a safe integer power of two, at least 2.');
    }
  }
  return Math.sqrt(board.length);
}

/**
 * Slide without spawning. Transitions include stationary tiles; both sources
 * of a merge have merged=true. Each merges entry names one resulting tile.
 */
export function slide(board, direction) {
  const size = boardSize(board);
  if (!['left', 'right', 'up', 'down'].includes(direction)) {
    throw new RangeError('Direction must be left, right, up, or down.');
  }
  const result = Array(board.length).fill(0);
  const merges = [];
  const transitions = [];
  let scoreGain = 0;
  const indexAt = (line, offset) => {
    if (direction === 'left') return line * size + offset;
    if (direction === 'right') return line * size + size - 1 - offset;
    if (direction === 'up') return offset * size + line;
    return (size - 1 - offset) * size + line;
  };
  for (let line = 0; line < size; line += 1) {
    const sources = [];
    for (let offset = 0; offset < size; offset += 1) {
      const from = indexAt(line, offset);
      if (board[from] !== 0) sources.push({ from, value: board[from] });
    }
    let destination = 0;
    for (let source = 0; source < sources.length;) {
      const current = sources[source];
      const next = sources[source + 1];
      const merged = Boolean(next && next.value === current.value);
      const to = indexAt(line, destination++);
      const value = current.value * (merged ? 2 : 1);
      if (!Number.isSafeInteger(value)) throw new RangeError('Merged tile exceeds safe integer range.');
      result[to] = value;
      transitions.push({ from: current.from, to, value: current.value, merged });
      if (merged) {
        transitions.push({ from: next.from, to, value: next.value, merged: true });
        merges.push(to);
        scoreGain += value;
      }
      source += merged ? 2 : 1;
    }
  }
  return {
    board: result,
    scoreGain,
    changed: result.some((value, index) => value !== board[index]),
    merges,
    transitions,
  };
}

/** Whether any direction would change the board. An all-zero board cannot move. */
export function canMove(board) {
  const size = boardSize(board);
  let hasEmpty = false;
  let hasTile = false;
  for (let index = 0; index < board.length; index += 1) {
    const value = board[index];
    if (value === 0) { hasEmpty = true; continue; }
    hasTile = true;
    if (index % size < size - 1 && board[index + 1] === value) return true;
    if (index + size < board.length && board[index + size] === value) return true;
  }
  return hasEmpty && hasTile;
}

function sample(rng) {
  if (typeof rng !== 'function') throw new TypeError('RNG must be a function.');
  const value = rng();
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('RNG must return a number in [0, 1).');
  }
  return value;
}

/** Draw empty position first, tile value second. A full board consumes no RNG. */
export function spawn(board, rng = Math.random) {
  boardSize(board);
  const result = board.slice();
  const empty = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] === 0) empty.push(index);
  }
  if (empty.length === 0) return { board: result, index: null, value: null };
  const index = empty[Math.floor(sample(rng) * empty.length)];
  const value = sample(rng) < 0.9 ? 2 : 4;
  result[index] = value;
  return { board: result, index, value };
}

export function createBoard(size = 4, rng = Math.random) {
  if (size !== 4 && size !== 5) throw new RangeError('Board size must be 4 or 5.');
  return spawn(spawn(Array(size * size).fill(0), rng).board, rng).board;
}

/**
 * 32-bit full-period linear congruential generator. State is the state before
 * the next draw, so createRng(rng.state) resumes the exact stream, including 0.
 */
export function createRng(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('RNG seed must be an unsigned 32-bit integer.');
  }
  let state = seed >>> 0;
  const rng = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  Object.defineProperty(rng, 'state', { get: () => state, enumerable: true });
  return rng;
}

export function maxTile(board) {
  boardSize(board);
  return Math.max(...board);
}
