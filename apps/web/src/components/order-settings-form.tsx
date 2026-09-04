'use client';

import { useState } from 'react';
import { mutatingFetch } from '../auth/csrf-fetch';
import { useActivity } from './activity-provider';
import { LoadingButton } from './loading-button';
import { useToast } from './toast-provider';

export interface OrderSettings {
  approvalMode: 'ALWAYS' | 'NEVER' | 'ON_LOW_CONFIDENCE';
  autoApprovalThreshold: number;
  promptVersion: string;
  triggerPhrases: string[];
}

const modes: Array<{
  value: OrderSettings['approvalMode'];
  title: string;
  description: string;
}> = [
  {
    value: 'ALWAYS',
    title: 'Завжди підтверджувати',
    description: 'Кожне AI-замовлення очікує перевірки менеджера.',
  },
  {
    value: 'ON_LOW_CONFIDENCE',
    title: 'Тільки при низькій впевненості',
    description: 'Повні надійні замовлення проходять автоматично, сумнівні — на перевірку.',
  },
  {
    value: 'NEVER',
    title: 'Без підтвердження',
    description: 'Валідні замовлення автоматично передаються на наступний етап.',
  },
];

export function OrderSettingsForm({ initial }: { initial: OrderSettings }) {
  const [mode, setMode] = useState(initial.approvalMode);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const activity = useActivity();
  const toast = useToast();

  async function save() {
    setState('saving');
    const response = await activity.run('Зберігаємо правила підтвердження', () => mutatingFetch('/api/settings/orders', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvalMode: mode }),
    }));
    setState(response.ok ? 'saved' : 'error');
    toast.show(response.ok ? { type: 'success', title: 'Налаштування збережено' } : { type: 'error', title: 'Не вдалося зберегти налаштування' });
  }

  return (
    <section className="settings-card" aria-labelledby="approval-title">
      <div className="settings-card-heading">
        <div>
          <h2 id="approval-title">Підтвердження замовлень</h2>
          <p>Оберіть, коли AI-результат має перевіряти менеджер.</p>
        </div>
        <span className="prompt-version">{initial.promptVersion}</span>
      </div>
      <fieldset className="approval-options">
        <legend className="sr-only">Режим підтвердження</legend>
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
        <LoadingButton pending={state === 'saving'} pendingLabel="Зберігаємо…" onClick={() => void save()} type="button">Зберегти налаштування</LoadingButton>
        {state === 'saved' && <span className="save-success">Налаштування збережено</span>}
        {state === 'error' && <span className="save-error">Не вдалося зберегти</span>}
      </div>
    </section>
  );
}
