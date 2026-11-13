import { STATUSES, LINE_LABELS } from '../config.js';

export const isStatus = (v) => STATUSES.some((s) => s.value === v);
export const statusLabel = (v) => STATUSES.find((s) => s.value === v)?.label ?? String(v || 'Unknown');

export function sortEntries(entries) {
  return [...entries].sort(
    (a, b) =>
      String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) ||
      String(a.id).localeCompare(String(b.id)),
  );
}

// Always returns one row per configured label (config order), merged with DB lines by label.
export function buildRows(labels, lines, entries) {
  const byLabel = new Map(lines.map((l) => [l.code, l]));
  const sorted = sortEntries(entries);
  const rows = labels.map((label) => {
    const line = byLabel.get(label) ?? null;
    return { label, line, jobs: line ? sorted.filter((e) => e.line_id === line.id) : [] };
  });
  return {
    rows,
    dbLineCount: lines.length,
    missing: rows.filter((r) => !r.line).map((r) => r.label),
    warning: lines.length === labels.length ? '' : `Only ${lines.length} of ${labels.length} lines are set up.`,
    hasTest: lines.some((l) => l.is_test) || entries.some((e) => e.is_test),
  };
}

export const emptyRows = () => buildRows(LINE_LABELS, [], []);

// Live filter. Returns null for an empty query, else {jobIds:Set, lineLabels:Set, count}.
export function filterBoard(rows, query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const jobIds = new Set();
  const lineLabels = new Set();
  for (const row of rows) {
    const lineHit = row.label.toLowerCase() === q;
    for (const j of row.jobs) {
      const hay = `${j.title ?? ''} ${j.details ?? ''} ${j.initials ?? ''} ${statusLabel(j.status)} ${j.status}`.toLowerCase();
      if (lineHit || hay.includes(q)) {
        jobIds.add(j.id);
        lineLabels.add(row.label);
      }
    }
    if (lineHit) lineLabels.add(row.label);
  }
  return { jobIds, lineLabels, count: jobIds.size };
}
