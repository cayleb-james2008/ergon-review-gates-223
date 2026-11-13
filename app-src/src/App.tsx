// App — face + view from the query string so captures are deterministic and repeatable:
//   ?face=desktop|mobile (default: by viewport width)  &view=chat|tasks|decisions|make  &reset=1
// There is no backend: the product's state lives in localStorage and the reply engine is the NAMED
// FIXTURE in data/fixtures.ts.
import { useEffect } from 'react';
import { MotionConfig } from 'motion/react';
import { Desktop, type ViewId } from './faces/Desktop';
import { Mobile } from './faces/Mobile';
import { resetIfRequested, useErgon } from './data/store';

resetIfRequested();

const params = new URLSearchParams(window.location.search);
const faceParam = params.get('face');
const viewParam = params.get('view');
const initialView: ViewId | 'make' = viewParam === 'tasks' || viewParam === 'decisions' || viewParam === 'make' ? viewParam : 'chat';
const face = faceParam === 'desktop' || faceParam === 'mobile'
  ? faceParam
  : (window.innerWidth < 760 ? 'mobile' : 'desktop');

export default function App() {
  const settings = useErgon((s) => s.settings);

  // Appearance settings take effect on the document too (density scale + reduced motion), and persist
  // because they are read from the stored record on every load.
  useEffect(() => {
    document.documentElement.dataset.density = settings.density;
    document.documentElement.dataset.motion = settings.motion;
  }, [settings.density, settings.motion]);

  return (
    <MotionConfig reducedMotion={settings.motion === 'reduced' ? 'always' : 'user'}>
      {face === 'mobile' ? <Mobile initialView={initialView} /> : <Desktop initialView={initialView === 'make' ? 'chat' : initialView} />}
    </MotionConfig>
  );
}
