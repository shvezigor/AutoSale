'use client';

export async function authRequest(path: string, body: unknown): Promise<{ ok: boolean; previewUrl?: string }> {
  return postJson(`/api/auth/${path}`, body);
}

export async function postJson(path: string, body: unknown): Promise<{ ok: boolean; previewUrl?: string }> {
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({})) as { previewUrl?: string };
    return { ok: response.ok, ...(payload.previewUrl ? { previewUrl: payload.previewUrl } : {}) };
  } catch { return { ok: false }; }
}

export const login = (input: { email: string; password: string }) => authRequest('login', input);
export const register = (input: { name: string; tenantName: string; email: string; password: string }) => authRequest('register', input);
