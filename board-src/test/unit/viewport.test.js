import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackVisualViewport } from '../../src/ui/viewport.js';

test('the visual viewport height and top follow the keyboard, and stop when the tracker is removed', () => {
  const props = new Map();
  const root = { style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) } };
  const listeners = {};
  const vv = { height: 844, offsetTop: 0, addEventListener: (e, f) => { listeners[e] = f; }, removeEventListener: (e) => { delete listeners[e]; } };
  const stop = trackVisualViewport(root, vv);
  assert.deepEqual([props.get('--vv-h'), props.get('--vv-top')], ['844px', '0px']);
  vv.height = 508; vv.offsetTop = 12; listeners.resize();
  assert.deepEqual([props.get('--vv-h'), props.get('--vv-top')], ['508px', '12px'], 'a keyboard opening shrinks the area');
  stop();
  assert.equal(props.size, 0);
  assert.deepEqual(Object.keys(listeners), []);
  assert.equal(typeof trackVisualViewport(root, null), 'function', 'no visualViewport: a harmless no-op');
});
