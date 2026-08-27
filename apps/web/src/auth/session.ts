import type { PublicSession } from '../../../../packages/contracts/src/auth';
import { cookies } from 'next/headers';

export async function getServerSession(): Promise<PublicSession | null> {
  const cookieHeader = (await cookies()).toString();
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/api/auth/session`, { headers: { cookie: cookieHeader }, cache: 'no-store' });
    return response.ok ? await response.json() as PublicSession : null;
  } catch { return null; }
}

export async function authenticatedApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const cookieHeader = (await cookies()).toString();
  return fetch(`${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}${path}`, { ...init, headers: { ...init?.headers, cookie: cookieHeader }, cache: 'no-store' });
}
