import { TriangleAlert, WifiOff } from 'lucide-react';
import { STATUSES } from '@/config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusBadge, StatusOption } from '@/components/StatusBadge';
import { Job } from '@/components/Job';
import { Bubble } from '@/components/Bubble';
import { KeyChip } from '@/components/KeyChip';
import { KeyNotice } from '@/components/KeyNotice';
import { JobForm } from '@/components/JobForm';
import { DEMO_KEYS } from '@/data/demo';
import { DragHandle } from '@/components/DragHandle';
import { BayMarker } from '@/components/BayMarker';
import { LegendChip, Connection, TestMarker, VersionLabel } from '@/components/Header';
import { Message, BoardNote } from '@/components/Board';

// One renderer per component and declared state (design/components/*.json). Forced states use data-demo, the real components do the rest.
export const TALL = { 'select:open': true, 'dialog:open': true, 'dialog:loading': true, 'dialog:error': true, 'popover:open': true, 'popover:error': true, 'tooltip:open': true };

const noop = () => {};
const job = (status, o = {}) => ({ id: `j-${status}`, title: 'TEST Harbour Bakery', details: 'Pallet 4, chilled', initials: 'AB', status, revision: 1, is_test: true, ...o });
const ctx = (unlocked) => ({ unlocked, canEdit: true, onEdit: noop, onStatus: noop, onRetry: noop });
const JobSpec = ({ j, unlocked = false, ...p }) => <div className="jobs guide-jobs" role="list"><Job job={j} line="C" ctx={ctx(unlocked)} fresh={false} measure {...p} /></div>;

