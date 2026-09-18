'use client';

import { useState } from 'react';
import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';

export interface OrderSettings {
  intentDetectionMode: 'PHRASE_ONLY' | 'AI_SUGGESTION' | 'AI_AUTOMATION';
  approvalMode: 'ALWAYS' | 'NEVER' | 'ON_LOW_CONFIDENCE';
  autoApprovalThreshold: number;
  promptVersion: string;
  triggerPhrases: string[];
}

export function OrderSettingsForm({ initial }: { initial: OrderSettings }) {
  const [intentMode, setIntentMode] = useState(initial.intentDetectionMode);
  const [mode, setMode] = useState(initial.approvalMode);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const activity = useActivity();
  const toast = useToast();
  const { t } = useI18n();
  const modes = [
    { value: 'ALWAYS' as const, title: t('settings.approvalAlways'), description: t('settings.approvalAlwaysDescription') },
    { value: 'ON_LOW_CONFIDENCE' as const, title: t('settings.approvalLowConfidence'), description: t('settings.approvalLowConfidenceDescription') },
    { value: 'NEVER' as const, title: t('settings.approvalNever'), description: t('settings.approvalNeverDescription') },
  ];
  const intentModes = [
    { value: 'PHRASE_ONLY' as const, title: t('settings.intentPhraseOnly'), description: t('settings.intentPhraseOnlyDescription') },
    { value: 'AI_SUGGESTION' as const, title: t('settings.intentSuggestion'), description: t('settings.intentSuggestionDescription') },
    { value: 'AI_AUTOMATION' as const, title: t('settings.intentAutomation'), description: t('settings.intentAutomationDescription') },
  ];

  async function save() {
    setState('saving');
    const response = await activity.run(t('settings.savingApprovalRules'), () => mutatingFetch('/api/settings/orders', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intentDetectionMode: intentMode, approvalMode: mode }),
    }));
    setState(response.ok ? 'saved' : 'error');
    toast.show(response.ok ? { type: 'success', title: t('settings.settingsSaved') } : { type: 'error', title: t('settings.settingsSaveFailed') });
  }

  return (
    <section className="settings-card" aria-labelledby="approval-title">
      <div className="settings-card-heading">
        <div>
          <h2 id="approval-title">{t('settings.approvalCardTitle')}</h2>
          <p>{t('settings.approvalCardDescription')}</p>
        </div>
        <span className="prompt-version">{initial.promptVersion}</span>
      </div>
      <div className="settings-subsection">
        <h3>{t('settings.intentModeTitle')}</h3>
        <p>{t('settings.intentModeDescription')}</p>
      </div>
      <fieldset className="approval-options">
        <legend className="sr-only">{t('settings.intentModeTitle')}</legend>
        {intentModes.map((item) => (
          <label className="approval-option" data-selected={intentMode === item.value} key={item.value}>
            <input aria-label={item.title} checked={intentMode === item.value} name="intentDetectionMode" onChange={() => { setIntentMode(item.value); setState('idle'); }} type="radio" />
            <span><strong>{item.title}</strong><small>{item.description}</small></span>
          </label>
        ))}
      </fieldset>
      <div className="settings-subsection">
        <h3>{t('settings.approvalMode')}</h3>
      </div>
      <fieldset className="approval-options">
        <legend className="sr-only">{t('settings.approvalMode')}</legend>
        {modes.map((item) => (
          <label className="approval-option" data-selected={mode === item.value} key={item.value}>
            <input
              aria-label={item.title}
              checked={mode === item.value}
              name="approvalMode"
              onChange={() => { setMode(item.value); setState('idle'); }}
              type="radio"
            />
            <span><strong>{item.title}</strong><small>{item.description}</small></span>
          </label>
        ))}
      </fieldset>
      <div className="settings-actions">
        <LoadingButton pending={state === 'saving'} pendingLabel={t('settings.saving')} onClick={() => void save()} type="button">{t('settings.saveSettings')}</LoadingButton>
        {state === 'saved' && <span className="save-success">{t('settings.settingsSaved')}</span>}
        {state === 'error' && <span className="save-error">{t('settings.saveFailedShort')}</span>}
      </div>
    </section>
  );
}
