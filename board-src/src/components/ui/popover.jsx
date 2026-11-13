import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';
import { usePortalContainer } from './portal-container';

export const Popover = PopoverPrimitive.Root;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ className, align = 'end', sideOffset = 8, ...props }) {
  const container = usePortalContainer();
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content align={align} sideOffset={sideOffset} collisionPadding={8} updatePositionStrategy="always"
        className={cn('floating z-50 w-(--bubble-w) max-w-[calc(100vw-16px)] max-h-(--radix-popover-content-available-height) overflow-y-auto overscroll-contain p-4 text-body-sm outline-none', className)} {...props} />
    </PopoverPrimitive.Portal>
  );
}
