// Display config. Change labels or the status vocabulary here only.
export const LINE_LABELS = 'ABCDEFGHIJKLMNOPQRS'.split(''); // exactly 19, in this order

// DB check constraint (contract, assumption A7). `label` is the word shown on the board.
export const STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'hold', label: 'On hold' },
  { value: 'ready', label: 'Ready' },
  { value: 'done', label: 'Done' },
];

export const POLL_MS = 3000; // the fallback while the feed is not confirmed: one cheap token probe per interval (src/core/store.js), so it can be quick
// While the realtime feed is confirmed live, one reconcile read this often (jittered, none while the tab is hidden). A board must never stay stale while it reads Live.
export const RECONCILE_MS = 15000;
export const LIMITS = { title: 120, details: 240, initials: 6 };
