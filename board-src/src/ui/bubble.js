// v2: the default moved from bottom-right (over line S) into the header band; old saved positions would keep covering rows.
const KEY = 'rhl.bubble.v3';
const MARGIN = 8;

// Keeps a w x h box fully inside the viewport.
export function clampPos(x, y, w, h, vw, vh, margin = MARGIN) {
  const cl = (v, max) => Math.max(margin, Math.min(v, Math.max(margin, max - margin)));
  return { x: cl(x, vw - w), y: cl(y, vh - h) };
}

// The bubble floats over the board: centre-bottom of the viewport until it is moved, and where it was left after that.
export function initBubble(bubble, grip) {
  let pos = null;
  try { pos = JSON.parse(localStorage.getItem(KEY)); } catch { /* none saved */ }
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) pos = null;

  const place = () => {
    const r = bubble.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const p = pos ?? { x: (vw - r.width) / 2, y: vh - r.height - MARGIN }; // the dock under the board (styles.css, .app)
    const c = clampPos(p.x, p.y, r.width, r.height, vw, vh);
    bubble.style.left = `${c.x}px`;
    bubble.style.top = `${c.y}px`;
    return c;
  };
  const save = (c) => {
    pos = c;
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private mode */ }
  };
  const moveBy = (dx, dy) => {
    const r = bubble.getBoundingClientRect();
    pos = { x: r.left + dx, y: r.top + dy };
    save(place());
  };

  place();
  addEventListener('resize', place);
  const ro = new ResizeObserver(place); // a taller bubble or a header change moves its home: keep it placed
  ro.observe(bubble);

  let drag = null;
  bubble.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target.closest('input,button,select,textarea,label') && e.target !== grip && !grip.contains(e.target))) return;
    const r = bubble.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    bubble.setPointerCapture(e.pointerId);
    bubble.classList.add('dragging');
  });
  bubble.addEventListener('pointermove', (e) => {
    if (!drag) return;
    pos = { x: e.clientX - drag.dx, y: e.clientY - drag.dy };
    place();
  });
  const end = (e) => {
    if (!drag) return;
    drag = null;
    bubble.classList.remove('dragging');
    save(place());
  };
  bubble.addEventListener('pointerup', end);
  bubble.addEventListener('pointercancel', end);

  grip.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 48 : 12;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    moveBy(...d);
  });
}
