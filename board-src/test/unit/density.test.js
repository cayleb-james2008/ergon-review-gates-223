import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capacity, isCompact, NORMAL_MIN, GAP } from '../../src/core/density.js';

// board width = viewport minus the 24px page padding each side
const board = (vw) => vw - 48;

test('normal cards hold up to the stated count per line; one more switches the whole line to compact cards', () => {
  assert.ok(NORMAL_MIN >= 240 && GAP === 4);
  // 1920: rows of 6 keep normal cards, 7 go compact. 1366: 4 keep normal, 5 go compact (round 6: a normal card must leave the customer about 10 characters).
  assert.equal(isCompact(6, board(1920), 1920), false);
  assert.equal(isCompact(7, board(1920), 1920), true);
  assert.equal(isCompact(4, board(1366), 1366), false);
  assert.equal(isCompact(5, board(1366), 1366), true);
});

test('60 jobs over 19 lines (about 3 per line, up to 4 on a busy one) keep normal cards at both wall sizes; 200 jobs (about 10 per line) go compact', () => {
  for (const vw of [1920, 1366]) {
    assert.equal(isCompact(4, board(vw), vw), false, `4 per line at ${vw}`);
    assert.equal(isCompact(11, board(vw), vw), true, `11 per line at ${vw}`);
  }
});

test('phones never go compact (they swipe one card at a time); the choice is a pure function of count and width', () => {
  assert.equal(isCompact(40, 390 - 16, 390), false);
  assert.equal(isCompact(12, board(1366), 1366), isCompact(12, board(1366), 1366));
  assert.ok(capacity(1000) < capacity(1500));
  assert.ok(capacity(100) >= 1);
});
