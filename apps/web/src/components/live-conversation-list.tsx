'use client';

import type { ConversationListResponse } from '../../../../packages/contracts/src/conversations';
import { useEffect, useRef, useState } from 'react';

import { refreshConversationList } from '../api/conversation-replies';
import { ConversationList } from './conversation-list';

const POLL_INTERVAL_MS = 3_000;

export function LiveConversationList({
  conversations: initialConversations,
  selectedId,
}: {
  conversations: ConversationListResponse['items'];
  selectedId?: string | undefined;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const refreshInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (cancelled || document.visibilityState === 'hidden' || refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        const response = await refreshConversationList();
        if (!cancelled) setConversations(response.items);
      } catch {
        // Keep the last usable list during a temporary background refresh failure.
      } finally {
        refreshInFlight.current = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <>
      <ConversationList conversations={conversations} selectedId={selectedId} />
      <footer className="dialog-count">Усього діалогів: {conversations.length}</footer>
    </>
  );
}
