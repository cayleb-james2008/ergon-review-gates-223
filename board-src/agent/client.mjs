#!/usr/bin/env node
// Standalone agent client for the RHL lines board. Zero dependencies: Node 22+ built-ins and fetch only.
// It imports nothing from the app (src/) and reads only public/agent-tools.json (or an injected tools object).
//
//   import { createBoardClient } from './client.mjs';
//   const c = createBoardClient();                       // settings from BOARD_URL, BOARD_ANON_KEY, BOARD_KEY
//   const r = await c.callTool('board_get', {});         // never throws for expected failures: { ok:false, error, message }
//
//   node agent/client.mjs <tool> '<json args>'           // CLI: prints one JSON result, exit 0 when ok
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'ergon_warehouse';
const DEFAULT_TOOLS_PATH = fileURLToPath(new URL('../public/agent-tools.json', import.meta.url));
const RETRIES = 3; // network errors only; key_invalid / key_expired are never retried
const ROW_CAP = 1000;

// ---------------------------------------------------------------- tiny JSON-Schema validator
const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const typeOk = (t, v) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : kind(v) === t);

// Returns a list of problems (strings that name the field and the rule, never the offending value).
export function validate(schema, value, path = 'args') {
  const out = [];
  const types = schema.type ? [].concat(schema.type) : null;
  if (types && !types.some((t) => typeOk(t, value))) return [`${path}: expected ${types.join(' or ')}`];
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    const len = [...value].length; // code points, like the database's char_length
    if (schema.minLength != null && len < schema.minLength) out.push(`${path}: must be at least ${schema.minLength} character(s)`);
    if (schema.maxLength != null && len > schema.maxLength) out.push(`${path}: must be at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push(`${path}: has an invalid format or contains control characters`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) out.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) out.push(`${path}: must be <= ${schema.maximum}`);
  }
  if (kind(value) === 'object') {
    for (const k of schema.required ?? []) if (!(k in value) || value[k] === undefined) out.push(`${path}.${k}: is required`);
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      if (schema.properties?.[k]) out.push(...validate(schema.properties[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) out.push(`${path}.${k}: unknown field`);
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => out.push(...validate(schema.items, v, `${path}[${i}]`)));
  return out;
}

export function loadTools(path = DEFAULT_TOOLS_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ---------------------------------------------------------------- client
const fail = (error, message, extra = {}) => ({ ok: false, error, message, ...extra });
const JOB_FIELDS = ['id', 'line_id', 'line_code', 'title', 'details', 'initials', 'status', 'revision', 'is_test', 'updated_by', 'created_at', 'updated_at'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const localHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');

export function createBoardClient(opts = {}) {
  const env = globalThis.process?.env ?? {};
  const url = String(opts.url ?? env.BOARD_URL ?? '').replace(/\/+$/, '');
  const anonKey = opts.anonKey ?? env.BOARD_ANON_KEY ?? '';
  const key = opts.key ?? env.BOARD_KEY ?? '';
  const actor = String(opts.actor ?? env.BOARD_ACTOR ?? 'AGT').trim().slice(0, 6) || 'AGT';
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const retryDelayMs = opts.retryDelayMs ?? 250;
  const toolsDoc = opts.tools ?? loadTools(opts.toolsPath);
  const byName = new Map(toolsDoc.tools.map((t) => [t.name, t]));

  const secrets = [key, anonKey].filter((s) => typeof s === 'string' && s.length >= 4);
  const redactText = (s) => secrets.reduce((t, x) => t.split(x).join('[redacted]'), String(s));
  const redact = (v) => {
    if (typeof v === 'string') return redactText(v);
    if (Array.isArray(v)) return v.map(redact);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x)]));
    return v;
  };

  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  function configProblem(needKey) {
    const missing = [];
    if (!url) missing.push('BOARD_URL');
    if (!anonKey) missing.push('BOARD_ANON_KEY');
    if (needKey && !key) missing.push('BOARD_KEY');
    if (missing.length) return `Missing connection setting(s): ${missing.join(', ')}. Set them as environment variables or pass them to createBoardClient.`;
    if (needKey && !key.startsWith('ergk_')) return 'BOARD_KEY is not a board key (it must start with ergk_). Ask your own agent to issue one for you.';
    let u;
    try { u = new URL(url); } catch { return 'BOARD_URL is not a valid URL.'; }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && localHost(u.hostname))) return 'BOARD_URL must be https (plain http is only allowed for localhost).';
    return null;
  }

  // One HTTP exchange with retries on network failure. Returns { status, body } or { netError }.
  async function http(method, path, headers, body) {
    let last = 'request failed';
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt) await sleep(retryDelayMs * attempt);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await doFetch(url + path, {
          method,
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctl.signal,
        });
        if ([502, 503, 504].includes(res.status)) { last = `server unavailable (HTTP ${res.status})`; continue; }
        let parsed = null;
        try { const text = await res.text(); parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
        return { status: res.status, body: parsed, retried: attempt > 0 };
      } catch (e) {
        last = e?.name === 'AbortError' ? 'request timed out' : String(e?.message ?? e);
      } finally {
        clearTimeout(timer);
      }
    }
    return { netError: last };
  }

  const statusError = (status) => {
    if (status === 429) return fail('network', 'The board asked for slower requests (HTTP 429). Try again later.');
    if (status === 401 || status === 403) return fail('config', 'The board rejected the anon key (HTTP ' + status + '). Check BOARD_ANON_KEY and BOARD_URL.');
    if (status === 404 || status === 406) return fail('config', `The board data API was not found or the ${SCHEMA} schema is not exposed (HTTP ${status}). Check BOARD_URL.`);
    if (status === 400) return fail('invalid', 'The board rejected the request as malformed (HTTP 400).');
    return fail('network', `Unexpected reply from the board (HTTP ${status}).`);
  };

  async function select(table, query) {
    const r = await http('GET', `/rest/v1/${table}?${query}`, { 'Accept-Profile': SCHEMA, Accept: 'application/json' });
    if (r.netError) return fail('network', `Could not reach the board: ${r.netError}`);
    if (r.status !== 200 || !Array.isArray(r.body)) return statusError(r.status);
    return { ok: true, rows: r.body };
  }

  // RPC with the key. Maps the contract reply to { ok:true, ...data } | { ok:false, error }. Key errors are never retried.
  async function rpc(fn, args) {
    const r = await http('POST', `/rest/v1/rpc/${fn}`, { 'Content-Profile': SCHEMA, 'Content-Type': 'application/json', Accept: 'application/json' }, { p_key: key, ...args });
    if (r.netError) return fail('network', `Could not reach the board: ${r.netError}`);
    if (r.status !== 200 || !r.body || typeof r.body !== 'object') return statusError(r.status);
    if (r.body.ok === true) return r.body;
    switch (r.body.error) {
      case 'key_invalid': return fail('key_invalid', 'The key is unknown, revoked or not for this app. Do not retry; ask your own agent to issue a new key for you.');
      case 'key_expired': return fail('key_expired', 'The key has expired. Do not retry; ask your own agent to issue a new key for you.');
      case 'not_found': return fail('not_found', 'No job with that id (it may have been deleted). Nothing was written.');
      case 'conflict': {
        const cur = Number(r.body.current_revision ?? r.body.revision ?? r.body.entry?.revision);
        return fail('conflict', `The job changed since you read it${Number.isInteger(cur) ? ` (current revision ${cur})` : ''}. ${r.retried ? 'This call was retried after a network error, so the first attempt may have succeeded: read the job to check. ' : 'Nothing was written. '}Read it again, then decide whether to apply your change on top. Do not retry blindly.`, { ...(Number.isInteger(cur) ? { current_revision: cur } : {}), ...(r.retried ? { retried_after_network_error: true } : {}) });
      }
      default: return fail('invalid', 'The board rejected the values (check line, lengths, control characters and status).');
    }
  }

  async function loadBoard() {
    const [l, e] = await Promise.all([
      select('lines', 'select=id,code,sort_order,is_test&order=sort_order.asc'),
      select('entries', `select=id,line_id,title,details,initials,status,revision,is_test,updated_by,created_at,updated_at&order=created_at.asc,id.asc&limit=${ROW_CAP}`),
    ]);
    if (!l.ok) return l;
    if (!e.ok) return e;
    const jobsBy = new Map(l.rows.map((x) => [x.id, []]));
    for (const j of e.rows) jobsBy.get(j.line_id)?.push(pick(j, JOB_FIELDS.filter((k) => k !== 'line_code' && k !== 'line_id')));
    const lines = l.rows.map((x) => ({ code: x.code, line_id: x.id, is_test: !!x.is_test, jobs: jobsBy.get(x.id) }));
    return {
      ok: true,
      test_data: l.rows.some((x) => x.is_test) || e.rows.some((x) => x.is_test),
      line_count: lines.length,
      job_count: e.rows.length,
      truncated: e.rows.length >= ROW_CAP,
      lines,
    };
  }

  const uuidOf = (v) => (typeof v === 'string' ? v.toLowerCase() : v);
  async function jobExists(id) {
    const r = await select('entries', `select=id&id=eq.${encodeURIComponent(id)}&limit=1`);
    return r.ok ? r.rows.length > 0 : r;
  }
  // Current stored revision of a job: a number, null when the job does not exist, or a { ok:false } failure.
  async function jobRevision(id) {
    const r = await select('entries', `select=revision&id=eq.${encodeURIComponent(id)}&limit=1`);
    return r.ok ? (r.rows.length ? Number(r.rows[0].revision) : null) : r;
  }

  const handlers = {
    async board_get() { return loadBoard(); },

    async board_find(a) {
      const b = await loadBoard();
      if (!b.ok) return b;
      const needle = a.text?.toLowerCase();
      const all = [];
      for (const ln of b.lines) {
        if (a.line && ln.code !== a.line) continue;
        for (const j of ln.jobs) {
          if (a.status && j.status !== a.status) continue;
          if (needle && ![j.title, j.details, j.initials].some((f) => (f ?? '').toLowerCase().includes(needle))) continue;
          all.push({ ...j, line_code: ln.code, line_id: ln.line_id });
        }
      }
      const matches = all.slice(0, a.limit ?? 50);
      return { ok: true, test_data: b.test_data, count: matches.length, total_matches: all.length, matches };
    },

    async job_save(a) {
      if (!a.id && (a.title === undefined || (!a.line_code && !a.line_id))) {
        return fail('invalid', 'A new job needs a title and a line (line_code or line_id).');
      }
      if (a.expected_revision !== undefined && !a.id) return fail('invalid', 'expected_revision only applies when editing an existing job: pass its id.');
      const id = uuidOf(a.id) ?? globalThis.crypto.randomUUID(); // generated once: every retry of this call reuses it
      if (a.id && a.title === undefined && a.expected_revision === undefined) {
        const ex = await jobExists(id);
        if (ex.ok === false) return ex;
        if (!ex) return fail('invalid', 'No job has this id, so it would be a new job: a new job needs a title and a line.');
      }
      const entry = { id, initials: actor };
      for (const k of ['line_code', 'line_id', 'title', 'details', 'initials', 'status', 'expected_revision']) if (a[k] !== undefined) entry[k] = a[k];
      const r = await rpc('save_entry', { p_entry: entry });
      if (!r.ok) return r;
      return { ok: true, created: r.entry.revision === 1, job: pick(r.entry, JOB_FIELDS) };
    },

    async job_set_status(a) {
      const id = uuidOf(a.id);
      // Read-then-write with the revision just read (or the caller's own), so a concurrent change surfaces as conflict.
      let expected = a.expected_revision;
      if (expected === undefined) {
        const cur = await jobRevision(id);
        if (cur === null) return fail('not_found', 'No job with that id (it may have been deleted). Nothing was written.');
        if (typeof cur !== 'number') return cur;
        expected = cur;
      }
      const r = await rpc('save_entry', { p_entry: { id, status: a.status, initials: actor, expected_revision: expected } });
      if (r.ok) return { ok: true, job: pick(r.entry, JOB_FIELDS) };
      if (r.error === 'invalid') {
        const ex = await jobExists(id); // the database cannot create a job without a line: tell "missing" from "bad value"
        if (ex === false) return fail('not_found', 'No job with that id.');
      }
      return r;
    },

    async job_remove(a) {
      const r = await rpc('remove_entry', { p_id: uuidOf(a.id) });
      return r.ok ? { ok: true, id: r.id } : r;
    },

    async key_check() {
      const r = await rpc('check_key', {});
      return r.ok ? { ok: true, subject: r.subject, expires_at: r.expires_at } : r;
    },
  };

  const trimmed = (args) => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'string' && !['id', 'line_id'].includes(k) ? v.trim() : v]));

  async function callTool(name, args = {}) {
    try {
      const tool = byName.get(name);
      const handler = handlers[name];
      if (!tool || !handler) return fail('unknown_tool', `Unknown tool "${redactText(String(name))}". Available: ${[...byName.keys()].join(', ')}.`);
      if (kind(args) !== 'object') return fail('invalid', 'args must be a JSON object.');
      const a = trimmed(args);
      const problems = validate(tool.inputSchema, a);
      if (problems.length) return fail('invalid', problems.join('; '), { problems });
      const needKey = tool.annotations?.requiresKey === true;
      const cfg = configProblem(needKey);
      if (cfg) return fail('config', cfg);
      return redact(await handlers[name](a));
    } catch (e) {
      return fail('network', redactText(`Unexpected failure: ${e?.message ?? e}`));
    }
  }

  return { tools: toolsDoc.tools, callTool, actor, toolNames: () => [...byName.keys()], implementedTools: () => Object.keys(handlers) };
}

// ---------------------------------------------------------------- CLI
const isMain = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isMain) {
  const [tool, raw] = process.argv.slice(2);
  const print = (v) => process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  try {
    const client = createBoardClient();
    if (!tool || tool === '--list' || tool === '--tools') {
      print(client.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })));
      process.exitCode = tool ? 0 : 2;
    } else {
      let args = {};
      try { args = raw ? JSON.parse(raw) : {}; } catch { args = null; }
      const res = args === null ? fail('invalid', 'Arguments must be a JSON object, for example \'{"line":"A"}\'.') : await client.callTool(tool, args);
      print(res);
      process.exitCode = res.ok ? 0 : 1;
    }
  } catch (e) {
    print(fail('config', `Could not start: ${String(e?.message ?? e)}`));
    process.exitCode = 1;
  }
}
