import type { ReactNode } from 'react';

import { getServerSession } from '../../src/auth/session';
import { AdminShell } from '../../src/components/admin-shell';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session || session.platformRole !== 'PLATFORM_ADMIN') return null;
  return <AdminShell session={{ name: session.name, email: session.email }}>{children}</AdminShell>;
}
