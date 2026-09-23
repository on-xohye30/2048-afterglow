import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// This loader works even before package.json declares type:module.
const source = await readFile(new URL('./engine.js', import.meta.url), 'utf8');
const module = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const { slide, canMove, spawn, createBoard, createRng, maxTile } = module;
const directions = ['left', 'right', 'up', 'down'];
const sum = board => board.reduce((total, value) => total + value, 0);
const blank = (size = 4) => Array(size * size).fill(0);
function lineIndex(size, direction, line, offset) {
  switch (direction) {
    case 'left': return line * size + offset;
    case 'right': return line * size + size - 1 - offset;
    case 'up': return offset * size + line;
    case 'down': return (size - 1 - offset) * size + line;
  }
}
function referenceLine(values) {
  // Independent merge-locked stack oracle rather than engine pair scanning.
  const stack = [];
  let score = 0;
  for (const value of values) {
    if (!value) continue;
    const last = stack.at(-1);
    if (last && !last.locked && last.value === value) {
      last.value += value;
      last.locked = true;
      score += last.value;
    } else stack.push({ value, locked: false });
  }
  return { values: stack.map(tile => tile.value).concat(Array(values.length - stack.length).fill(0)), score };
}
function verify(board, direction, result) {
  const size = Math.sqrt(board.length);
  assert.notEqual(result.board, board);
  assert.equal(result.board.length, board.length);
  assert.equal(sum(result.board), sum(board));
  assert.equal(result.changed, board.some((value, index) => value !== result.board[index]));
  const occupied = board.flatMap((value, index) => value ? [index] : []);
  assert.equal(result.transitions.length, occupied.length);
  assert.deepEqual(result.transitions.map(t => t.from).sort((a, b) => a - b), occupied);
  const contributions = blank(size);
  const destinations = new Map();
  for (const t of result.transitions) {
    assert.deepEqual(Object.keys(t).sort(), ['from', 'merged', 'to', 'value']);
    assert.equal(t.value, board[t.from]);
    assert.equal(typeof t.merged, 'boolean');
    assert.ok(Number.isInteger(t.to) && t.to >= 0 && t.to < board.length);
    if (direction === 'left' || direction === 'right') {
      assert.equal(Math.floor(t.from / size), Math.floor(t.to / size));
      assert.ok(direction === 'left' ? t.to <= t.from : t.to >= t.from);
    } else {
      assert.equal(t.from % size, t.to % size);
      assert.ok(direction === 'up' ? t.to <= t.from : t.to >= t.from);
    }
    contributions[t.to] += t.value;
    if (!destinations.has(t.to)) destinations.set(t.to, []);
    destinations.get(t.to).push(t);
  }
  assert.deepEqual(contributions, result.board);
  const actualMerges = [];
  for (const [to, tiles] of destinations) {
    assert.ok(tiles.length === 1 || tiles.length === 2);
    assert.ok(tiles.every(tile => tile.merged === (tiles.length === 2)));
    if (tiles.length === 2) {
      assert.equal(tiles[0].value, tiles[1].value);
      actualMerges.push(to);
    }
  }
  assert.equal(new Set(result.merges).size, result.merges.length);
  assert.deepEqual([...result.merges].sort((a, b) => a - b), actualMerges.sort((a, b) => a - b));
  assert.equal(result.scoreGain, result.merges.reduce((score, index) => score + result.board[index], 0));
  assert.ok(result.board.every(value => value === 0 || (value >= 2 && 2 ** Math.round(Math.log2(value)) === value)));
  for (let line = 0; line < size; line++) {
    const before = Array.from({ length: size }, (_, offset) => board[lineIndex(size, direction, line, offset)]);
    const expected = referenceLine(before);
    const after = Array.from({ length: size }, (_, offset) => result.board[lineIndex(size, direction, line, offset)]);
    assert.deepEqual(after, expected.values);
  }
}

