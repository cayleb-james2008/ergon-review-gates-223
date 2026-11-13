// data/demo.ts — the RHL warehouse-worker showcase layer.
//
// This file and the ?demo=rhl code paths are the ONLY additions to the Ergon suite phone app
// source. The base app is the shipped suite front end (m-0185, "Your agent", Chat/Tasks/Make,
// dark token layer); the showcase adds a clearly-scripted demo agent runtime, the RHL warehouse
// board surface and the company-library surface for the demo company run.
//
// NOTHING here is a live AI. Every word the agent "says" in demo mode is scripted in this file or
// fetched from the local demo services; the app labels it "scripted demo agent — no live AI".
// The truck-company call is a scripted transcript; no call is placed and no telephony is used.

export const DEMO_COMPANY = 'RHL Warehouse — demo';
export const DEMO_ROLE = 'warehouse operator';

export type CallTurn = { who: 'agent' | 'truck'; label: string; text: string };

export const DEMO_CALL: { callee: string; number: string; turns: CallTurn[] } = {
  callee: "Lord's Haulage",
  number: 'demo line — no number dialled',
  turns: [
    { who: 'agent', label: 'Your agent', text: "Morning — this is Robert Lord's warehouse agent calling about the Bay C concrete dump. Are you taking dump runs tomorrow?" },
    { who: 'truck', label: "Lord's Haulage", text: "Morning. Yes, we've got a lorry free. How many pallets and what's the load?" },
    { who: 'agent', label: 'Your agent', text: 'Two pallets, banded concrete, from Bay C. They can be pulled round to bay 2 for 07:30.' },
    { who: 'truck', label: "Lord's Haulage", text: '07:30 works. I can put you down as DMP-4471 — two pallets, bay 2, driver will ask for the reference.' },
    { who: 'agent', label: 'Your agent', text: 'Booked for 07:30 then, ref DMP-4471. Anything we need to do before the lorry arrives?' },
    { who: 'truck', label: "Lord's Haulage", text: 'Just have the tickets ready and the pallets at the bay door. See you in the morning.' },
  ],
};

export const DEMO_JOB = {
  ref: 'DMP-4471',
  title: "Lord's Haulage — dump run",
  customer: "Lord's Haulage",
  line: 'F',
  status: 'open',
  rows: [
    { label: 'Reference', value: 'DMP-4471' },
    { label: 'Collection', value: 'Tomorrow, 07:30' },
    { label: 'Load', value: '2 pallets · banded concrete' },
    { label: 'From', value: 'Bay C → bay 2 door' },
    { label: 'Driver note', value: 'Quote the reference at the gate' },
  ],
  details: 'DMP-4471 · 07:30 tomorrow · 2 pallets banded concrete · Bay C → bay 2 · tickets at the door',
};

export const DEMO_BRIEF_TITLE = 'Morning brief — Mon 9 Nov';

export const DEMO_BRIEF_LINES = [
  'Needs you now: 1 — the Bay C dump still has no lorry booked.',
  'Can wait: the H-line delivery check, and line F is clear for a new job.',
  'Context: demo instance — test data only.',
];

export const DEMO_THREAD_START = [
  { from: 'agent' as const, text: 'Morning. The Bay C concrete dump is still waiting on a call to the truck company. Want me to sort it?' },
  { from: 'you' as const, text: 'Yes — call them and ask for a slot tomorrow morning.' },
];

export const DEMO_SKILL_MANIFEST = {
  name: 'dump-run-intake',
  version: '0.1.0',
  description: 'Takes a booked concrete-dump run from the phone call to a line-F job card on the warehouse board.',
  author: { id: 'agent:warehouse-demo', kind: 'agent' as const, name: 'Your agent (RHL demo)' },
  discovery: {
    summary: 'Turns a truck-company dump booking into a line-F job card with the full call details',
    keywords: ['warehouse', 'dump', 'intake', 'line', 'booking', 'truck', 'demo'],
    requires: ['board:line-write', 'phone:call-notes'],
    capabilities: ['reads a booking reference and time window', 'pulls the load and bay details from the call', 'adds the job to the chosen line with the driver note'],
    useCases: ['Book a dump run by phone and put it on the board in one step', 'Hand the dump run over on a shift change with the reference and bay note'],
  },
  surfaces: {
    humanUI: {
      entry: 'app://tools/dump-run-intake',
      description: 'A job card in the agent thread and a new job on line F of the warehouse board.',
    },
    agent: {
      entry: 'dump-run-intake.book',
      inputs: [
        { name: 'reference', type: 'string', required: true, description: 'Booking reference from the truck company' },
        { name: 'window', type: 'string', required: true, description: 'Collection time window' },
        { name: 'line', type: 'string', required: true, description: 'Warehouse line code, A to S' },
      ],
      outputs: [
        { name: 'job', type: 'object', description: 'The job as written to the board, with its line and details' },
      ],
    },
  },
  platform: 'android' as const,
  sharedState: true as const,
};

/** The demo role map: which library skills are offered to which employee role. The library service
 *  itself has no per-role field; this map is the named demo extension (recorded in the manifest). */
export const DEMO_ROLE_MAP: Record<string, string[]> = {
  'warehouse operator': ['dump-run-intake', 'pallet-check-on-arrival', 'line-notes-shorthand'],
};
