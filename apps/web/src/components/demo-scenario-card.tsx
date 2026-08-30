'use client';

import Link from 'next/link';
import { useState } from 'react';

import { mutatingFetch } from '../auth/csrf-fetch';

export function DemoScenarioCard() {
  const [state, setState] = useState<'idle' | 'running' | 'created' | 'duplicate' | 'error'>('idle');

  async function start() {
    setState('running');
    const response = await mutatingFetch('/api/demo/order-scenario', { method: 'POST' });
    if (!response.ok) return setState('error');
    const result = await response.json() as { duplicate: boolean };
    setState(result.duplicate ? 'duplicate' : 'created');
  }

  const completed = state === 'created' || state === 'duplicate';
  return (
    <section className="settings-card demo-scenario-card" aria-labelledby="demo-scenario-title">
      <div className="settings-card-heading">
        <div>
          <h2 id="demo-scenario-title">Демонстраційний сценарій</h2>
          <p>Створіть тестову Instagram-переписку та пропустіть її через справжнє AI-розпізнавання.</p>
        </div>
        <span className="connection-status">DEMO</span>
      </div>
      <div className="demo-scenario-copy">
        <p>Буде додано товар «Сумка Luna чорна», діалог із клієнтом і підтвердження замовлення. Режим approval береться з ваших поточних налаштувань.</p>
      </div>
      <div className="settings-actions">
        <button disabled={state === 'running' || completed} onClick={() => void start()} type="button">
          {state === 'running' ? 'Обробка…' : 'Запустити демосценарій'}
        </button>
        {state === 'created' && <span className="save-success">Демодіалог передано на обробку</span>}
        {state === 'duplicate' && <span className="save-success">Демосценарій уже був створений</span>}
        {state === 'error' && <span className="save-error">Не вдалося запустити демосценарій</span>}
      </div>
      {completed && <nav className="demo-scenario-links" aria-label="Результати демосценарію"><Link href="/conversations">Відкрити діалоги</Link><Link href="/orders">Відкрити замовлення</Link></nav>}
    </section>
  );
}
