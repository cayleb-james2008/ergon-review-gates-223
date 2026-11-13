import { Suspense, lazy, useEffect } from 'react';
import { NOTICES } from '@/core/key';

// A static flag: in any other build this is null and the demo chunk is not emitted.
const DemoKeys = import.meta.env.VITE_BACKEND === 'demo' ? lazy(() => import('./DemoKeys')) : null;

// Shown in place of saving when there is no usable key: one plain sentence, no input. Tells the board a key is needed (the handle's accent state).
export function KeyNotice({ state, demoKeys, onUseKey, onNotice }) {
  useEffect(() => { onNotice?.(1); return () => onNotice?.(-1); }, [onNotice]);
  return (
    <div className="key-notice grid gap-2" role="alert" data-key-state={state}>
      <p className="m-0 text-body-sm font-medium">{NOTICES[state] ?? NOTICES.none}</p>
      {DemoKeys && demoKeys && <Suspense fallback={null}><DemoKeys keys={demoKeys} onUse={onUseKey} /></Suspense>}
    </div>
  );
}
