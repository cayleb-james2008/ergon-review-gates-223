// demo-config.mjs — the demo data set for the RHL warehouse-worker demo pack.
//
// DEMO DATA ONLY. These skills are seeded into a separate demo instance of the shared tool library
// service (same service code, its data dir inside this pack). They never touch a live company
// library, the live warehouse board, or any RHL production data.

export const LIBRARY_PORT = 8751;
export const LIBRARY_ACTOR = 'agent:warehouse-demo';
export const DEMO_REVIEWER = 'Nox (demo reviewer)';

export const ROLE_MAP = {
  'warehouse operator': ['dump-run-intake', 'pallet-check-on-arrival', 'line-notes-shorthand'],
  'office administrator': ['invoice-match-office'],
};

const base = (name, description, keywords, summary, capabilities, useCases) => ({
  name,
  version: '1.0.0',
  description,
  author: { id: 'agent:company-library-seed', kind: 'agent', name: 'Company library (demo seed)' },
  discovery: { summary, keywords, requires: [], capabilities, useCases },
  surfaces: {
    humanUI: { entry: `app://tools/${name}`, description: `${summary}.` },
    agent: {
      entry: `${name}.run`,
      inputs: [{ name: 'note', type: 'string', required: true, description: 'The shift note to act on' }],
      outputs: [{ name: 'result', type: 'object', description: 'What changed, with a receipt' }],
    },
  },
  platform: 'android',
  sharedState: true,
});

export const SEED_TOOLS = [
  base(
    'pallet-check-on-arrival',
    'Checks a pallet label and condition on arrival and records the note against the line.',
    ['warehouse', 'pallet', 'arrival', 'check'],
    'Check a pallet in and note its condition',
    ['reads the pallet label', 'records a condition note'],
    ['Sign a pallet in at the bay door'],
  ),
  base(
    'line-notes-shorthand',
    'Turns a shift note into a one-line board note in the warehouse shorthand.',
    ['warehouse', 'line', 'notes', 'shorthand'],
    'Write a short board note from a long shift note',
    ['shortens a note to the board line', 'keeps the reference and quantity'],
    ['Hand a shift note to the next operator'],
  ),
  base(
    'invoice-match-office',
    'Matches a supplier invoice against the delivery note and flags a mismatch.',
    ['office', 'invoice', 'supplier', 'match'],
    'Match an invoice to its delivery note',
    ['compares quantities and prices', 'flags a mismatch with the line'],
    ['Check the week’s supplier invoices'],
  ),
];

export const DEMO_SKILL_NAME = 'dump-run-intake';

/** The warehouse skills the showcase uses as its demo data set (named in DEMO-MANIFEST.json). */
export const DEMO_DATA_SET = {
  board: {
    build: 'b559e68',
    backend: 'VITE_BACKEND=demo',
    seedSource: 'showcase/board-src/src/data/demo.js (14 TEST jobs across lines A–S)',
    lineForTheDemo: 'F',
    entryTitlePrefix: 'TEST',
  },
  app: {
    base: 'de-branded demo app, built from the current 068 dark front-end source (m-0258) with the Ticket 099 demo layer ported on',
    demoRole: 'warehouse operator',
  },
  library: {
    service: 'shared tool library service, separate demo data dir',
    seeded: SEED_TOOLS.map((t) => `${t.name}@${t.version}`),
    roleMap: ROLE_MAP,
    roleMapNote: 'The library manifest has no per-role field; role selection is this named demo map.',
    createdLive: DEMO_SKILL_NAME,
  },
  call: {
    script: 'showcase/app-src/src/data/demo.ts (DEMO_CALL) — 6 scripted turns, no telephony',
    simulated: true,
  },
};
