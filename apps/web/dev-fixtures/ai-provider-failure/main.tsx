import { createRoot } from 'react-dom/client';

import { conversationDetailResponseSchema } from '../../../../packages/contracts/src/conversations';
import { I18nProvider } from '../../src/i18n/i18n-provider';
import { SocialReplyComposer } from '../../src/components/social-reply-composer';
import { ToastProvider } from '../../src/components/toast-provider';
import '../../app/globals.css';
import './style.css';

async function mount() {
  const response = await fetch('/api/conversations/11111111-1111-4111-8111-111111111111');
  if (!response.ok) throw new Error('The isolated conversation fixture is unavailable');
  const conversation = conversationDetailResponseSchema.parse(await response.json());
  createRoot(document.getElementById('root')!).render(
    <I18nProvider locale="uk" authenticated>
      <ToastProvider>
        <main className="fixture-page">
          <p className="fixture-label">Локальна перевірка · вигадані дані</p>
          <section className="fixture-conversation" aria-label="Тестовий діалог">
            <header className="fixture-header">Умовний клієнт · Instagram</header>
            <SocialReplyComposer initialConversation={conversation} canManageSettings={false} draftsEnabled />
          </section>
        </main>
      </ToastProvider>
    </I18nProvider>,
  );
}

void mount().catch((error: unknown) => {
  document.getElementById('root')!.textContent = error instanceof Error ? error.message : 'Fixture failed';
});
