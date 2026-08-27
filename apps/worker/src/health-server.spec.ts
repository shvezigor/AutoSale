import { once } from 'node:events';

import { afterEach, describe, expect, it } from 'vitest';

import { createWorkerHealthServer } from './health-server.js';

describe('createWorkerHealthServer', () => {
  const servers: ReturnType<typeof createWorkerHealthServer>[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
  });

  it('reports a live worker over HTTP', async () => {
    const server = createWorkerHealthServer();
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP address');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/health/live`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('exposes Prometheus-compatible worker metrics', async () => {
    const server = createWorkerHealthServer();
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toContain('autosale_worker_info');
  });
});
