import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva('banner flex items-center gap-2 rounded-control border px-3 py-2 text-body-sm font-medium text-ink [&>svg]:size-4 [&>svg]:shrink-0', {
  variants: {
    variant: {
      info: 'border-line-strong bg-panel',
      warn: 'border-dot-warn bg-warn',
      error: 'border-danger bg-error',
    },
  },
  defaultVariants: { variant: 'info' },
});

// Flat bar: icon, one sentence, optional action (children after the text).
export function Alert({ className, variant, ...props }) {
  return <div role="status" data-variant={variant ?? 'info'} className={cn(alertVariants({ variant }), className)} {...props} />;
}
export function AlertDescription({ className, ...props }) {
  return <span className={cn('min-w-0 flex-1', className)} {...props} />;
}
