import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import { usePortalContainer } from './portal-container';

export const Dialog = DialogPrimitive.Root;
export const DialogTitle = ({ className, ...props }) => <DialogPrimitive.Title className={cn('m-0 text-title font-semibold text-ink', className)} {...props} />;
export const DialogDescription = ({ className, ...props }) => <DialogPrimitive.Description className={cn('sr-only', className)} {...props} />;

export function DialogContent({ className, children, ...props }) {
  const container = usePortalContainer();
  return (
    <DialogPrimitive.Portal container={container}>
      <DialogPrimitive.Overlay className="scrim" />
      <DialogPrimitive.Content
        className={cn('floating fixed inset-0 z-50 m-auto h-fit max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain w-[min(440px,calc(100vw-24px))] p-6 outline-none', className)} {...props}>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
