'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { authRequest } from '../../../src/auth/auth-api';
import { ResetPasswordForm } from '../../../src/components/auth-form';

function ResetPasswordContent() { const token = useSearchParams().get('token') ?? ''; return <ResetPasswordForm token={token} submit={(input) => authRequest('reset-password', input)} />; }
export default function ResetPasswordPage() { return <Suspense fallback={<main className="route-state">Завантаження…</main>}><ResetPasswordContent /></Suspense>; }
