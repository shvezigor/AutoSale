import { createServer, type Server } from 'node:http';
import { metrics } from '@autosale/observability';

metrics.increment('autosale_worker_info');

export function createWorkerHealthServer(): Server {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health/live') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (request.method === 'GET' && request.url === '/metrics') {
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
      response.end(metrics.render());
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }));
  });
}
