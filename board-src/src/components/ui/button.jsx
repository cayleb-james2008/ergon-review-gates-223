import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-body-sm font-medium cursor-pointer select-none outline-offset-2 transition-[background-color,border-color,scale] duration-(--motion-tap) ease-(--ease) focus-visible:outline-2 focus-visible:outline-ring active:scale-[0.97] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled) disabled:active:scale-100 [&_svg]:size-4 [&_svg]:shrink-0 h-8 px-3 pointer-coarse:h-11 pointer-coarse:min-w-11',
  {
    variants: {
      variant: {
        default: 'bg-primary text-on-accent hover:bg-primary-hover',
        outline: 'border border-field-line bg-transparent text-ink hover:bg-hover',
        secondary: 'bg-hover text-ink hover:bg-line-strong',
        ghost: 'bg-transparent text-ink hover:bg-hover',
        destructive: 'border border-danger bg-transparent text-danger hover:bg-hover',
      },
      size: { default: '', icon: 'w-8 px-0 pointer-coarse:w-11' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

// loading: the caller swaps the label to "Saving…"; the button stays visible but cannot be pressed twice.
export function Button({ className, variant, size, loading = false, disabled, type = 'button', ...props }) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading} aria-busy={loading || undefined} data-loading={loading || undefined} {...props} />
  );
}
