// data/fixtures.ts — the Ergon product's own content (IA carried from the real Ergon build, m-0138;
// the retired dark look and the retired named persona are gone — the agent is "Your agent").
//
// The agent's replies come from the NAMED FIXTURE reply engine at the bottom of this file: no live
// agent runtime exists in this build, nothing here pretends to be one, and the surface labels it
// ("fixture reply engine — no live agent runtime") on both faces (Ticket 061 allows a fixture agent
// only when it is named as fixture).

export type TaskState = 'working' | 'waiting' | 'done';
export type CallTurnView = { who: 'agent' | 'truck'; label: string; text: string };
export type MsgCard =
  | { kind: 'call'; status: 'dialing' | 'live' | 'done'; callee: string; number: string; turns: CallTurnView[]; simulated: true; ended?: string }
  | { kind: 'job'; ref: string; title: string; rows: { label: string; value: string }[]; note: string; line: string }
  | { kind: 'skill'; name: string; version: string; role: string; summary: string; published: boolean }
  | { kind: 'offer'; text: string; action: string; done: boolean };
export type Msg = { id: string; from: 'agent' | 'you'; text: string; tag?: 'needs-you'; at: number; fixture?: boolean; card?: MsgCard };
export type Task = { id: string; title: string; state: TaskState; last: string; at: number };
export type DecisionOutcome = 'approved' | 'denied';
export type Decision = {
  id: string; approvalId: string; title: string; scope: string;
  outcome: DecisionOutcome; at: number; note: string;
  /** approval = a grant acted on in the thread; signoff = a waiting task signed off in place */
  kind?: 'approval' | 'signoff';
};
export type Approval = { id: string; tag: string; title: string; body: string; scope: string; expires: string; klass: string };
export type Settings = {
  displayName: string;
  agentTone: 'concise' | 'detailed';
  briefAt: string;
  density: 'comfortable' | 'compact';
  motion: 'full' | 'reduced';
};

export type AppTab = { id: string; name: string; desc: string; rows: { id: string; label: string; value: string; state?: string }[] };

/** The product's DEMO CLOCK. The brief and the seeded message timestamps belong to the fixture's
 *  8 Nov 2026 late-morning; the next-brief line is computed from this same clock, never from the
 *  wall clock, so the first card cannot read as current when it is not. 8 Nov 2026 is a Sunday. */
