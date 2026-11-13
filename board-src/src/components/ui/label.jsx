import { cn } from '@/lib/utils';

export function Label({ className, ...props }) {
  return <label className={cn('text-body-sm font-medium text-ink', className)} {...props} />;
}
