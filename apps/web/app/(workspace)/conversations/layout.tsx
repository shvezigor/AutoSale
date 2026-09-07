import type { ReactNode } from 'react';

import { getConversations } from '../../../src/api/conversations';
import { InboxShell } from '../../../src/components/inbox-shell';

export default async function ConversationsLayout({ children }: { children: ReactNode }) {
  const conversations = await getConversations();

  return <InboxShell conversations={conversations.items}>{children}</InboxShell>;
}
