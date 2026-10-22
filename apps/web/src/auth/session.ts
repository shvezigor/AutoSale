import type { PublicSession } from '../../../../packages/contracts/src/auth';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { cache } from 'react';

const SAFE_ROUTE_LABELS = new Set(['auth', 'orders', 'dashboard', 'catalogue', 'settings', 'conversations', 'notifications', 'team', 'profile', 'search']);

const readServerSession = cache(async (): Promise<PublicSession | null> => {
  const cookieHeader = (await cookies()).toString();
  try {
    const response = await internalApiFetch('/api/auth/session', cookieHeader);
    return response.ok ? await response.json() as PublicSession : null;
  } catch { return null; }
});

export function getServerSession(): Promise<PublicSession | null> {
  return readServerSession();
}

export async function authenticatedApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const cookieHeader = (await cookies()).toString();
  return internalApiFetch(path, cookieHeader, init);
}

async function internalApiFetch(path: string, cookieHeader: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const requestId = randomUUID();
  headers.set('cookie', cookieHeader);
  headers.set('x-request-id', requestId);
  const started = performance.now();
  const route = safeRouteLabel(path);

  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
    });
    const durationMs = Math.round(performance.now() - started);
    if (response.status >= 500 || durationMs >= 1_000) {
      console.warn(JSON.stringify({
        event: response.status >= 500 ? 'web_upstream_failed' : 'web_upstream_slow',
        route,
        statusClass: `${Math.floor(response.status / 100)}xx`,
        durationMs,
        requestId,
      }));
    }
    return response;
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    console.warn(JSON.stringify({ event: 'web_upstream_failed', route, statusClass: 'network', durationMs, requestId }));
    throw error;
  }
}

function safeRouteLabel(path: string): string {
  const segment = /^\/api\/([a-z-]+)(?:[/?#]|$)/.exec(path)?.[1];
  return segment && SAFE_ROUTE_LABELS.has(segment)
    ? segment
    : 'other';
}
