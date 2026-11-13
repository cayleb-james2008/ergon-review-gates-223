import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, filterBoard, sortEntries, isStatus, statusLabel } from '../../src/core/lines.js';
import { LINE_LABELS, STATUSES } from '../../src/config.js';

const mk = (labels) => labels.map((code, i) => ({ id: `L${code}`, code, sort_order: i + 1, is_test: true }));

test('19 rows A..S in config order even if the DB returns them shuffled', () => {
  const lines = mk(LINE_LABELS).reverse();
  const { rows, warning } = buildRows(LINE_LABELS, lines, []);
  assert.equal(rows.length, 19);
  assert.equal(rows.map((r) => r.label).join(''), 'ABCDEFGHIJKLMNOPQRS');
  assert.equal(warning, '');
});

test('missing DB line still renders its row and raises the count warning', () => {
  const { rows, warning, missing } = buildRows(LINE_LABELS, mk(LINE_LABELS.filter((l) => l !== 'F')), []);
  assert.equal(rows.length, 19);
  assert.equal(rows[5].line, null);
  assert.deepEqual(missing, ['F']);
  assert.equal(warning, 'Only 18 of 19 lines are set up.');
});

test('zero DB lines: 19 rows, warning "0 of 19"', () => {
  const b = buildRows(LINE_LABELS, [], []);
  assert.equal(b.rows.length, 19);
  assert.equal(b.warning, 'Only 0 of 19 lines are set up.');
});

test('entries group by line and sort by created_at then id', () => {
  const lines = mk(LINE_LABELS);
  const entries = [
    { id: 'c', line_id: 'LA', created_at: '2026-01-03' },
    { id: 'b', line_id: 'LA', created_at: '2026-01-02' },
    { id: 'a2', line_id: 'LA', created_at: '2026-01-01' },
    { id: 'a1', line_id: 'LA', created_at: '2026-01-01' },
    { id: 'z', line_id: 'LB', created_at: '2026-01-01' },
  ];
  const { rows } = buildRows(LINE_LABELS, lines, entries);
  assert.deepEqual(rows[0].jobs.map((j) => j.id), ['a1', 'a2', 'b', 'c']);
  assert.deepEqual(rows[1].jobs.map((j) => j.id), ['z']);
  assert.equal(sortEntries(entries)[0].id, 'a1');
});

test('a null/empty title and details do not break the filter', () => {
  const { rows } = buildRows(LINE_LABELS, mk(['A']), [{ id: '1', line_id: 'LA', title: null, details: null, initials: 'AB', status: 'open' }]);
  assert.equal(filterBoard(rows, 'ab').count, 1);
  assert.equal(filterBoard(rows, 'null').count, 0);
});

test('hasTest is true when any row is flagged test, false otherwise', () => {
  assert.equal(buildRows(LINE_LABELS, mk(['A']), []).hasTest, true);
  assert.equal(buildRows(LINE_LABELS, [{ id: '1', code: 'A', is_test: false }], []).hasTest, false);
  assert.equal(buildRows(LINE_LABELS, [{ id: '1', code: 'A', is_test: false }], [{ id: 'e', line_id: '1', is_test: true }]).hasTest, true);
});

test('search: matches title/details/initials/status/line, empty query clears', () => {
  const lines = mk(LINE_LABELS);
  const entries = [
    { id: '1', line_id: 'LA', title: 'TEST Harbour', details: 'chilled', initials: 'AB', status: 'open' },
    { id: '2', line_id: 'LB', title: 'TEST Alder', details: '', initials: 'CD', status: 'hold' },
  ];
  const { rows } = buildRows(LINE_LABELS, lines, entries);
  const f = filterBoard(rows, 'harb');
  assert.deepEqual([...f.jobIds], ['1']);
  assert.deepEqual([...f.lineLabels], ['A']);
  assert.deepEqual([...filterBoard(rows, 'on hold').jobIds], ['2']);
  assert.deepEqual([...filterBoard(rows, 'cd').jobIds], ['2']);
  assert.deepEqual([...filterBoard(rows, 'b').lineLabels].sort(), ['A', 'B']); // Harbour matches 'b'; the query also names line B
  assert.equal(filterBoard(rows, '   '), null);
  assert.equal(filterBoard(rows, 'nomatch').count, 0);
});

test('searching a line label highlights that line', () => {
  const { rows } = buildRows(LINE_LABELS, mk(LINE_LABELS), [{ id: '1', line_id: 'LC', title: 'x', status: 'open' }]);
  const f = filterBoard(rows, 'c');
  assert.ok(f.lineLabels.has('C'));
});

test('status vocabulary matches the DB check constraint and shows words', () => {
  assert.deepEqual(STATUSES.map((s) => s.value), ['open', 'hold', 'ready', 'done']);
  assert.ok(isStatus('ready'));
  assert.ok(!isStatus('Ready'));
  assert.ok(!isStatus('shipped'));
  assert.equal(statusLabel('hold'), 'On hold');
  assert.equal(statusLabel('weird'), 'weird');
});
