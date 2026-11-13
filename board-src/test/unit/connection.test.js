import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialConn, reduce, status, nextDelay, backoffMs, canEdit, LABELS } from '../../src/core/connection.js';

const run = (...evs) => evs.reduce(reduce, initialConn());

test('starts as polling until realtime reports SUBSCRIBED', () => {
  assert.equal(status(initialConn()), 'polling');
  assert.equal(status(run({ type: 'realtime', status: 'SUBSCRIBED' })), 'live');
});

test('live <-> polling when the realtime channel drops and returns', () => {
  let c = run({ type: 'fetchOk' }, { type: 'realtime', status: 'SUBSCRIBED' });
  assert.equal(status(c), 'live');
  assert.equal(nextDelay(c, 4000), null);
  c = reduce(c, { type: 'realtime', status: 'CLOSED' });
  assert.equal(status(c), 'polling');
  assert.equal(nextDelay(c, 4000), 4000);
  c = reduce(c, { type: 'realtime', status: 'SUBSCRIBED' });
  assert.equal(status(c), 'live');
});

test('offline wins, stops polling, and recovers on the online event', () => {
  let c = run({ type: 'fetchOk' }, { type: 'realtime', status: 'SUBSCRIBED' }, { type: 'offline' });
  assert.equal(status(c), 'offline');
  assert.equal(nextDelay(c, 4000), null);
  assert.equal(canEdit(c), false);
  c = reduce(c, { type: 'online' });
  assert.equal(status(c), 'live');
  assert.equal(canEdit(c), true);
});

test('failed fetches: error first, offline after 3 with a board, recovery on first success', () => {
  let c = run({ type: 'fetchOk' }, { type: 'realtime', status: 'SUBSCRIBED' }, { type: 'fetchFail' });
  assert.equal(status(c), 'error');
  assert.equal(canEdit(c), false);
  c = reduce(reduce(c, { type: 'fetchFail' }), { type: 'fetchFail' });
  assert.equal(status(c), 'offline');
  c = reduce(c, { type: 'fetchOk' });
  assert.equal(status(c), 'live');
});

test('failures with no board ever loaded stay "error" (never offline)', () => {
  const c = run({ type: 'fetchFail' }, { type: 'fetchFail' }, { type: 'fetchFail' }, { type: 'fetchFail' });
  assert.equal(status(c), 'error');
});

test('backoff grows and caps; error state schedules retries', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(backoffMs), [2000, 4000, 8000, 16000, 30000, 30000]);
  const c = run({ type: 'fetchFail' }, { type: 'fetchFail' });
  assert.equal(nextDelay(c, 4000), 4000);
});

test('labels are the four required words', () => {
  assert.deepEqual(Object.values(LABELS), ['Live', 'Reconnecting', 'Offline', 'Error']);
});