const btn = (props, label = 'Save') => () => <Button data-measure="" {...props}>{label}</Button>;
const inp = (props) => () => <Input data-measure="" aria-label="Customer or job" placeholder="Customer or job" {...props} />;
const sel = ({ demo, open, disabled }) => () => (
  <Select defaultValue="A" defaultOpen={open} disabled={disabled}>
    <SelectTrigger data-measure="" data-demo={demo} aria-label="Line"><SelectValue /></SelectTrigger>
    <SelectContent>{['A', 'B', 'C'].map((l) => <SelectItem key={l} value={l}>{`Line ${l}`}</SelectItem>)}</SelectContent>
  </Select>
);
const editable = (props) => () => {
  const select = (
    <Select value="ready" disabled={props?.disabled}>
      <SelectTrigger variant="status" data-measure={props?.inCard ? undefined : ''} data-status="ready" data-demo={props?.demo} aria-label="Status"><SelectValue /></SelectTrigger>
      <SelectContent>{STATUSES.map((s) => <SelectItem key={s.value} value={s.value}><StatusOption status={s.value} label={s.label} /></SelectItem>)}</SelectContent>
    </Select>
  );
  // the badge draws no outline of its own: its focus outline is the job card's, so that specimen sits inside a card
  return props?.inCard ? <div className="job" data-measure="">{select}</div> : select;
};
const lineField = () => (
  <Select defaultValue="C">
    <SelectTrigger data-measure="" aria-label="Line"><SelectValue /></SelectTrigger>
    <SelectContent>{['A', 'B', 'C'].map((l) => <SelectItem key={l} value={l}><span className="line-opt"><BayMarker letter={l} />{`Line ${l}`}</span></SelectItem>)}</SelectContent>
  </Select>
);
const dlg = (state) => (theme) => {
  const id = `dlg-${theme}-${state}`;
  return (
    <Dialog open modal={false}>
      <DialogContent data-measure="" onOpenAutoFocus={(e) => e.preventDefault()}>
        <form className="guide-form" noValidate onSubmit={(e) => e.preventDefault()}>
          <DialogTitle>Edit job</DialogTitle>
          <DialogDescription>Change the job, then press Save.</DialogDescription>
          <Label htmlFor={id}>Customer or job</Label>
          <Input id={id} defaultValue="TEST Harbour Bakery" aria-invalid={state === 'error' || undefined} />
          <p className="msg" role="alert">{state === 'error' ? 'Could not reach the server. Check the connection, then press Save.' : ''}</p>
          <div className="guide-actions"><span className="flex-1" /><Button variant="outline">Cancel</Button><Button type="submit" loading={state === 'loading'}>{state === 'loading' ? 'Saving…' : 'Save'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
const pop = (state) => () => (
  <Popover open>
    <PopoverAnchor asChild><div className="guide-anchor">Add job on line C</div></PopoverAnchor>
    <PopoverContent align="start" className="w-90" data-measure="" onOpenAutoFocus={(e) => e.preventDefault()}>
      <JobForm compact p={`guide-${state}-`} lineLabel="C" job={null} form={formObj({})} onDone={noop} demo={{ msg: state === 'error' ? 'Could not reach the server. Check the connection, then press Save.' : '' }} />
    </PopoverContent>
  </Popover>
);
const bub = (o) => () => <Bubble isStatic keyState="valid" subject="Demo employee" expiresAt="2099-01-01T00:00:00.000Z" canEdit query="" onQuery={noop} onAdd={noop} agentState="idle" {...o} />;
const formObj = (o) => ({ labels: ['A', 'B', 'C'], statuses: STATUSES, keyState: 'valid', subject: 'Demo employee', canEdit: true, demoKeys: DEMO_KEYS, useKey: noop, onNotice: noop, save: async () => ({ ok: true }), remove: async () => ({ ok: true }), ...o });
const alert = (variant, Icon, text, action) => () => (
  <Alert variant={variant} data-measure=""><Icon aria-hidden="true" /><AlertDescription>{text}</AlertDescription>{action && <Button variant="outline" className="ml-auto">Retry</Button>}</Alert>
);
const marker = (kind) => () => (
  <div className={kind === 'dim' ? 'row dim guide-row-fit' : 'row guide-row-fit'} data-empty={kind === 'empty' ? 'true' : undefined} data-loading={kind === 'loading' ? 'true' : undefined}>
    <div className="label" data-measure="" data-tally={kind === 'occupied' || kind === 'tally' ? '2/3' : undefined}>C</div>
    <div className="jobs">{kind === 'occupied' ? <><Job job={job('open', { id: 'a1' })} line="C" ctx={ctx(false)} fresh={false} /><Job job={job('ready', { id: 'a2', title: 'TEST Kestrel Cycles', details: '', initials: 'JS' })} line="C" ctx={ctx(false)} fresh={false} /></> : null}</div>
  </div>
);

const chip = (hue, initials) => () => <ul className="legend guide-legend"><LegendChip initials={initials} hue={hue} measure /></ul>;
const conn = (state, label) => () => <Connection conn={state} label={label} measure />;
const cj = (j) => ({ ...j, initials: 'JA' }); // a mapped initials value, so the specimen shows the tint
const compact = (j, o = {}, p = {}) => () => <div className="row guide-row-fit" data-density="compact"><div className="label">C</div><div className="jobs"><JobSpecCompact j={j} ctx={o} {...p} /></div></div>;
function JobSpecCompact({ j, ctx: o, ...p }) { return <Job job={j} line="C" ctx={{ ...ctx(true), ...o }} fresh={false} measure compact {...p} />; }

export const SPECIMENS = {
  button: {
    default: btn({}), hover: btn({ 'data-demo': 'hover' }), press: btn({ 'data-demo': 'press' }), focus: btn({ 'data-demo': 'focus' }),
    disabled: btn({ disabled: true }), loading: btn({ loading: true }, 'Saving…'),
    secondary: btn({ variant: 'secondary' }, 'Edit'), outline: btn({ variant: 'outline' }, 'Cancel'), ghost: btn({ variant: 'ghost' }, 'Close'), destructive: btn({ variant: 'destructive' }, 'Delete job'),
  },
  input: {
    default: inp({}), hover: inp({ 'data-demo': 'hover' }), focus: inp({ 'data-demo': 'focus' }), filled: inp({ defaultValue: 'TEST Harbour Bakery' }),
    disabled: inp({ disabled: true }), error: inp({ 'aria-invalid': true, defaultValue: 'x' }),
  },
  select: { default: sel({}), hover: sel({ demo: 'hover' }), press: sel({ demo: 'press' }), bay: lineField, focus: sel({ demo: 'focus' }), disabled: sel({ disabled: true }), open: sel({ open: true }) },
  dialog: { open: dlg('open'), loading: dlg('loading'), error: dlg('error') },
  popover: { open: pop('open'), error: pop('error') },
  badge: {
    open: () => <StatusBadge status="open" data-measure="" />, hold: () => <StatusBadge status="hold" />, ready: () => <StatusBadge status="ready" />, done: () => <StatusBadge status="done" />,
    editable: editable({}), 'editable-hover': editable({ demo: 'hover' }), 'editable-focus': editable({ demo: 'focus', inCard: true }), 'editable-disabled': editable({ disabled: true }),
  },
  alert: {
    info: alert('info', WifiOff, 'Offline. Showing the last saved board. Editing is paused.'),
    warn: alert('warn', TriangleAlert, 'Only 18 of 19 lines are set up.'),
    error: alert('error', TriangleAlert, 'The board could not be refreshed. Showing the last saved board.'),
    'with-action': alert('error', TriangleAlert, 'The board could not be refreshed. Retrying shortly.', true),
  },
  skeleton: { default: () => <div className="jobs guide-jobs" data-measure=""><Skeleton /><Skeleton /></div> },
  tooltip: {
    open: () => (
      <Tooltip open>
        <TooltipTrigger asChild><span className="inline-flex"><Button variant="outline" disabled>Edit</Button></span></TooltipTrigger>
        <TooltipContent data-measure="">Editing is paused until the connection returns</TooltipContent>
      </Tooltip>
    ),
  },
  bubble: { idle: bub({}), 'needs-you': bub({ agentState: 'needs-you' }), 'no-key': bub({ keyState: 'none', subject: '' }), disabled: bub({ canEdit: false }) },
  'key-chip': { none: () => <KeyChip state="none" />, valid: () => <KeyChip state="valid" subject="Demo employee" />, expired: () => <KeyChip state="expired" />, invalid: () => <KeyChip state="invalid" /> },
  'key-notice': { none: () => <KeyNotice state="none" demoKeys={DEMO_KEYS} onUseKey={noop} onNotice={noop} />, expired: () => <KeyNotice state="expired" onUseKey={noop} onNotice={noop} />, invalid: () => <KeyNotice state="invalid" onUseKey={noop} onNotice={noop} /> },
  'job-card': {
    open: () => <JobSpec j={job('open')} />, hold: () => <JobSpec j={job('hold')} />, ready: () => <JobSpec j={job('ready')} />, done: () => <JobSpec j={job('done')} />,
    untitled: () => <JobSpec j={job('open', { title: '', details: '' })} />,
    editable: () => <JobSpec j={job('hold')} unlocked />, hover: () => <JobSpec j={job('open')} unlocked demo="hover" />, focus: () => <JobSpec j={job('open')} unlocked demo="focus" />,
    hit: () => <JobSpec j={job('open')} hit />, dim: () => <JobSpec j={job('open')} dim />, cue: () => <JobSpec j={job('ready')} demo="cue" />,
  },
  'line-row': { occupied: marker('occupied'), empty: marker('empty'), dim: marker('dim') },
  'line-label': { occupied: marker('occupied'), tally: marker('tally'), empty: marker('empty'), loading: marker('loading'), dim: marker('dim') },
  'legend-chip': { neutral: chip(null, 'XX'), blue: chip('blue', 'JA'), pink: chip('pink', 'JS'), orange: chip('orange', 'JG'), green: chip('green', 'AK'), purple: chip('purple', 'LB') },
  connection: { live: conn('live', 'Live'), polling: conn('polling', 'Reconnecting'), offline: conn('offline', 'Offline'), error: conn('error', 'Error') },
  'test-marker': { default: () => <TestMarker measure /> },
  'board-message': {
    error: () => <Message title="The board could not be loaded." text="Check the connection. It will try again automatically." action={<Button variant="outline">Retry</Button>} />,
    'not-set-up': () => <Message title="This board is not set up." text="The backend is not configured." />,
    'no-lines': () => <Message title="No lines are set up yet." />,
  },
  'board-note': { default: () => <div className="guide-note"><BoardNote /></div> },
  'version-label': { default: () => <div className="guide-version"><VersionLabel version="6f75ed4" /></div> },
  'job-card-compact': {
    default: compact(cj(job('ready'))), hover: compact(cj(job('open')), {}, { demo: 'hover' }), focus: compact(cj(job('open')), {}, { demo: 'focus' }),
    hit: compact(job('open'), {}, { hit: true }), dim: compact(job('open'), {}, { dim: true }), disabled: compact(job('hold'), { canEdit: false }),
  },
  'drag-handle': { idle: () => <DragHandle state="idle" measure />, working: () => <DragHandle state="working" measure />, 'needs-you': () => <DragHandle state="needs-you" measure /> },
};