export const DEMO_NOW = new Date(2026, 10, 8, 12, 0, 0, 0).getTime();
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function demoDateLabel(t: number = DEMO_NOW): string {
  const d = new Date(t);
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}`;
}
export const BRIEF = {
  title: `Morning brief — ${demoDateLabel()}`,
};

/** The brief's figures are DERIVED from the app's own live state — never a fixed copy. The needs-you
 *  line counts every item that waits on the owner: pending approvals PLUS tasks in the waiting state
 *  (the row the Tasks board prints under "Needs your decision"). The can-wait line counts the tasks in
 *  progress and the artefacts in Make. (Review finding: the brief used to count only the approval while
 *  a waiting task also needed the owner — it undercounted by one.) */
export function briefLines(
  counts: { approvals: number; waiting: number; working: number; makes: number },
  briefAt = '07:30',
): string[] {
  const needs = counts.approvals + counts.waiting;
  const parts: string[] = [];
  if (counts.approvals > 0) parts.push(`${counts.approvals} approval${counts.approvals === 1 ? '' : 's'}`);
  if (counts.waiting > 0) parts.push(`${counts.waiting} task${counts.waiting === 1 ? '' : 's'} waiting on your sign-off`);
  const needsLine = needs === 0
    ? 'Needs you now: nothing — the queue is clear.'
    : `Needs you now: ${needs} — ${parts.join(' + ')}.`;
  return [
    needsLine,
    // the artefacts are named only where there is a Make to open (the phone's third tab); the desktop has no Make view (U-12)
    counts.makes > 0
      ? `Can wait: ${counts.working} task${counts.working === 1 ? '' : 's'} in progress, ${counts.makes} artefact${counts.makes === 1 ? '' : 's'} in Make.`
      : `Can wait: ${counts.working} task${counts.working === 1 ? '' : 's'} in progress.`,
    // derived from the same count as the first line: "nothing needs you" is only said when nothing does (it sat beside "Needs you now: 2")
    needs === 0 ? 'Context: overnight tickets settled; nothing needs you before 09:00.' : 'Context: overnight tickets settled.',
    `Next morning brief: ${nextBriefLabel(briefAt)}.`,
  ];
}

/** The next morning brief from the configured time: today if the clock is still before it, otherwise
 *  tomorrow. The setting is real state, not a label — the brief header computes its next delivery from
 *  this, so changing the time changes what the surface says. */
export function nextBriefLabel(briefAt: string, now = new Date(DEMO_NOW)): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(briefAt).trim());
  const hours = match ? Number(match[1]) : 7;
  const minutes = match ? Number(match[2]) : 30;
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  const sameDay = target.getFullYear() === now.getFullYear()
    && target.getMonth() === now.getMonth()
    && target.getDate() === now.getDate();
  return `${sameDay ? 'today' : 'tomorrow'} at ${briefAt}`;
}

const at = (h: number, m: number) => new Date(2026, 10, 8, h, m, 0, 0).getTime();

export const SEED_THREAD: Msg[] = [
  {
    id: 'm-1', from: 'agent', at: at(11, 32),
    text: "Morning. I went through the night's tickets — two settled, one is waiting on your approval.",
  },
  { id: 'm-2', from: 'you', at: at(11, 36), text: 'What needs me?' },
  {
    id: 'm-3', from: 'agent', at: at(11, 37), tag: 'needs-you',
    text: 'One Tier B grant: read access to the RHL pilot-week ledger. Bounded to that scope, expires in 24 hours.',
  },
  { id: 'm-4', from: 'agent', at: at(11, 38), text: "Everything else can wait. I'll keep the tasks moving." },
];

export const SEED_TASKS: Task[] = [
  { id: 'T-1043', title: 'Prepare the Outis handover note', state: 'working', last: 'your agent: drafting the summary, 3 of 5 sections done', at: at(11, 23) },
  { id: 'T-1042', title: 'Reconcile pilot-week ledger entries', state: 'working', last: 'your agent: matched 41 of 43 entries, 2 need source logs', at: at(11, 20) },
  { id: 'T-1041', title: 'Draft the Friday capacity note', state: 'waiting', last: 'your agent: waiting on your sign-off of the Outis numbers', at: at(10, 52) },
  { id: 'T-1039', title: 'Package the 1.5.5 installer QA report', state: 'done', last: 'your agent: filed beside the pilot-week QA report', at: at(10, 18) },
  { id: 'T-1038', title: 'Archive the pilot-week scan logs', state: 'done', last: 'your agent: archived to the ledger drive, index updated', at: at(9, 34) },
  { id: 'T-1037', title: 'Recheck the fleet ticket backlog', state: 'done', last: 'your agent: no unanswered tickets older than a day', at: at(8, 57) },
];

export const SEED_APPROVALS: Approval[] = [
  {
    id: 'A-09',
    tag: 'Tier B · bounded grant',
    title: 'Approval requested',
    body: 'Your agent asks for read access to the RHL pilot-week ledger.',
    scope: 'pilot-week ledger, read-only',
    expires: '24 hours',
    klass: 'bounded grant',
  },
];

export const SEED_DECISIONS: Decision[] = [
  {
    id: 'D-08', approvalId: 'A-08', title: 'Send the capacity note to the pilot lead',
    scope: 'one email, draft attached', outcome: 'approved', note: 'you · yesterday 16:40',
    at: at(9, 40),
  },
  {
    id: 'D-07', approvalId: 'A-07', title: 'Re-run the ledger import with the corrected mapping',
    scope: 'pilot-week ledger, write', outcome: 'denied', note: 'you · yesterday 14:05',
    at: at(8, 15),
  },
];

export const MAKES = [
  { id: 'M-07', kind: 'document', title: 'Pilot-week ledger reconciliation notes', state: 'ready', preview: '43 entries reconciled · 2 need source logs' },
  { id: 'M-06', kind: 'sheet', title: 'Capacity model v3', state: 'in review', preview: '5 capacity bands · waiting on your sign-off' },
  { id: 'M-05', kind: 'document', title: 'Outis handover summary — draft', state: 'in progress', preview: '3 of 5 sections drafted' },
  { id: 'M-04', kind: 'sheet', title: 'Weekly ticket roll-up', state: 'ready', preview: '18 tickets · 2 waiting on you' },
];

export const APP_TABS: AppTab[] = [
  {
    id: 'ledger', name: 'Ledger', desc: 'Pilot-week books', rows: [
      { id: 'L-1048', label: 'Spare chairs — add-on', value: '41 of 43 matched', state: 'done' },
      { id: 'L-1047', label: 'Pilot-week opening balance', value: 'verified', state: 'done' },
      { id: 'L-1046', label: 'Source logs for 2 entries', value: 'needs you', state: 'waiting' },
      { id: 'L-1045', label: 'Outis handover allocation', value: 'in progress', state: 'working' },
    ],
  },
  {
    id: 'documents', name: 'Documents', desc: 'Reports and notes', rows: [
      { id: 'D-31', label: 'Outis handover note', value: '3 of 5 sections', state: 'working' },
      { id: 'D-30', label: 'Capacity note — Friday', value: 'draft', state: 'waiting' },
      { id: 'D-29', label: 'Installer QA report', value: 'filed', state: 'done' },
    ],
  },
  {
    id: 'fleet', name: 'Fleet', desc: 'Tickets and swarms', rows: [
      { id: 'F-12', label: 'Ticket backlog recheck', value: 'clear', state: 'done' },
      { id: 'F-11', label: 'Overnight swarm intake', value: '2 settled', state: 'done' },
    ],
  },
  {
    id: 'routines', name: 'Routines', desc: 'Recurring work', rows: [
      { id: 'R-05', label: 'Daily roll-up', value: 'next 17:00', state: 'working' },
      { id: 'R-04', label: 'Ledger reconciliation', value: 'ran 06:00', state: 'done' },
    ],
  },
];

export const DEFAULT_SETTINGS: Settings = {
  displayName: 'Cayleb',
  agentTone: 'concise',
  briefAt: '07:30',
  density: 'comfortable',
  motion: 'full',
};

// ---------------------------------------------------------------------------------------------
// FIXTURE REPLY ENGINE — named fixture. There is no live agent runtime in this build.
// Deterministic, local, no network: the thread's replies come from this table. The surface shows
// "fixture reply engine — no live agent runtime" next to the thread so a viewer is never misled.
// ---------------------------------------------------------------------------------------------
export const FIXTURE_LABEL = 'fixture reply engine — no live agent runtime';

type Rule = { match: RegExp; reply: string; detail: string };

const RULES: Rule[] = [
  {
    match: /approval|approve|grant|permission|access/i,
    reply: 'The one waiting is the Tier B read-only grant on the pilot-week ledger. Hold the card to commit it — a tap cannot send it. Deny records too, and both land in Decisions.',
    detail: 'The grant is scoped to the pilot-week ledger, read-only, and expires in 24 hours; it is a bounded grant, so it grants nothing beyond that scope.',
  },
  {
    match: /task|todo|do|work/i,
    reply: 'Tasks are the inbox of decisions: two in progress, one waiting on your sign-off, three done today. New task adds it to the board and it survives a reload.',
    detail: 'A waiting task is signed off in place on its own card (click or press Enter on it); doing so records the sign-off in Decisions and clears it from the needs-you queue.',
  },
  {
    match: /brief|morning|today|priority/i,
    reply: 'Short version: one approval needs you, the ledger is 41 of 43 matched, and the capacity note is drafted but unsigned. Nothing else before 09:00.',
    detail: 'The brief is derived from the live board: the needs-you figure is pending approvals plus waiting tasks, so it changes the moment you act on either.',
  },
  {
    match: /setting|preference|appearance|account|density|motion|tone|name/i,
    reply: 'Settings sits behind the gear on the sidebar (desktop) or the header (phone): account, agent preferences, appearance. Changes persist across a reload.',
    detail: 'The display name labels your turns, the reply style changes this engine’s answer length, and the morning-brief time is the one printed as the next brief in the brief header.',
  },
  {
    match: /app|canvas|ledger|document|fleet|routine|make/i,
    reply: 'Apps open as tabs beside the thread — the canvas on the right. The ledger has two entries that still need source logs.',
    detail: 'The ledger shows L-1046 as the row that needs you; the canvas stays read-only in this build, as its footer says.',
  },
  {
    match: /who are you|your name|persona|named/i,
    reply: 'I have no name — I am just "Your agent". No persona, no character: the mark beside the thread is the presence indicator.',
    detail: 'The presence mark is the only avatar: state colour plus the mark, nothing invented.',
  },
];

/** The NAMED FIXTURE reply engine. `tone` comes from the persisted settings record, so the reply-style
 *  control is real: detailed adds one concrete detail line to the same answer. */
export function fixtureReply(text: string, tone: 'concise' | 'detailed' = 'concise'): string {
  const hit = RULES.find((r) => r.match.test(text));
  const base = hit
    ? hit.reply
    : `Noted — "${text.trim().slice(0, 80)}". This is the fixture reply engine: the thread records your turn and answers locally, and every task, decision and setting you change persists in this browser.`;
  if (tone !== 'detailed') return base;
  const detail = hit
    ? hit.detail
    : 'the board, the decision record and the settings record are all persisted in this browser, so they survive leaving the view and reloading the page.';
  return `${base} Detail: ${detail}`;
}

export const STATE_WORDS = { working: 'working', idle: 'idle', 'needs-you': 'needs you' } as const;
