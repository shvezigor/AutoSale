import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('deployment environment contract', () => {
  it.each(['false', 'true'])('passes explicit usage collection=%s only to the worker', (enabled) => {
    const rendered = JSON.parse(execFileSync('docker', [
      'compose', '--env-file', '.env.example', '-f', 'compose.yaml', 'config', '--format', 'json',
    ], { cwd: resolve(process.cwd(), '../..'), encoding: 'utf8', env: {
      ...process.env,
      AI_USAGE_COLLECTION_ENABLED: enabled,
      AI_USAGE_RETENTION_ENABLED: enabled,
      POSTGRES_API_PASSWORD: 'fictional-api-password',
      POSTGRES_WORKER_PASSWORD: 'fictional-worker-password',
      POSTGRES_BACKUP_PASSWORD: 'fictional-backup-password',
    } })) as { services: { worker: { environment: Record<string, string> }; api: { environment: Record<string, string> } } };
    expect(rendered.services.worker.environment.AI_USAGE_COLLECTION_ENABLED).toBe(enabled);
    expect(rendered.services.api.environment.AI_USAGE_COLLECTION_ENABLED).toBeUndefined();
    expect(rendered.services.worker.environment.AI_USAGE_RETENTION_ENABLED).toBe(enabled);
    expect(rendered.services.api.environment.AI_USAGE_RETENTION_ENABLED).toBeUndefined();
  });

  it('renders the public API in production while keeping the isolated acceptance API in development', () => {
    const root = resolve(process.cwd(), '../..');
    const env = {
      ...process.env,
      NODE_ENV: 'development',
      APP_PUBLIC_URL: 'http://127.0.0.1:18080',
      POSTGRES_API_PASSWORD: 'fictional-api-password',
      POSTGRES_WORKER_PASSWORD: 'fictional-worker-password',
      POSTGRES_BACKUP_PASSWORD: 'fictional-backup-password',
    };
    const render = (files: string[]) => JSON.parse(execFileSync('docker', [
      'compose', '--env-file', '.env.example', ...files.flatMap((file) => ['-f', file]),
      'config', '--format', 'json',
    ], { cwd: root, env, encoding: 'utf8' })) as { services: { api: { environment: { NODE_ENV: string } } } };

    expect(render(['compose.yaml']).services.api.environment.NODE_ENV).toBe('production');
    expect(render(['compose.yaml', 'infra/compose.lifecycle-acceptance.yaml']).services.api.environment.NODE_ENV)
      .toBe('development');
  });

  it('passes the Facebook Messenger feature flag to both API and worker', () => {
    const compose = readFileSync(resolve(process.cwd(), '../../compose.yaml'), 'utf8');
    const declarations = compose.match(
      /FACEBOOK_MESSENGER_ENABLED: \$\{FACEBOOK_MESSENGER_ENABLED:-false\}/g,
    );

    expect(declarations).toHaveLength(2);
  });

  it('passes dedicated Facebook OAuth credentials only to the API', () => {
    const compose = readFileSync(resolve(process.cwd(), '../../compose.yaml'), 'utf8');

    expect(compose.match(/FACEBOOK_APP_ID: \$\{FACEBOOK_APP_ID:-\}/g)).toHaveLength(1);
    expect(compose.match(/FACEBOOK_APP_SECRET: \$\{FACEBOOK_APP_SECRET:-\}/g)).toHaveLength(1);
  });

  it('passes the TikTok feature flag and credentials to API and worker', () => {
    const compose = readFileSync(resolve(process.cwd(), '../../compose.yaml'), 'utf8');

    expect(compose.match(/TIKTOK_BUSINESS_MESSAGING_ENABLED: \$\{TIKTOK_BUSINESS_MESSAGING_ENABLED:-false\}/g)).toHaveLength(2);
    expect(compose.match(/TIKTOK_CLIENT_ID: \$\{TIKTOK_CLIENT_ID:-\}/g)).toHaveLength(2);
    expect(compose.match(/TIKTOK_CLIENT_SECRET: \$\{TIKTOK_CLIENT_SECRET:-\}/g)).toHaveLength(2);
    expect(compose.match(/TIKTOK_AUTHORIZATION_URL: \$\{TIKTOK_AUTHORIZATION_URL:-\}/g)).toHaveLength(1);
  });
});
