// The four status glyphs and the select chevron as ready-made SVG strings. The geometry is lucide's (circle, circle-pause, circle-check, check,
// chevron-down from lucide-react 1.66.0, ISC licence, see docs/LIBRARIES.md), written out once so a card costs one innerHTML parse instead of a React
// icon component per glyph: 60 cards with two glyphs each were most of the 4x-CPU cost of a full render. One stroke (2), one size (set in CSS).
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const disc = '<circle cx="12" cy="12" r="10"/>';

// a different glyph SHAPE per status, so colour is never the only cue: circle, pause in circle, check in circle, bare check
export const GLYPHS = {
  open: svg(disc),
  hold: svg(`${disc}<line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/>`),
  ready: svg(`${disc}<path d="m16 9-5.5 5.5L8 12"/>`),
  done: svg('<path d="M20 6 9 17l-5-5"/>'),
};
export const CHEVRON = svg('<path d="m6 9 6 6 6-6"/>');
