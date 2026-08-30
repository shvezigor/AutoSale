export async function mutatingFetch(path: string, init: RequestInit): Promise<Response> {
  const csrfResponse = await fetch('/api/auth/csrf', { method: 'POST' });
  if (!csrfResponse.ok) return csrfResponse;
  const { token } = await csrfResponse.json() as { token: string };
  const headers = new Headers(init.headers);
  headers.set('x-csrf-token', token);
  return fetch(path, { ...init, headers: Object.fromEntries(headers.entries()) });
}
