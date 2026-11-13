// The demo build's stand-in issuer: three quiet buttons that set a public test key, so a reviewer can walk every key state.
// Loaded only when VITE_BACKEND is demo (see KeyNotice); the production build contains none of it.
import { Button } from '@/components/ui/button';

export default function DemoKeys({ keys, onUse }) {
  return (
    <div className="demo-keys flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={() => onUse(keys.valid)}>Try editing</Button>
      <Button type="button" variant="outline" onClick={() => onUse(keys.expired)}>Try an ended session</Button>
      <Button type="button" variant="outline" onClick={() => onUse(keys.revoked)}>Try a turned-off session</Button>
    </div>
  );
}