test('exports exactly the documented six functions', () => {
  assert.deepEqual(Object.keys(module).sort(), ['canMove', 'createBoard', 'createRng', 'maxTile', 'slide', 'spawn']);
});
for (const direction of directions) {
  test(direction + ': four identical tiles become two tiles, with explicit destinations', () => {
    const board = blank();
    for (let offset = 0; offset < 4; offset++) board[lineIndex(4, direction, 1, offset)] = 2;
    const result = slide(Object.freeze(board), direction);
    const destinations = [lineIndex(4, direction, 1, 0), lineIndex(4, direction, 1, 1)];
    assert.deepEqual(result.merges, destinations);
    assert.equal(result.scoreGain, 8);
    assert.equal(result.board[destinations[0]], 4);
    assert.equal(result.board[destinations[1]], 4);
    verify(board, direction, result);
  });
}

test('hard-coded directional results on an asymmetric board', () => {
  const board = [2, 0, 2, 4, 4, 4, 0, 4, 0, 2, 2, 0, 8, 0, 8, 8];
  const expected = {
    left: [4, 4, 0, 0, 8, 4, 0, 0, 4, 0, 0, 0, 16, 8, 0, 0],
    right: [0, 0, 4, 4, 0, 0, 4, 8, 0, 0, 0, 4, 0, 0, 8, 16],
    up: [2, 4, 4, 8, 4, 2, 8, 8, 8, 0, 0, 0, 0, 0, 0, 0],
    down: [0, 0, 0, 0, 2, 0, 0, 0, 4, 4, 4, 8, 8, 2, 8, 8],
  };
  for (const direction of directions) {
    const result = slide(board, direction);
    assert.deepEqual(result.board, expected[direction]);
    verify(board, direction, result);
  }
});

test('merge order, gaps, distinct neighbors, and no double merge', () => {
  const cases = [
    [[2, 2, 4, 0], [4, 4, 0, 0], 4],
    [[4, 2, 2, 0], [4, 4, 0, 0], 4],
    [[2, 2, 2, 0], [4, 2, 0, 0], 4],
    [[0, 2, 0, 2], [4, 0, 0, 0], 4],
    [[2, 4, 4, 2], [2, 8, 2, 0], 8],
    [[4, 4, 8, 8], [8, 16, 0, 0], 24],
    [[2, 4, 8, 16], [2, 4, 8, 16], 0],
  ];
  for (const [before, after, score] of cases) {
    const board = before.concat(Array(12).fill(0));
    const result = slide(board, 'left');
    assert.deepEqual(result.board, after.concat(Array(12).fill(0)));
    assert.equal(result.scoreGain, score);
    verify(board, 'left', result);
  }
  assert.deepEqual(slide([2, 2, 2, 0, ...Array(12).fill(0)], 'right').board.slice(0, 4), [0, 0, 2, 4]);
});

test('stationary tiles appear in transitions, including the stationary merge source', () => {
  const board = [2, 2, 4, 0, ...Array(12).fill(0)];
  assert.deepEqual(slide(board, 'left').transitions, [
    { from: 0, to: 0, value: 2, merged: true },
    { from: 1, to: 0, value: 2, merged: true },
    { from: 2, to: 1, value: 4, merged: false },
  ]);
  const still = [2, 4, 0, 0, ...Array(12).fill(0)];
  const result = slide(still, 'left');
  assert.equal(result.changed, false);
  assert.deepEqual(result.transitions, [
    { from: 0, to: 0, value: 2, merged: false },
    { from: 1, to: 1, value: 4, merged: false },
  ]);
});

test('5x5 merges and scores correctly', () => {
  const board = [2, 2, 2, 2, 2, ...Array(20).fill(0)];
  const result = slide(board, 'left');
  assert.deepEqual(result.board, [4, 4, 2, 0, 0, ...Array(20).fill(0)]);
  assert.equal(result.scoreGain, 8);
  verify(board, 'left', result);
});

