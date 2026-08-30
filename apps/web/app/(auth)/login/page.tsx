'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LoginForm } from '../../../src/components/auth-form';
import { login } from '../../../src/auth/auth-api';
import { safeNextPath } from '../../../src/auth/paths';

function LoginContent() {
  const params = useSearchParams();
  return <LoginForm submit={async (input) => { const result = await login(input); if (result.ok) window.location.assign(safeNextPath(params.get('next'))); return result; }} />;
}

export default function LoginPage() { return <Suspense fallback={<main className="route-state">Завантаження…</main>}><LoginContent /></Suspense>; }
