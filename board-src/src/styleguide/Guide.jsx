import { useState } from 'react';
import { PortalContainer } from '@/components/ui/portal-container';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SPECIMENS, TALL } from './specimens';

const specs = Object.values(import.meta.glob('../../design/components/*.json', { eager: true, import: 'default' })).sort((a, b) => a.name.localeCompare(b.name));
const THEMES = ['light', 'dark'];

// One cell per theme. Floating layers mount inside their own cell so both themes can show them open at the same time.
function Cell({ theme, tall, children }) {
  const [el, setEl] = useState(null);
  return (
    <div className={tall ? 'cell tall' : 'cell'} data-theme={theme} ref={setEl}>
      {el && <PortalContainer.Provider value={el}><TooltipProvider>{children}</TooltipProvider></PortalContainer.Provider>}
    </div>
  );
}

export function Guide() {
  return (
    <div className="guide">
      <header className="guide-head">
        <h1>RHL lines board style guide</h1>
        <p>Every admitted component in every declared state, in both themes. Source: design/components. Checked by test/e2e/pack-check.test.mjs.</p>
      </header>
      {specs.map((spec) => (
        <section key={spec.name} className="guide-section" id={spec.name} data-component={spec.name}>
          <div className="guide-head">
            <h2>{spec.title}</h2>
            <p>{spec.notes}</p>
          </div>
          <div className="guide-themes"><span /><span>Light</span><span>Dark</span></div>
          {spec.states.map((state) => {
            const render = SPECIMENS[spec.name]?.[state];
            return (
              <div key={state} className="guide-row">
                <div className="guide-label">{state}</div>
                {THEMES.map((theme) => (
                  <Cell key={theme} theme={theme} tall={!!TALL[`${spec.name}:${state}`]}>
                    <div data-specimen="" data-component={spec.name} data-state={state} data-theme-of={theme}>
                      {render ? render(theme) : <span className="guide-missing">No specimen for {spec.name}, {state}</span>}
                    </div>
                  </Cell>
                ))}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
