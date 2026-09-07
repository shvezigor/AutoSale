'use client';

import type { ConversationOrderState } from '../../../../packages/contracts/src/conversations';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { createConversationOrder, refreshConversationOrder } from '../api/conversation-replies';
import { useToast } from './toast-provider';

const POLL_INTERVAL_MS = 2_000;

export function ConversationOrderPanel({
  conversationId,
  customerName,
  customerUsername,
  initialState,
}: {
  conversationId: string;
  customerName: string;
  customerUsername: string | null;
  initialState: ConversationOrderState;
}) {
  const [state, setState] = useState(initialState);
  const [creating, setCreating] = useState(false);
  const refreshInFlight = useRef(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (cancelled || document.visibilityState === 'hidden' || refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        const next = await refreshConversationOrder(conversationId);
        if (!cancelled) {
          setState(next);
          if (next.order) setCreating(false);
        }
      } catch {
        // Preserve the last state during a temporary background refresh failure.
      } finally {
        refreshInFlight.current = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [conversationId]);

  async function create() {
    if (creating || state.order) return;
    setCreating(true);
    try {
      const result = await createConversationOrder(conversationId);
      if (result.orderId) {
        setState({ order: { id: result.orderId, status: 'AI_PROCESSING' } });
        setCreating(false);
      } else {
        toast.show({ type: 'info', title: 'AI аналізує переписку' });
      }
    } catch {
      setCreating(false);
      toast.show({
        type: 'error', title: 'Не вдалося створити замовлення',
        message: 'Перевірте, чи в діалозі є повідомлення, та спробуйте ще раз.',
      });
    }
  }

  return (
    <aside className="order-panel">
      <h2>Інформація про замовлення</h2>
      {state.order ? (
        <div className="order-empty">
          <div className="bag-icon" aria-hidden="true">□</div>
          <strong>{orderStatusLabel(state.order.status)}</strong>
          <p>{state.order.status === 'AI_PROCESSING'
            ? 'AI аналізує переписку та зіставляє товари з каталогом.'
            : 'Замовлення створено. Відкрийте його, щоб перевірити деталі.'}</p>
          <Link className="primary-button button-link" href={`/orders/${state.order.id}`}>Відкрити замовлення</Link>
        </div>
      ) : (
        <div className="order-empty">
          <div className="bag-icon" aria-hidden="true">□</div>
          <strong>{creating ? 'Створюємо замовлення…' : 'Замовлення ще не створено'}</strong>
          <p>{creating
            ? 'AI аналізує переписку. Це може зайняти кілька секунд.'
            : 'Запустіть AI, щоб розпізнати клієнта, товари та адресу з переписки.'}</p>
          <button onClick={() => void create()} type="button" disabled={creating}>
            {creating ? 'Створюємо…' : 'Створити замовлення'}
          </button>
        </div>
      )}
      <section className="customer-data"><h3>Дані клієнта</h3><dl><div><dt>Канал</dt><dd>Instagram</dd></div><div><dt>Ім’я</dt><dd>{customerName}</dd></div>{customerUsername && <div><dt>Username</dt><dd>@{customerUsername}</dd></div>}</dl></section>
    </aside>
  );
}

function orderStatusLabel(status: NonNullable<ConversationOrderState['order']>['status']) {
  if (status === 'AI_PROCESSING') return 'AI аналізує замовлення';
  if (status === 'AI_FAILED') return 'Потрібна повторна обробка';
  if (status === 'NEEDS_REVIEW') return 'Очікує перевірки менеджера';
  if (status === 'CANCELLED') return 'Замовлення скасовано';
  return 'Замовлення готове';
}
