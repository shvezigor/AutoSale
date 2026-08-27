import { describe, expect, it } from 'vitest';

import { EventEmitter } from 'node:events';
import { MetricRegistry, StructuredLogger, createHttpTelemetry } from './index.js';

describe('StructuredLogger', () => {
  it('emits queryable JSON while redacting secrets and personal data', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger('api', (line) => lines.push(line));
    logger.info('webhook_received', { correlationId: 'corr-1', orderId: 'order-1', phone: '+380501112233', accessToken: 'secret-token' });
    const record = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({ level: 'info', service: 'api', event: 'webhook_received', correlationId: 'corr-1', orderId: 'order-1', phone: '[REDACTED]', accessToken: '[REDACTED]' });
    expect(lines[0]).not.toContain('+380501112233');
    expect(lines[0]).not.toContain('secret-token');
  });
});

describe('createHttpTelemetry', () => {
  it('propagates an accepted request id and records bounded HTTP telemetry', () => {
    const lines: string[] = [];
    const localMetrics = new MetricRegistry();
    const middleware = createHttpTelemetry(new StructuredLogger('api', (line) => lines.push(line)), localMetrics);
    const request = { method: 'GET', url: '/api/orders/123', headers: { 'x-request-id': 'corr-client-1' } };
    const response = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: (name: string, value: string) => { expect(name).toBe('x-request-id'); expect(value).toBe('corr-client-1'); } });
    let called = false;
    middleware(request, response, () => { called = true; });
    response.emit('finish');
    expect(called).toBe(true);
    expect(JSON.parse(lines[0]!) as object).toMatchObject({ event: 'http_request_completed', correlationId: 'corr-client-1', route: '/api/orders/:id' });
    expect(localMetrics.render()).toContain('autosale_http_requests_total{method="GET",route="/api/orders/:id",status_class="2xx"} 1');
  });
});

describe('MetricRegistry', () => {
  it('renders bounded counters and duration histograms in Prometheus format', () => {
    const metrics = new MetricRegistry();
    metrics.increment('autosale_operations_total', { operation: 'sheets_export', result: 'success' });
    metrics.observe('autosale_operation_duration_seconds', 0.2, { operation: 'sheets_export' });
    const output = metrics.render();
    expect(output).toContain('autosale_operations_total{operation="sheets_export",result="success"} 1');
    expect(output).toContain('autosale_operation_duration_seconds_bucket{operation="sheets_export",le="0.25"} 1');
    expect(output).toContain('autosale_operation_duration_seconds_count{operation="sheets_export"} 1');
  });

  it('rejects unbounded labels before they create high-cardinality series', () => {
    const metrics = new MetricRegistry();
    expect(() => metrics.increment('autosale_operations_total', { orderId: 'order-1' })).toThrow('Unsupported metric label');
  });

  it('replaces gauges so queue backlog reports current saturation', () => {
    const metrics = new MetricRegistry();
    metrics.set('autosale_queue_backlog', 7, { queue: 'google_sheets' });
    metrics.set('autosale_queue_backlog', 3, { queue: 'google_sheets' });
    expect(metrics.render()).toContain('autosale_queue_backlog{queue="google_sheets"} 3');
  });
});
