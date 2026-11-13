import { cn } from '@/lib/utils';

export function Input({ className, type = 'text', ...props }) {
  return (
    <input type={type}
      className={cn('h-8 w-full min-w-0 rounded-control border border-field-line bg-field px-3 text-body-sm text-ink outline-offset-2 placeholder:text-muted transition-[border-color] duration-(--motion-tap) ease-(--ease) hover:border-ink focus-visible:outline-2 focus-visible:outline-ring aria-invalid:border-danger aria-invalid:focus-visible:outline-danger read-only:cursor-default read-only:opacity-(--opacity-disabled) read-only:hover:border-field-line disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled) pointer-coarse:h-11', className)}
      {...props} />
  );
}
