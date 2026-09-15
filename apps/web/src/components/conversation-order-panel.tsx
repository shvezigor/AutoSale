'use client';

import type { ConversationOrderState } from '../../../../packages/contracts/src/conversations';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { createConversationOrder, refreshConversationOrder } from '../api/conversation-replies';
import { useToast } from './toast-provider';
import { useI18n } from '../i18n/i18n-provider';

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
  const { t } = useI18n();

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
        toast.show({ type: 'info', title: t('conversations.aiAnalyzing') });
      }
    } catch {
      setCreating(false);
      toast.show({
        type: 'error', title: t('conversations.createFailed'),
        message: t('conversations.createFailedHint'),
      });
    }
  }

  return (
    <aside className="order-panel">
      <h2>{t('conversations.orderInformation')}</h2>
      {state.order ? (
        <div className="order-empty">
          <div className="bag-icon" aria-hidden="true">□</div>
          <strong>{orderStatusLabel(state.order.status, t)}</strong>
          <p>{state.order.status === 'AI_PROCESSING'
            ? t('conversations.processingDescription')
            : t('conversations.createdDescription')}</p>
          <Link className="primary-button button-link" href={`/orders/${state.order.id}`}>{t('conversations.openOrder')}</Link>
        </div>
      ) : (
        <div className="order-empty">
          <div className="bag-icon" aria-hidden="true">□</div>
          <strong>{creating ? t('conversations.creatingOrder') : t('conversations.noOrder')}</strong>
          <p>{creating
            ? t('conversations.creatingDescription')
            : t('conversations.createDescription')}</p>
          <button onClick={() => void create()} type="button" disabled={creating}>
            {creating ? t('conversations.creating') : t('conversations.createOrder')}
          </button>
        </div>
      )}
      <section className="customer-data"><h3>{t('conversations.customerData')}</h3><dl><div><dt>{t('conversations.channel')}</dt><dd>Instagram</dd></div><div><dt>{t('conversations.name')}</dt><dd>{customerName}</dd></div>{customerUsername && <div><dt>Username</dt><dd>@{customerUsername}</dd></div>}</dl></section>
    </aside>
  );
}

function orderStatusLabel(status: NonNullable<ConversationOrderState['order']>['status'], t: ReturnType<typeof useI18n>['t']) {
  if (status === 'AI_PROCESSING') return t('conversations.processingOrder');
  if (status === 'AI_FAILED') return t('conversations.processingFailed');
  if (status === 'NEEDS_REVIEW') return t('conversations.managerReview');
  if (status === 'CANCELLED') return t('conversations.cancelled');
  return t('conversations.ready');
}
