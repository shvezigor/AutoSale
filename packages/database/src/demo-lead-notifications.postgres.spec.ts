import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('demo notification state migration', () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new pg.Pool({ connectionString: container.getConnectionUri() });
    const root = fileURLToPath(new URL('../prisma/migrations', import.meta.url));
    for (const entry of (await readdir(root, { withFileTypes: true }))
      .filter((item) => item.isDirectory()).map((item) => item.name).sort()) {
      if (entry === '20261015_demo_lead_notification_retries') continue;
      await pool.query(await readFile(resolve(root, entry, 'migration.sql'), 'utf8'));
    }
    const cases = [
      ['11111111-1111-4111-8111-111111111111', 'PENDING', 0],
      ['22222222-2222-4222-8222-222222222222', 'FAILED', 1],
      ['33333333-3333-4333-8333-333333333333', 'SENT', 1],
      ['44444444-4444-4444-8444-444444444444', 'FAILED', 4],
    ] as const;
    for (const [id, status, attempts] of cases) {
      await pool.query(`INSERT INTO demo_leads
        (id, idempotency_key, name, company, email, order_volume, locale,
         notification_status, notification_attempts, updated_at)
        VALUES ($1, $2, 'Fictional Lead', 'Example Store', 'lead@example.test', 'LESS_THAN_50',
          'en', $3::"DemoLeadNotificationStatus", $4, NOW())`,
      [id, `fictional-${id}`, status, attempts]);
    }
    const migration = resolve(root, '20261015_demo_lead_notification_retries', 'migration.sql');
    await pool.query(await readFile(migration, 'utf8'));
  }, 90_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('makes unsent retryable leads due without resending sent or exhausted leads', async () => {
    const result = await pool.query<{
      notification_status: string;
      notification_attempts: number;
      notification_next_attempt_at: Date | null;
    }>(`SELECT notification_status, notification_attempts, notification_next_attempt_at
      FROM demo_leads ORDER BY id`);
    expect(result.rows.map((row) => [row.notification_status, row.notification_attempts,
      row.notification_next_attempt_at instanceof Date])).toEqual([
      ['PENDING', 0, true], ['FAILED', 1, true], ['SENT', 1, false], ['FAILED', 4, false],
    ]);
  });
});
