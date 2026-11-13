import { cn } from '@/lib/utils';

// Static placeholder: no shimmer, no loop.
export function Skeleton({ className, ...props }) {
  return <div aria-hidden="true" className={cn('skel', className)} {...props} />;
}