test('empty and blocked boards are no-ops; full boards may still merge', () => {
  for (const size of [4, 5]) {
    const empty = blank(size);
    const blocked = empty.map((_, i) => ((Math.floor(i / size) + i % size) % 2 ? 4 : 2));
    assert.equal(canMove(empty), false);
    assert.equal(canMove(blocked), false);
    for (const direction of directions) {
      for (const board of [empty, blocked]) {
        const result = slide(board, direction);
        assert.equal(result.changed, false);
        assert.equal(result.scoreGain, 0);
        assert.deepEqual(result.merges, []);
        verify(board, direction, result);
      }
    }
    const horizontal = blocked.slice(); horizontal[1] = horizontal[0];
    const vertical = blocked.slice(); vertical[size] = vertical[0];
    assert.equal(canMove(horizontal), true);
    assert.equal(canMove(vertical), true);
    const space = blocked.slice(); space[0] = 0;
    assert.equal(canMove(space), true);
    const single = blank(size); single[0] = 2;
    assert.equal(canMove(single), true);
  }
});

test('spawn selects each empty interval uniformly and respects 90/10 boundary', () => {
  const board = Object.freeze([0, 2, 4, 0, 8, 16, 32, 64, 0, 2, 4, 8, 16, 0, 2, 4]);
  const empties = [0, 3, 8, 13];
  for (let choice = 0; choice < empties.length; choice++) {
    for (const [draw, value] of [[0, 2], [0.899999999, 2], [0.9, 4], [0.999999999, 4]]) {
      const draws = [(choice + 0.5) / empties.length, draw];
      const result = spawn(board, () => draws.shift());
      assert.equal(result.index, empties[choice]);
      assert.equal(result.value, value);
      assert.equal(draws.length, 0);
      assert.notEqual(result.board, board);
      const expected = [...board]; expected[result.index] = value;
      assert.deepEqual(result.board, expected);
    }
  }
  const draws = [1 - Number.EPSILON, 0];
  assert.equal(spawn(blank(), () => draws.shift()).index, 15);
  assert.equal(spawn(blank(), () => 0).index, 0);
});

test('full spawn is immutable and consumes no RNG', () => {
  const full = Object.freeze(Array(25).fill(2));
  const result = spawn(full, () => { throw new Error('Must not draw'); });
  assert.deepEqual(result, { board: [...full], index: null, value: null });
  assert.notEqual(result.board, full);
});

test('createBoard places exactly two distinct tiles on either supported size', () => {
  assert.equal(createBoard().length, 16);
  for (const size of [4, 5]) {
    let calls = 0;
    const board = createBoard(size, () => { calls++; return 0; });
    assert.equal(calls, 4);
    assert.deepEqual(board, [2, 2, ...Array(size * size - 2).fill(0)]);
    for (let seed = 0; seed < 100; seed++) {
      const seeded = createBoard(size, createRng(seed));
      assert.equal(seeded.filter(Boolean).length, 2);
      assert.ok(seeded.every(value => [0, 2, 4].includes(value)));
    }
  }
});

test('RNG range, reproducibility, uint state, and persistence at every checkpoint', () => {
  for (const seed of [0, 1, 42, 0x80000000, 0xffffffff]) {
    const a = createRng(seed), b = createRng(seed);
    assert.equal(a.state, seed);
    for (let i = 0; i < 1000; i++) {
      const saved = a.state;
      const resumed = createRng(saved);
      const value = a();
      assert.ok(value >= 0 && value < 1);
      assert.equal(value, b());
      assert.equal(value, resumed());
      assert.equal(a.state, resumed.state);
      assert.equal(a.state, a.state >>> 0);
    }
  }
  assert.notDeepEqual(Array.from({ length: 10 }, createRng(1)), Array.from({ length: 10 }, createRng(2)));
  const rng = createRng(31);
  const board = createBoard(5, rng);
  const resumed = createRng(rng.state);
  assert.deepEqual(spawn(board, rng), spawn(board, resumed));
});

