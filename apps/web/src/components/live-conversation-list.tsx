'use client';

import type { ConversationListResponse } from '../../../../packages/contracts/src/conversations';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { refreshConversationList } from '../api/conversation-replies';
import { ConversationList } from './conversation-list';

const POLL_INTERVAL_MS = 3_000;

export function LiveConversationList({
  conversations: initialConversations,
}: {
  conversations: ConversationListResponse['items'];
}) {
  const pathname = usePathname();
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
      <ConversationList conversations={conversations} selectedId={selectedConversationId(pathname)} />
      <footer className="dialog-count">Усього діалогів: {conversations.length}</footer>
    </>
  );
}

function selectedConversationId(pathname: string | null): string | undefined {
  if (!pathname) return undefined;
  const match = pathname.match(/^\/conversations\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
