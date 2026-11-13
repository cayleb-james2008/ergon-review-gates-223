import { cn } from '@/lib/utils';

// Status badge shell. Colour comes from data-status in styles.css; the glyph and word are supplied by StatusBadge.
export function Badge({ status = 'open', className, ...props }) {
  return <span className={cn('status', className)} data-status={status} {...props} />;
}
