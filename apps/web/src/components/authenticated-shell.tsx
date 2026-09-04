'use client';

import type { PublicSession } from '../../../../packages/contracts/src/auth';
import type { ReactNode } from 'react';

import { ActivityProvider } from './activity-provider';
import { AppHeader } from './app-header';
import { PrimaryNavigation } from './primary-navigation';
import { ToastProvider } from './toast-provider';

type Destination = 'conversations' | 'orders' | 'catalogue' | 'team' | 'settings';
type ShellSession = Pick<PublicSession, 'name' | 'email' | 'membershipRole'>;

export function AuthenticatedShell({ active, session, children }: { active: Destination; session: ShellSession; children: ReactNode }) {
  return <ToastProvider><ActivityProvider><div className="authenticated-shell">
    <PrimaryNavigation active={active} session={session} />
    <div className="authenticated-workspace"><AppHeader session={session} />{children}</div>
  </div></ActivityProvider></ToastProvider>;
}
