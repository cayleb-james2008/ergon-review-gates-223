// data/store.ts — one small persisted store for the Ergon front end.
//
// Persistence is localStorage (same-origin, survives a full page reload, no backend). Every mutation
// writes through, so a created task, a recorded decision and a changed setting survive leaving the
// view, leaving the app, and a reload — the Ticket 055 breakages this build exists to close
// (Tickets 061-064 execute against it).
//
// The reply engine is the NAMED FIXTURE in fixtures.ts; nothing here talks to a network.
import { useSyncExternalStore } from 'react';
import {
  BRIEF, DEFAULT_SETTINGS, DEMO_NOW, SEED_APPROVALS, SEED_DECISIONS, SEED_TASKS, SEED_THREAD,
  fixtureReply, type Approval, type Decision, type DecisionOutcome, type Msg, type Settings, type Task,
} from './fixtures';
import { DEMO_CALL, DEMO_JOB, DEMO_ROLE, DEMO_ROLE_MAP, DEMO_SKILL_MANIFEST, DEMO_THREAD_START } from './demo';

const KEY = 'rhl.warehouse-demo.v1';

export type Notice = { id: string; title: string; body: string; at: number };

export type State = {
  version: 1;
  messages: Msg[];
  tasks: Task[];
  decisions: Decision[];
  approvals: Approval[];
  settings: Settings;
  lastOutcome: { decision: Decision; at: number } | null;
  notice?: Notice | null;
  draft?: never;
};

/** Demo mode for the RHL warehouse showcase. The base app is untouched when this is false. */
export const DEMO = (() => {
  try { return new URLSearchParams(window.location.search).get('demo') === 'rhl'; } catch { return false; }
})();

function seed(): State {
  if (DEMO) return seedDemo();
  return {
    version: 1,
    messages: SEED_THREAD,
    tasks: SEED_TASKS,
    decisions: SEED_DECISIONS,
    approvals: SEED_APPROVALS,
    settings: DEFAULT_SETTINGS,
    lastOutcome: null,
    notice: null,
  };
}

// The demo company run starts from a warehouse-worker morning, not the pilot-week seed. It is
// demo data only: the person on the phone is a demo worker on the RHL demo instance.
function seedDemo(): State {
  const at0 = Date.now() - 90_000;
  return {
    version: 1,
    messages: [
      { id: 'demo-m1', from: 'agent', at: at0, text: DEMO_THREAD_START[0].text },
      { id: 'demo-m2', from: 'you', at: at0 + 12_000, text: DEMO_THREAD_START[1].text },
    ],
    tasks: [
      { id: 'T-2201', title: 'Bay C concrete dump — book the lorry', state: 'waiting', last: 'your agent: no slot booked yet', at: at0 },
      { id: 'T-2200', title: 'H-line delivery check', state: 'working', last: 'your agent: checking the delivery note against the board', at: at0 - 20_000 },
    ],
    decisions: [],
    approvals: [],
    settings: { ...DEFAULT_SETTINGS, displayName: 'Warehouse demo' },
    lastOutcome: null,
    notice: null,
  };
}

function read(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw) as State;
    if (!parsed || parsed.version !== 1) return seed();
    // Shape guard: a corrupt or partial record must not lock the app.
    return {
      version: 1,
      messages: Array.isArray(parsed.messages) ? parsed.messages : SEED_THREAD,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : SEED_TASKS,
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : SEED_DECISIONS,
      approvals: Array.isArray(parsed.approvals) ? parsed.approvals : SEED_APPROVALS,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      lastOutcome: parsed.lastOutcome ?? null,
      notice: parsed.notice ?? null,
    };
  } catch {
    return seed();
  }
}

let state: State = read();
const listeners = new Set<() => void>();

function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: the in-memory state still serves the session */
  }
  listeners.forEach((l) => l());
}

export function getState(): State {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useErgon<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(getState()), () => select(getState()));
}