test('maxTile handles zero, large tiles, and both sizes', () => {
  assert.equal(maxTile(blank()), 0);
  assert.equal(maxTile([2, 2048, 65536, ...Array(13).fill(0)]), 65536);
  assert.equal(maxTile([...Array(24).fill(2), 4096]), 4096);
});

test('clear validation rejects bad boards, sizes, directions, RNG seeds and draws', () => {
  for (const board of [null, {}, new Uint16Array(16), [], Array(9).fill(0), Array(36).fill(0)]) {
    for (const fn of [b => slide(b, 'left'), canMove, spawn, maxTile]) assert.throws(() => fn(board), /Board/);
  }
  for (const size of [0, 3, 6, '4', 4.5, null]) assert.throws(() => createBoard(size), /size/);
  for (const direction of ['LEFT', '', 'diagonal', undefined, null, 0]) assert.throws(() => slide(blank(), direction), /Direction/);
  for (const value of [-2, 1, 3, 2.5, NaN, Infinity, '2', undefined, 2 ** 49 - 1]) {
    const board = blank(); board[0] = value;
    assert.throws(() => slide(board, 'left'), /tile/);
  }
  assert.throws(() => maxTile(Array(16)), /tile/);
  for (const seed of [-1, 2 ** 32, NaN, Infinity, 0.5, '1', undefined]) assert.throws(() => createRng(seed), /seed/);
  for (const draw of [-0.1, 1, NaN, Infinity, undefined, '0.5']) assert.throws(() => spawn(blank(), () => draw), /RNG/);
  assert.throws(() => spawn(blank(), null), /RNG/);
  assert.throws(() => slide([2 ** 52, 2 ** 52, ...Array(14).fill(0)], 'left'), /safe integer/);
});

test('exhaustive line configurations, all directions, both board sizes', () => {
  let configurations = 0;
  for (const size of [4, 5]) {
    const alphabet = [0, 2, 4, 8, 16];
    for (let code = 0; code < alphabet.length ** size; code++) {
      let remaining = code;
      const values = Array.from({ length: size }, () => {
        const value = alphabet[remaining % alphabet.length];
        remaining = Math.floor(remaining / alphabet.length);
        return value;
      });
      const expected = referenceLine(values);
      for (const direction of directions) {
        const board = blank(size);
        for (let offset = 0; offset < size; offset++) board[lineIndex(size, direction, size - 1, offset)] = values[offset];
        const before = [...board];
        const result = slide(Object.freeze(board), direction);
        verify(board, direction, result);
        assert.equal(result.scoreGain, expected.score);
        assert.deepEqual(board, before);
        configurations++;
      }
    }
  }
  assert.equal(configurations, 15000);
});

test('randomized full-board invariants and canMove equivalence', () => {
  const rng = createRng(0xc0ffee);
  for (const size of [4, 5]) {
    for (let trial = 0; trial < 500; trial++) {
      const board = Object.freeze(Array.from({ length: size * size }, () => {
        const exponent = Math.floor(rng() * 8);
        return exponent === 0 ? 0 : 2 ** exponent;
      }));
      const before = [...board];
      const results = directions.map(direction => {
        const result = slide(board, direction);
        verify(board, direction, result);
        return result;
      });
      assert.equal(canMove(board), results.some(result => result.changed));
      assert.deepEqual(board, before);
      const spawned = spawn(board, rng);
      assert.equal(sum(spawned.board), sum(board) + (spawned.value ?? 0));
      assert.equal(spawned.board.filter(Boolean).length, board.filter(Boolean).length + (spawned.index === null ? 0 : 1));
    }
  }
});

test('deterministic multi-turn games preserve invariants through slide and spawn', () => {
  for (const size of [4, 5]) {
    const rng = createRng(size);
    let board = createBoard(size, rng);
    for (let turn = 0; turn < 500 && canMove(board); turn++) {
      const direction = directions[Math.floor(rng() * directions.length)];
      const result = slide(board, direction);
      verify(board, direction, result);
      board = result.changed ? spawn(result.board, rng).board : result.board;
    }
  }
});
