'use client';

import { useParams } from 'next/navigation';
import { postJson } from '../../../../src/auth/auth-api';
import { InviteAcceptForm } from '../../../../src/components/auth-form';

export default function InvitePage() { const params = useParams<{ token: string }>(); return <InviteAcceptForm token={params.token} submit={(input) => postJson('/api/team/invitations/accept', input)} />; }
