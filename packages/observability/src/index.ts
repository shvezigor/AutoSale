const redactedKeys = /token|secret|password|authorization|cookie|phone|email|address|payload|body/i;
const allowedMetricLabels = new Set(['operation', 'result', 'method', 'route', 'status_class', 'provider', 'queue', 'state']);
const buckets = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

export class StructuredLogger {
  constructor(private readonly service: string, private readonly write: (line: string) => void = (line) => process.stdout.write(`${line}\n`)) {}

  info(event: string, fields: Record<string, unknown> = {}): void { this.log('info', event, fields); }
  warn(event: string, fields: Record<string, unknown> = {}): void { this.log('warn', event, fields); }
  error(event: string, fields: Record<string, unknown> = {}): void { this.log('error', event, fields); }

  private log(level: string, event: string, fields: Record<string, unknown>): void {
    this.write(JSON.stringify({ timestamp: new Date().toISOString(), level, service: this.service, event, ...(redact(fields) as Record<string, unknown>) }));
  }
}

type Labels = Record<string, string>;
type Histogram = { labels: Labels; values: number[] };

export class MetricRegistry {
  private readonly counters = new Map<string, { labels: Labels; value: number }>();
  private readonly histograms = new Map<string, Histogram>();
  private readonly gauges = new Map<string, { labels: Labels; value: number }>();

  increment(name: string, labels: Labels = {}, amount = 1): void {
    validate(name, labels);
    const key = seriesKey(name, labels);
    const current = this.counters.get(key) ?? { labels, value: 0 };
    current.value += amount;
    this.counters.set(key, current);
  }

  observe(name: string, seconds: number, labels: Labels = {}): void {
    validate(name, labels);
    const key = seriesKey(name, labels);
    const current = this.histograms.get(key) ?? { labels, values: [] };
    current.values.push(seconds);
    this.histograms.set(key, current);
  }

  set(name: string, value: number, labels: Labels = {}): void {
    validate(name, labels);
    this.gauges.set(seriesKey(name, labels), { labels, value });
  }

  render(): string {
    const lines: string[] = [];
    for (const [key, counter] of this.counters) lines.push(`${key} ${counter.value}`);
    for (const [key, gauge] of this.gauges) lines.push(`${key} ${gauge.value}`);
    for (const [key, histogram] of this.histograms) {
      const [name] = key.split('{');
      for (const bucket of buckets) lines.push(`${name}_bucket${formatLabels({ ...histogram.labels, le: String(bucket) })} ${histogram.values.filter((value) => value <= bucket).length}`);
      lines.push(`${name}_bucket${formatLabels({ ...histogram.labels, le: '+Inf' })} ${histogram.values.length}`);
      lines.push(`${name}_sum${formatLabels(histogram.labels)} ${histogram.values.reduce((sum, value) => sum + value, 0)}`);
      lines.push(`${name}_count${formatLabels(histogram.labels)} ${histogram.values.length}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

export const metrics = new MetricRegistry();

type HttpRequest = { method?: string; url?: string; headers: Record<string, string | string[] | undefined> };
type HttpResponse = { statusCode: number; setHeader(name: string, value: string): void; once(event: 'finish', listener: () => void): unknown };

export function createHttpTelemetry(logger: StructuredLogger, registry: MetricRegistry) {
  return (request: HttpRequest, response: HttpResponse, next: () => void): void => {
    const supplied = request.headers['x-request-id'];
    const candidate = Array.isArray(supplied) ? supplied[0] : supplied;
    const correlationId = candidate && /^[a-zA-Z0-9._:-]{1,128}$/.test(candidate) ? candidate : randomUUID();
    response.setHeader('x-request-id', correlationId);
    const started = performance.now();
    response.once('finish', () => {
      const method = request.method ?? 'UNKNOWN';
      const route = routeTemplate(request.url ?? '/');
      const statusClass = `${Math.floor(response.statusCode / 100)}xx`;
      const duration = (performance.now() - started) / 1000;
      registry.increment('autosale_http_requests_total', { method, route, status_class: statusClass });
      registry.observe('autosale_http_request_duration_seconds', duration, { method, route });
      logger.info('http_request_completed', { correlationId, method, route, statusClass, durationSeconds: duration });
    });
    next();
  };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactedKeys.test(key) ? '[REDACTED]' : redact(item)]));
}

function validate(name: string, labels: Labels): void {
  if (!/^[a-zA-Z_:][a-zA-Z0-9_:]*$/.test(name)) throw new Error('Invalid metric name');
  for (const label of Object.keys(labels)) if (!allowedMetricLabels.has(label)) throw new Error(`Unsupported metric label: ${label}`);
}

function seriesKey(name: string, labels: Labels): string { return `${name}${formatLabels(labels)}`; }
function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels);
  return entries.length ? `{${entries.map(([key, value]) => `${key}="${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}` : '';
}

function routeTemplate(url: string): string {
  return url.split('?')[0]!.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/:id').replace(/\/\d+(?=\/|$)/g, '/:id');
}
import { randomUUID } from 'node:crypto';
