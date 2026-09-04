import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationRoot = resolve(process.cwd(), '../../packages/database/prisma/migrations');

describe('Google Sign-In migration', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    const migrationNames = (await readdir(migrationRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const migrationName of migrationNames) {
      await pool.query(await readFile(resolve(migrationRoot, migrationName, 'migration.sql'), 'utf8'));
    }
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('supports passwordless users and uniquely owned Google identities and attempts', async () => {
    const firstUser = '11111111-1111-4111-8111-111111111111';
    const secondUser = '22222222-2222-4222-8222-222222222222';
    await pool.query(`
      INSERT INTO users (id, email, name, password_hash, status, email_verified_at, updated_at)
      VALUES
        ($1, 'first@example.com', 'First', NULL, 'ACTIVE', now(), now()),
        ($2, 'second@example.com', 'Second', NULL, 'ACTIVE', now(), now())
    `, [firstUser, secondUser]);
    await pool.query(`
      INSERT INTO google_identities (id, user_id, google_subject, email_at_link)
      VALUES ('33333333-3333-4333-8333-333333333333', $1, 'google-subject', 'first@example.com')
    `, [firstUser]);
    await pool.query(`
      INSERT INTO google_sign_in_attempts (id, state_token_hash, state_expires_at)
      VALUES ('44444444-4444-4444-8444-444444444444', 'state-hash', now() + interval '10 minutes')
    `);

    await expect(pool.query(`
      INSERT INTO google_identities (id, user_id, google_subject, email_at_link)
      VALUES ('55555555-5555-4555-8555-555555555555', $1, 'google-subject', 'second@example.com')
    `, [secondUser])).rejects.toMatchObject({ code: '23505' });
    await expect(pool.query(`
      INSERT INTO google_identities (id, user_id, google_subject, email_at_link)
      VALUES ('66666666-6666-4666-8666-666666666666', $1, 'another-subject', 'first@example.com')
    `, [firstUser])).rejects.toMatchObject({ code: '23505' });
    await expect(pool.query(`
      INSERT INTO google_sign_in_attempts (id, state_token_hash, state_expires_at)
      VALUES ('77777777-7777-4777-8777-777777777777', 'state-hash', now() + interval '10 minutes')
    `)).rejects.toMatchObject({ code: '23505' });

    const stored = await pool.query('SELECT password_hash FROM users WHERE id = $1', [firstUser]);
    expect(stored.rows[0]).toEqual({ password_hash: null });
  });
});
