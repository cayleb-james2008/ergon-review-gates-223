import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { JobForm } from './JobForm';

// The job details: opens for any job, with or without a key (see JobForm). `job` null = a new job.
export function JobDialog({ open, job, live, lineLabel, form, onClose, returnFocus, demo }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent id="job-dialog" data-mode={job ? 'edit' : 'create'} data-job-id={job?.id} aria-labelledby="job-title"
        onOpenAutoFocus={(e) => { e.preventDefault(); document.getElementById('f-title')?.focus(); }}
        onCloseAutoFocus={(e) => { e.preventDefault(); returnFocus?.(); }}>
        <DialogTitle id="job-title">{job ? 'Edit job' : 'Add job'}</DialogTitle>
        <DialogDescription>{job ? 'Change the job, then press Save. Delete asks twice.' : 'Fill in the job, then press Save.'}</DialogDescription>
        <div className="mt-4 grid gap-4">
          <JobForm key={job?.id ?? 'new'} job={job} live={live} lineLabel={lineLabel} form={form} onDone={onClose} demo={demo} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
