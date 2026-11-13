import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '@/config';
import { messageFor } from '@/core/key';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusOption } from './StatusBadge';
import { BayMarker } from './BayMarker';
import { KeyNotice } from './KeyNotice';

const stamp = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };

// One job editor, two presentations: the dialog (any job, with Line, Delete and the revision) and the compact form anchored to a row (a new job on that line).
// Never view-only and never asks for a secret: the fields and buttons are always there. With a valid key a save just works. Without one, a plain notice
// sits in the panel in place of saving (see NOTICES), and an existing job's fields are read-only. Nothing is sent without a valid key.
// props: job (null = new), lineLabel, form { labels, statuses, keyState, canEdit, demoKeys, useKey, onNotice, save, remove }, onDone(), compact, p (id prefix), demo (style guide only)
export function JobForm({ job, live, lineLabel, form: f, onDone, compact = false, p = 'f-', demo }) {
  const { labels, statuses, keyState, canEdit } = f;
  const [form, setForm] = useState({ line: lineLabel, title: job?.title ?? '', details: job?.details ?? '', initials: job?.initials ?? '', status: job?.status ?? statuses[0].value });
  const [msg, setMsg] = useState(demo?.msg ?? '');
  const [busy, setBusy] = useState(!!demo?.busy);
  const [invalid, setInvalid] = useState(demo?.invalid ?? ''); // which field the message is about, for aria-invalid
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [outcome, setOutcome] = useState(''); // a save the server answered with changed | gone
  const [done, setDone] = useState(false); // our own save or delete went through: the panel is closing, do not read that as someone else's change
  const draft = useRef(job ? { id: job.id, expected_revision: job.revision } : {}); // keeps its id across retries so a lost response never creates a duplicate
  const titleRef = useRef(null);
  const msgId = compact ? `${p}msg` : 'job-msg';
  const keyOk = keyState === 'valid';
  const readOnly = !keyOk && !!job; // a new job can be filled in; an existing one is read until there is a key
  // The job the dialog was opened on, against the board as it is now: deleted or edited elsewhere while open. `live` is undefined while that is unknown.
  const seen = busy || done || !job || live === undefined ? '' : live === null ? 'gone' : live.revision !== job.revision ? 'changed' : '';
  const stale = outcome || seen;
  const usable = keyOk && canEdit && !stale && !!form.line; // one rule for Save, in the dialog and in the row form
  const set = (k) => (v) => { setForm((x) => ({ ...x, [k]: v })); if (invalid === k) { setInvalid(''); setMsg(''); } };

  async function doSave() {
    if (busy) return;
    if (!form.title.trim()) { setMsg('Enter a customer or job title.'); setInvalid('title'); titleRef.current?.focus(); return; }
    if (form.initials.length > LIMITS.initials) { setMsg(`Initials can be at most ${LIMITS.initials} characters.`); setInvalid('initials'); return; }
    setInvalid('');
    Object.assign(draft.current, { line_code: form.line, title: form.title.trim(), details: form.details.trim(), initials: form.initials.trim(), status: form.status });
    setBusy(true);
    setMsg('');
    const res = await f.save(draft.current);
    setBusy(false);
    if (res.ok) { setDone(true); onDone(); }
    else if (res.error === 'conflict') setOutcome('changed');
    else if (res.error === 'not_found' && job) setOutcome('gone');
    else if (res.error === 'key_none' || res.error === 'key_invalid' || res.error === 'key_expired') setMsg(''); // the notice above says it
    else setMsg(res.error === 'network' ? 'Could not reach the server. Your changes are kept. Press Save again when the connection returns.' : `${messageFor(res.error)} Press Save to try again.`);
  }

  // the 'could not reach the server' message is about a moment that has passed once the connection is back
  useEffect(() => { if (canEdit) setMsg((m) => (m.startsWith('Could not reach the server') ? '' : m)); }, [canEdit]);

  // Why Save is off, said next to it (the key notice already covers a missing key)
  const reason = stale === 'gone' ? messageFor('not_found') : stale === 'changed' ? messageFor('conflict') : keyOk && !canEdit ? 'Editing is paused until the connection returns.' : keyOk && !form.line ? 'Choose a line.' : '';

  function submit(e) { e.preventDefault(); if (usable) doSave(); }

  async function del() {
    if (!keyOk) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    const res = await f.remove(draft.current.id);
    setBusy(false);
    if (res.ok) { setDone(true); onDone(); }
    else if (!String(res.error).startsWith('key_')) setMsg(messageFor(res.error));
  }

  return (
    <>
      {!keyOk && <KeyNotice state={keyState === 'checking' ? 'none' : keyState} demoKeys={f.demoKeys} onUseKey={f.useKey} onNotice={f.onNotice} />}
      <form id={compact ? `${p}form` : 'job-form'} noValidate className="grid gap-4" onSubmit={submit}>
        {!compact && (
          <div className="grid gap-1">
            <Label htmlFor={`${p}line`}>Line</Label>
            <Select value={form.line} onValueChange={set('line')} disabled={readOnly || !canEdit}>
              <SelectTrigger id={`${p}line`}><SelectValue placeholder="Choose a line" /></SelectTrigger>
              <SelectContent>{labels.map((l) => <SelectItem key={l} value={l}><span className="line-opt"><BayMarker letter={l} />{`Line ${l}`}</span></SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div className="grid gap-1">
          <Label htmlFor={`${p}title`}>Customer or job</Label>
          <Input id={`${p}title`} ref={titleRef} readOnly={readOnly} aria-invalid={invalid === 'title' || undefined} aria-describedby={invalid === 'title' ? msgId : undefined}
            maxLength={LIMITS.title} autoComplete="off" value={form.title} onChange={(e) => set('title')(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${p}details`}>Note</Label>
          <Input id={`${p}details`} readOnly={readOnly} maxLength={LIMITS.details} autoComplete="off" value={form.details} onChange={(e) => set('details')(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${p}initials`}>Initials</Label>
          <Input id={`${p}initials`} readOnly={readOnly} aria-invalid={invalid === 'initials' || undefined} aria-describedby={invalid === 'initials' ? msgId : undefined}
            maxLength={LIMITS.initials} autoComplete="off" value={form.initials} onChange={(e) => set('initials')(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${p}status`}>Status</Label>
          <Select value={form.status} onValueChange={set('status')} disabled={readOnly || !canEdit}>
            <SelectTrigger id={`${p}status`}><SelectValue /></SelectTrigger>
            <SelectContent>{statuses.map((s) => <SelectItem key={s.value} value={s.value}><StatusOption status={s.value} label={s.label} /></SelectItem>)}</SelectContent>
          </Select>
        </div>
        {job && !compact && (
          <p className="hint" id="job-meta" data-updated-by={job.updated_by || undefined}>
            {`Revision ${job.revision ?? 1}${job.updated_at ? `, updated ${stamp(job.updated_at)}` : ''}`}
            {job.updated_by ? <span id="job-updated-by">{`. Last edited by ${job.updated_by}${job.updated_at ? ` at ${stamp(job.updated_at)}` : ''}`}</span> : null}
          </p>
        )}
        <p id={msgId} className="msg" role="alert">{msg || reason}</p>
        <div className={compact ? 'popover-actions flex items-center gap-2' : 'dialog-actions flex items-center gap-2'}>
          {job && !compact && <Button id="job-delete" variant="destructive" disabled={busy || readOnly || !canEdit || stale === 'gone'} onClick={del}>{confirmDelete ? 'Confirm delete' : 'Delete job'}</Button>}
          <span className="flex-1" />
          <Button id={compact ? `${p}cancel` : 'job-cancel'} variant="outline" disabled={busy} onClick={onDone}>Cancel</Button>
          <Button id={compact ? `${p}save` : 'job-save'} type="submit" loading={busy} disabled={!usable}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </>
  );
}
