import { TriangleAlert, WifiOff } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

// Each banner: icon, one sentence, optional action.
export function Banners({ items, onRetry, onDismiss }) {
  return (
    <div id="banners" className="banners">
      {items.map((b) => (
        <Alert key={b.kind + b.text} {...(b.alert ? { role: 'alert' } : {})} variant={b.kind === 'offline' ? 'info' : b.kind}>
          {b.kind === 'offline' ? <WifiOff aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
          <AlertDescription>{b.text}</AlertDescription>
          {b.retry && <Button variant="outline" className="ml-auto" onClick={onRetry}>Retry</Button>}
          {b.dismiss && <Button variant="outline" className="ml-auto" onClick={onDismiss}>Dismiss</Button>}
        </Alert>
      ))}
    </div>
  );
}