// ONE clock (U-11, X-14): what the person does while the app runs is stamped on the DEMO CLOCK, which starts at the
// fixture's own Sun 8 Nov 12:00 the first time the page loads in this browser and then runs with real time. The offset
// is kept in localStorage, so a reload does not take the clock back to 12:00 (new entries read EARLIER than old ones);
// `?reset=1` starts it again with the rest of the seed. A new entry reads on the same day as the thread above it
// (it read "Nov 10, 04:07 PM" under a thread of "11:38 AM").
const CLOCK_KEY = 'rhl.warehouse-demo.clock';
let clockOffset: number | null = null;
function demoOffset(): number {
  if (clockOffset !== null) return clockOffset;
  let v = NaN;
  try { v = Number(localStorage.getItem(CLOCK_KEY)); } catch { /* ignore */ }
  if (!Number.isFinite(v) || v === 0) {
    v = DEMO_NOW - Date.now();
    try { localStorage.setItem(CLOCK_KEY, String(v)); } catch { /* ignore */ }
  }
  clockOffset = v;
  return v;
}
const now = () => Date.now() + demoOffset();
const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
let seq = 0;
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`; // ids come from the wall clock: unique across reloads

// ---------------------------------------------------------------- conversation (both ways)

let replyTimer: ReturnType<typeof setTimeout> | null = null;
const pendingReplies = new Set<string>();

export function sendMessage(text: string) {
  const clean = text.trim();
  if (!clean) return;
  const mine: Msg = { id: id('m'), from: 'you', text: clean, at: now() };
  commit({ ...state, messages: [...state.messages, mine] });
  if (DEMO) { demoSend(clean); return; }
  const replyId = id('m');
  pendingReplies.add(replyId);
  const delay = 620;
  replyTimer = setTimeout(() => {
    pendingReplies.delete(replyId);
    // the reply-style setting is real state: it is read when the reply is produced, not at send time
    const reply: Msg = {
      id: replyId, from: 'agent', text: fixtureReply(clean, state.settings.agentTone),
      at: now(), fixture: true,
    };
    commit({ ...state, messages: [...state.messages, reply] });
  }, delay);
}

export function agentIsReplying(): boolean {
  return pendingReplies.size > 0 || demoPending > 0;
}


// ---------------------------------------------------------------- demo runtime (RHL showcase)

let demoPending = 0;
const demoStarted = { call: false, board: false, skill: false, skillBusy: false };

function pushDemo(msg: Omit<Msg, 'id' | 'at'> & { id?: string }) {
  const full: Msg = { ...msg, id: msg.id ?? id('m'), at: now() } as Msg;
  commit({ ...state, messages: [...state.messages, full] });
  return full.id;
}
function patchDemo(msgId: string, patch: Partial<Msg>) {
  commit({ ...state, messages: state.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)) });
}
function agentSays(delay: number, text: string, card?: Msg['card']) {
  demoPending += 1;
  return setTimeout(() => {
    demoPending -= 1;
    pushDemo({ from: 'agent', text, card });
  }, delay);
}
function notify(title: string, body: string) {
  const n: Notice = { id: id('n'), title, body, at: now() };
  commit({ ...state, notice: n });
  setTimeout(() => { if (getState().notice?.id === n.id) commit({ ...getState(), notice: null }); }, 9000);
}

function startDemoCall() {
  if (demoStarted.call) return;
  demoStarted.call = true;
  agentSays(500, 'Calling now — this is the demo transcript, not a live call.');
  const callId = id('m');
  setTimeout(() => {
    pushDemo({ id: callId, from: 'agent', text: '', card: { kind: 'call', status: 'dialing', callee: DEMO_CALL.callee, number: DEMO_CALL.number, turns: [], simulated: true } });
  }, 1100);
  DEMO_CALL.turns.forEach((t, i) => {
    setTimeout(() => {
      const m = getState().messages.find((x) => x.id === callId);
      if (!m?.card || m.card.kind !== 'call') return;
      patchDemo(callId, { card: { ...m.card, status: 'live', turns: [...m.card.turns, { who: t.who, label: t.label, text: t.text }] } });
    }, 2300 + i * 1600);
  });
  const endAt = 2300 + DEMO_CALL.turns.length * 1600 + 700;
  setTimeout(() => {
    const m = getState().messages.find((x) => x.id === callId);
    if (!m?.card || m.card.kind !== 'call') return;
    patchDemo(callId, { card: { ...m.card, status: 'done', ended: '00:14' } });
  }, endAt);
  agentSays(endAt + 600, "Booked. The job card is ready — when you're on the board, tell me where it goes.", {
    kind: 'job', ref: DEMO_JOB.ref, title: DEMO_JOB.title, rows: DEMO_JOB.rows, note: 'From the call · demo data', line: DEMO_JOB.line,
  });
  setTimeout(() => notify('DMP-4471 booked', "Lord's Haulage · 07:30 tomorrow · 2 pallets banded"), endAt + 700);
  agentSays(endAt + 1700, 'Open the Board tab and say “add this job to line F” — I will pull the full details across.');
}

/** The board's command bubble (docs/AGENT-HANDOFF.md) hands the text here in demo mode. */
export function handleBoardCommand(text: string) {
  const clean = String(text || '').trim();
  const m = /line\s*([A-S])\b/i.exec(clean);
  if (!m) { agentSays(400, 'Which line? Say “add this job to line F” and I will put it on that line.'); return; }
  const line = m[1].toUpperCase();
  if (!/add|put|job|this/i.test(clean)) { agentSays(400, 'I have the job card ready — say “add this job to line ' + line + '” when you want it on the board.'); return; }
  if (demoStarted.board) { agentSays(400, `That job is already on line ${line}.`); return; }
  const ok = writeJobToBoard(line);
  demoStarted.board = true;
  if (!ok) { agentSays(300, 'The board has no line ' + line + ' — nothing was written.'); return; }
  notify(`${DEMO_JOB.ref} added to line ${line}`, 'Pulled from the call · full details on the job card');
  agentSays(900, `Pulled the full job details from the call and added ${DEMO_JOB.ref} to line ${line} on the board.`, {
    kind: 'job', ref: DEMO_JOB.ref, title: DEMO_JOB.title, rows: DEMO_JOB.rows, note: `Written to line ${line} · demo instance`, line,
  });
  agentSays(2100, 'You run this dump every week. Want me to save it as a warehouse skill in the company library?', {
    kind: 'offer', text: 'Add “dump-run-intake” to the company library for the warehouse operator role?', action: 'Build the skill', done: false,
  });
}

/** Write the demo job onto the running board's demo data (same-origin localStorage + the board's
 *  own BroadcastChannel signal). The board is the real board build with VITE_BACKEND=demo. */
function writeJobToBoard(line: string): boolean {
  try {
    const raw = localStorage.getItem('rhl.demo.v1');
    if (!raw) return false;
    const data = JSON.parse(raw) as { lines: { id: string; code: string }[]; entries: Record<string, unknown>[] };
    const lineObj = (data.lines || []).find((l) => l.code === line);
    if (!lineObj) return false;
    if ((data.entries || []).some((e) => String(e.title || '').includes(DEMO_JOB.ref))) return true;
    const stamp = new Date().toISOString();
    data.entries = [...(data.entries || []), {
      id: (globalThis.crypto?.randomUUID?.() ?? `demo-${Date.now()}`),
      line_id: lineObj.id,
      title: `TEST ${DEMO_JOB.customer} — dump run ${DEMO_JOB.ref}`,
      details: DEMO_JOB.details,
      initials: 'AG',
      status: 'open',
      revision: 1,
      is_test: true,
      created_at: stamp,
      updated_at: stamp,
    }];
    localStorage.setItem('rhl.demo.v1', JSON.stringify(data));
    try { new BroadcastChannel('rhl-demo').postMessage('change'); } catch { /* Safari private mode */ }
    return true;
  } catch { return false; }
}

// The frozen demo library snapshot, used only when the page is served with no demo API (the static
// publication): the three seeded skills; a skill the demo run publishes while the page is open is
// appended in memory so the Library surface shows the same four skills the live demo shows.
type LibTool = { name: string; version: string; description: string };
const STATIC_LIBRARY: LibTool[] = [
  { name: 'pallet-check-on-arrival', version: '1.0.0', description: 'Checks a pallet label and condition on arrival and records the note against the line.' },
  { name: 'line-notes-shorthand', version: '1.0.0', description: 'Turns a shift note into a one-line board note in the warehouse shorthand.' },
  { name: 'invoice-match-office', version: '1.0.0', description: 'Matches a supplier invoice against the delivery note and flags a mismatch.' },
];
const localSkills: LibTool[] = [];

/** The Library view's data source when the demo host is absent (static publication). */
export function staticLibraryState() {
  const all = [...STATIC_LIBRARY, ...localSkills];
  const want = DEMO_ROLE_MAP[DEMO_ROLE] || [];
  return {
    ok: true, role: DEMO_ROLE,
    chosen: all.filter((t) => want.includes(t.name)),
    all,
    fresh: localSkills.map((t) => t.name),
    source: 'frozen demo library snapshot (static publication)',
  };
}

function publishLocally(tool: LibTool) {
  if (!localSkills.some((t) => t.name === tool.name)) localSkills.push(tool);
}

export async function buildDemoSkill() {
  if (demoStarted.skill || demoStarted.skillBusy) return;
  demoStarted.skillBusy = true;
  agentSays(300, 'Checking the company library first…');
  try {
    let j: { ok?: boolean; error?: string; tool?: { name: string; version: string; description?: string } } | null = null;
    try {
      const res = await fetch('api/demo/skill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ manifest: DEMO_SKILL_MANIFEST, role: DEMO_ROLE }),
      });
      j = await res.json();
    } catch {
      // No demo host answered (the static publication): replay the publication from the demo
      // manifest and record it in this page's frozen library snapshot, never claim a live service.
      publishLocally({ name: DEMO_SKILL_MANIFEST.name, version: DEMO_SKILL_MANIFEST.version, description: DEMO_SKILL_MANIFEST.description });
      demoStarted.skill = true;
      agentSays(300, `Published ${DEMO_SKILL_MANIFEST.name} v${DEMO_SKILL_MANIFEST.version} to the company library — now offered to the ${DEMO_ROLE} role.`, {
        kind: 'skill', name: DEMO_SKILL_MANIFEST.name, version: DEMO_SKILL_MANIFEST.version, role: DEMO_ROLE,
        summary: DEMO_SKILL_MANIFEST.description, published: true,
      });
      notify('Skill published', `${DEMO_SKILL_MANIFEST.name} v${DEMO_SKILL_MANIFEST.version} · company library · ${DEMO_ROLE}`);
      return;
    }
    if (!j) throw new Error('the library refused the submission');
    if (!j.ok) throw new Error(j.error || 'the library refused the submission');
    demoStarted.skill = true;
    const tool = j.tool as { name: string; version: string; description?: string };
    agentSays(300, `Published ${tool.name} v${tool.version} to the company library — now offered to the ${DEMO_ROLE} role.`, {
      kind: 'skill', name: tool.name, version: tool.version, role: DEMO_ROLE,
      summary: tool.description || 'Turns a booked dump run into a line-F job card.', published: true,
    });
    notify('Skill published', `${tool.name} v${tool.version} · company library · ${DEMO_ROLE}`);
  } catch (e) {
    agentSays(200, `The library door did not open: ${(e as Error).message}. Nothing was published.`);
  } finally {
    demoStarted.skillBusy = false;
  }
}

function demoSend(text: string) {
  if (/call|truck|dump|lorry|slot/i.test(text) && /call|ask|book|ring|phone|get/i.test(text)) { startDemoCall(); return; }
  if (/skill|library|save/i.test(text)) { void buildDemoSkill(); return; }
  agentSays(600, 'I can call the truck company about the dump, or once the job is on the board I can turn it into a warehouse skill. Everything here runs on demo data.');
}

export function demoPendingReplies(): boolean { return demoPending > 0; }

// ---------------------------------------------------------------- tasks (persist + phone creation)

export function createTask(title: string, note = `you → your agent · ${new Date(now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`) {
  const clean = title.trim();
  if (!clean) return;
  const highest = state.tasks.reduce((max, t) => {
    const n = Number(String(t.id).replace(/[^0-9]/g, ''));
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 1043);
  const task: Task = { id: `T-${highest + 1}`, title: clean, state: 'working', last: note, at: now() };
  commit({ ...state, tasks: [task, ...state.tasks] });
}

export function advanceTask(taskId: string) {
  commit({
    ...state,
    tasks: state.tasks.map((t) => (t.id === taskId
      ? { ...t, state: t.state === 'working' ? 'waiting' : t.state === 'waiting' ? 'done' : 'done', last: `you → your agent · ${new Date(now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` }
      : t)),
  });
}

const decisionId = (recorded: number) => `D-${recorded + 9}`;

/** Sign a waiting task off IN PLACE (the round-7 blocking fix). One mutation moves the task to done,
 *  records the sign-off in the Decisions inbox and updates `lastOutcome`, so the morning brief, the
 *  Tasks badge, the Tasks board and the Decisions page all read the same single store at once and
 *  cannot disagree. Idempotent: only a task still in `waiting` can be signed off. */
export function signOffTask(taskId: string) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || task.state !== 'waiting') return;
  const at = now();
  const stamp = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const decision: Decision = {
    id: decisionId(state.decisions.length),
    approvalId: task.id,
    title: `${task.title} — signed off`,
    scope: `task sign-off · ${task.id}`,
    outcome: 'approved',
    at,
    note: `you · ${new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    kind: 'signoff',
  };
  commit({
    ...state,
    tasks: state.tasks.map((t) => (t.id === taskId
      ? { ...t, state: 'done', last: `you · signed off ${stamp}` }
      : t)),
    decisions: [decision, ...state.decisions],
    // deliberately NOT lastOutcome: the sign-off outcome belongs in the Decisions inbox, and the
    // in-thread outcome strip slot must stay with the pending approval it replaces (otherwise the
    // sign-off would hide an approval that still needs the owner).
  });
}

// ---------------------------------------------------------------- approvals (record, pin, outcome)

export function decide(approvalId: string, outcome: DecisionOutcome) {
  const approval = state.approvals.find((a) => a.id === approvalId);
  if (!approval) return;
  const decision: Decision = {
    id: decisionId(state.decisions.length),
    approvalId,
    title: capitalise(approval.body.replace(/^Your agent asks for /, '').replace(/\.$/, '')),
    scope: approval.scope,
    outcome,
    at: now(),
    note: `you · ${new Date(now()).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
    kind: 'approval',
  };
  commit({
    ...state,
    approvals: state.approvals.filter((a) => a.id !== approvalId),
    decisions: [decision, ...state.decisions],
    lastOutcome: { decision, at: now() },
  });
}

export function dismissOutcome() {
  commit({ ...state, lastOutcome: null });
}

// ---------------------------------------------------------------- settings (persist across reload)

export function updateSettings(patch: Partial<Settings>) {
  commit({ ...state, settings: { ...state.settings, ...patch } });
}

// ---------------------------------------------------------------- deterministic capture helper

/** `?reset=1` restores the seeded state (a real reset, used by the capture pass so every take starts
 * from the same surface). Never called by the app itself. */
export function resetIfRequested() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (params.get('reset') === '1') {
    try { localStorage.removeItem(KEY); localStorage.removeItem(CLOCK_KEY); } catch { /* ignore */ }
    clockOffset = null;
    state = seed();
    // Strip the parameter so a later reload (the persistence check) loads the record it just wrote
    // instead of wiping it. This is a capture affordance, not app behaviour.
    params.delete('reset');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }
}

export { BRIEF, KEY };
