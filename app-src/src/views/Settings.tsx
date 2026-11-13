// views/Settings.tsx — the settings surface (Ticket 064): reachable in ONE obvious action from the main
// shell on both faces, with account / agent-preferences / appearance controls that change state and
// PERSIST across a full reload. Presented in the real Motion Primitives morphing dialog.
import { useState } from 'react';
import { SettingsIcon } from 'lucide-react';
import {
  MorphingDialog, MorphingDialogTrigger, MorphingDialogContent, MorphingDialogContainer,
  MorphingDialogTitle, MorphingDialogSubtitle, MorphingDialogClose,
} from '../vendor/mp/morphing-dialog';
import { useErgon, updateSettings } from '../data/store';
import type { Settings as SettingsModel } from '../data/fixtures';
import { dur, ease } from '../motion';

export function SettingsSurface({ compact = false }: { compact?: boolean }) {
  const settings = useErgon((s) => s.settings);
  const [name, setName] = useState(settings.displayName);

  function set<K extends keyof SettingsModel>(key: K, value: SettingsModel[K]) {
    updateSettings({ [key]: value } as Partial<SettingsModel>);
  }

  return (
    <MorphingDialog transition={{ duration: dur.sheet, ease }}>
      <MorphingDialogTrigger className={`settings-trigger${compact ? ' compact' : ''}`} triggerLabel="Settings">
        <span className="settings-trigger-inner" data-testid="settings-trigger">
          <SettingsIcon size={compact ? 18 : 16} strokeWidth={1.8} aria-hidden="true" />
          {compact ? null : <span>Settings</span>}
        </span>
      </MorphingDialogTrigger>
      <MorphingDialogContainer>
        <MorphingDialogContent className="settings-sheet">
          <MorphingDialogClose className="dialog-close" />
          <div data-testid="settings-surface">
          <div className="settings-eyebrow">Settings</div>
          <MorphingDialogTitle className="settings-title">Your account and your agent</MorphingDialogTitle>
          <MorphingDialogSubtitle className="settings-sub">
            Changes apply at once and persist in this browser across a reload.
          </MorphingDialogSubtitle>

          <section className="settings-group" aria-labelledby="settings-account">
            <h3 id="settings-account">Account</h3>
            <label className="settings-row">
              <span>Display name</span>
              <input
                value={name}
                onChange={(e) => { setName(e.target.value); set('displayName', e.target.value); }}
                aria-label="Display name"
                maxLength={40}
                data-testid="settings-name"
              />
            </label>
            <p className="settings-note">The thread labels your turns with this name. The agent stays "Your agent".</p>
          </section>

          <section className="settings-group" aria-labelledby="settings-agent">
            <h3 id="settings-agent">Agent preferences</h3>
            <div className="settings-row">
              <span>Reply style</span>
              <div className="seg" role="group" aria-label="Reply style">
                {(['concise', 'detailed'] as const).map((v) => (
                  <button
                    key={v} type="button"
                    className={settings.agentTone === v ? 'seg-on' : ''}
                    aria-pressed={settings.agentTone === v}
                    onClick={() => set('agentTone', v)}
                    data-testid={`settings-tone-${v}`}
                  >{v}</button>
                ))}
              </div>
            </div>
            <p className="settings-note">Concise answers in one line; detailed adds a concrete detail line to the same answer.</p>
            <label className="settings-row">
              <span>Morning brief at</span>
              <input
                type="time"
                value={settings.briefAt}
                onChange={(e) => { if (e.target.value) set('briefAt', e.target.value); }} /* an empty time is refused: the brief would read "tomorrow at ." (X-4) */
                aria-label="Morning brief time"
                data-testid="settings-brief"
              />
            </label>
            <p className="settings-note">The brief and its next-brief line run on the demo clock (Sun 8 Nov 2026, 12:00); the next scheduled brief is computed from this time.</p>
          </section>

          <section className="settings-group" aria-labelledby="settings-appearance">
            <h3 id="settings-appearance">Appearance</h3>
            <div className="settings-row">
              <span>Density</span>
              <div className="seg" role="group" aria-label="Density">
                {(['comfortable', 'compact'] as const).map((v) => (
                  <button
                    key={v} type="button"
                    className={settings.density === v ? 'seg-on' : ''}
                    aria-pressed={settings.density === v}
                    onClick={() => set('density', v)}
                    data-testid={`settings-density-${v}`}
                  >{v}</button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <span>Motion</span>
              <div className="seg" role="group" aria-label="Motion">
                {(['full', 'reduced'] as const).map((v) => (
                  <button
                    key={v} type="button"
                    className={settings.motion === v ? 'seg-on' : ''}
                    aria-pressed={settings.motion === v}
                    onClick={() => set('motion', v)}
                    data-testid={`settings-motion-${v}`}
                  >{v}</button>
                ))}
              </div>
            </div>
            <p className="settings-note" data-testid="settings-summary">
              Account: <span className="mono">{settings.displayName || '—'}</span> · reply style: <span className="mono">{settings.agentTone}</span> · brief: <span className="mono">{settings.briefAt}</span> · density: <span className="mono">{settings.density}</span> · motion: <span className="mono">{settings.motion}</span>
            </p>
          </section>
          </div>
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  );
}

export default SettingsSurface;
