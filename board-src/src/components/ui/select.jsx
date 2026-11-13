import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePortalContainer } from './portal-container';
import { Chevron } from '@/components/StatusBadge';

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

// variant "field" looks like an input (dialog forms); variant "status" is the compact badge in a job card (see styles.css .status).
export function SelectTrigger({ className, variant = 'field', children, ...props }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(variant === 'field'
        ? 'flex h-8 w-full items-center justify-between gap-2 rounded-control border border-field-line bg-field px-3 text-body-sm text-ink outline-offset-2 transition-[border-color,scale] duration-(--motion-tap) ease-(--ease) hover:border-ink focus-visible:outline-2 focus-visible:outline-ring active:scale-[0.97] motion-reduce:active:scale-100 data-[placeholder]:text-muted aria-invalid:border-danger aria-invalid:focus-visible:outline-danger disabled:cursor-not-allowed disabled:opacity-(--opacity-disabled) pointer-coarse:h-11 [&>span]:flex [&>span]:items-center [&>span]:gap-2'
        : 'status', className)}
      {...props}>
      {children}
      <SelectPrimitive.Icon asChild>
        {variant === 'field' ? <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted" /> : <Chevron />}
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

// A long list (the 19 lines) scrolls under the viewport's own hidden scrollbar, so Radix's scroll buttons are the visible cue: a chevron bar at the
// edge that still has more to show. They appear only while the list can scroll that way.
const scrollButton = 'select-scroll flex h-6 shrink-0 cursor-default items-center justify-center text-muted [&_svg]:size-4';
export function SelectContent({ className, children, ...props }) {
  const container = usePortalContainer();
  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Content position="popper" sideOffset={4} collisionPadding={8}
        className={cn('floating z-50 min-w-(--radix-select-trigger-width) max-h-(--radix-select-content-available-height) overflow-hidden rounded-card p-1 text-body-sm', className)} {...props}>
        <SelectPrimitive.ScrollUpButton className={scrollButton}><ChevronUp aria-hidden="true" /></SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className={scrollButton}><ChevronDown aria-hidden="true" /></SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ className, children, ...props }) {
  return (
    <SelectPrimitive.Item
      className={cn('relative flex cursor-pointer select-none items-center gap-2 rounded-badge py-2 pl-2 pr-8 text-body-sm text-ink outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-(--opacity-disabled) pointer-coarse:py-3 [&_svg]:size-4 [&_svg]:shrink-0', className)}
      {...props}>
      <SelectPrimitive.ItemText>
        <span className="inline-flex items-center">{children}</span>
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex"><Check aria-hidden="true" className="size-4" /></SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
