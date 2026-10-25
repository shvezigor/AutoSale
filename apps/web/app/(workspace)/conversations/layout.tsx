import type { ReactNode } from 'react';

import { getConversations, getConversationStatusCounts } from '../../../src/api/conversations';
import { InboxShell } from '../../../src/components/inbox-shell';

export default async function ConversationsLayout({ children }: { children: ReactNode }) {
  const [initialPage, initialCounts] = await Promise.all([getConversations({ status: 'ACTIVE' }), getConversationStatusCounts()]);

  return <InboxShell initialPage={initialPage} initialCounts={initialCounts}>{children}</InboxShell>;
}
