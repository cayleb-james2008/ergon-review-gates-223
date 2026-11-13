// Per-row density: a line whose jobs would not fit at the normal card width switches its cards to the compact card (one line: customer, status glyph,
// initials tint). No manual switch; the choice is a pure function of the job count and the width the row has, so the same data gives the same board.
export const NORMAL_MIN = 250; // narrowest normal card, px: measured at 1366 and 1920 (round 6), a 190px card left the customer 25 to 42px (1 to 4 characters); at 250px it keeps about 100px (10 or more characters) next to the status word and the initials
export const GAP = 4;
export const LABEL_COL = 64 + 8; // the bay marker column and the row's own padding
export const ADD_WIDE = 112;   // the row's "Add job" with its label
export const ADD_ICON = 44;    // the plus alone (a mid-width row, see styles.css), also the touch target
export const ICON_BELOW = 1280; // the row width under which Add job drops its label (keep in step with the @container rule in styles.css)
export const PHONE = 700;       // phones keep one job per swipe, never compact

// how many normal cards a row of this inner width holds next to its Add job
export function capacity(rowWidth) {
  const add = rowWidth <= ICON_BELOW ? ADD_ICON : ADD_WIDE;
  return Math.max(1, Math.floor((rowWidth - add) / (NORMAL_MIN + GAP)));
}

// boardWidth = the board's client width; viewport = the window width
export function isCompact(jobCount, boardWidth, viewport) {
  if (viewport <= PHONE) return false;
  return jobCount > capacity(boardWidth - LABEL_COL);
}
