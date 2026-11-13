import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';
import { usePortalContainer } from './portal-container';

export const TooltipProvider = ({ delayDuration = 400, ...props }) => <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({ className, sideOffset = 6, ...props }) {
  const container = usePortalContainer();
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Content sideOffset={sideOffset}
        className={cn('floating z-50 max-w-64 rounded-control px-2 py-1 text-label text-ink', className)} {...props} />
    </TooltipPrimitive.Portal>
  );
}
