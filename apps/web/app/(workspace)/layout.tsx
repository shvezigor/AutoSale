import type { ReactNode } from 'react';

import { getServerSession } from '../../src/auth/session';
import { AuthenticatedShell } from '../../src/components/authenticated-shell';

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) return null;

  return <AuthenticatedShell active="conversations" session={session}>{children}</AuthenticatedShell>;
}
