import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { resolve } from 'node:path';

import { createPrismaClient } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Queue } from 'bullmq';
import pg from 'pg';
import { GenericContainer, Network, TestContainers, Wait, type StartedNetwork, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Run only for the explicit full-process acceptance: build the worker image first,
// then set RUN_FULL_WORKER_ACCEPTANCE=1. The default suite needs no prebuilt image.
const fullProcess = process.env.RUN_FULL_WORKER_ACCEPTANCE === '1' ? describe : describe.skip;

fullProcess('demo lead notification full worker restart acceptance', () => {
  let network: StartedNetwork;
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let minio: StartedTestContainer;
  let worker: StartedTestContainer | undefined;
  let prisma: ReturnType<typeof createPrismaClient>;
  const sockets = new Set<Socket>();
  const acceptedMessages: string[] = [];
  const smtp = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    socket.write('220 localhost ESMTP\r\n');
    let buffer = '';
    let body = '';
    let readingBody = false;
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let end = buffer.indexOf('\r\n');
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (readingBody) {
          if (line === '.') {
            acceptedMessages.push(body);
            body = '';
            readingBody = false;
            socket.write('250 2.0.0 accepted\r\n');
          } else body += `${line}\r\n`;
        } else if (line.startsWith('EHLO')) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH PLAIN')) socket.write('235 2.7.0 authenticated\r\n');
        else if (line.startsWith('MAIL FROM')) socket.write('250 2.1.0 sender accepted\r\n');
        else if (line.startsWith('RCPT TO')) socket.write('250 2.1.5 recipient accepted\r\n');
        else if (line === 'DATA') { readingBody = true; socket.write('354 continue\r\n'); }
        else if (line === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('250 ok\r\n');
        end = buffer.indexOf('\r\n');
      }
    });
  });

  beforeAll(async () => {
    smtp.listen(0, '127.0.0.1');
    await once(smtp, 'listening');
    const address = smtp.address();
    if (!address || typeof address === 'string') throw new Error('SMTP_SINK_ADDRESS_MISSING');
    await TestContainers.exposeHostPorts(address.port);
    network = await new Network().start();
    postgres = await new PostgreSqlContainer('postgres:17.6-alpine')
      .withNetwork(network).withNetworkAliases('postgres').start();
    const pool = new pg.Pool({ connectionString: postgres.getConnectionUri() });
    try {
      const migrations = resolve(process.cwd(), '../../packages/database/prisma/migrations');
      for (const entry of (await readdir(migrations, { withFileTypes: true }))
        .filter((item) => item.isDirectory()).map((item) => item.name).sort()) {
        await pool.query(await readFile(resolve(migrations, entry, 'migration.sql'), 'utf8'));
      }
    } finally {
      await pool.end();
    }
    prisma = createPrismaClient(postgres.getConnectionUri());
    redis = await new GenericContainer('redis:8.2.1-alpine')
      .withNetwork(network).withNetworkAliases('redis').withExposedPorts(6379).start();
    minio = await new GenericContainer('minio/minio:RELEASE.2025-07-23T15-54-02Z')
      .withNetwork(network).withNetworkAliases('minio')
      .withEnvironment({ MINIO_ROOT_USER: 'fictionalminio', MINIO_ROOT_PASSWORD: 'fictionalminiosecret' })
      .withCommand(['server', '/data']).withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000)).start();
  }, 180_000);

  afterAll(async () => {
    await worker?.stop();
    await prisma?.$disconnect();
    await minio?.stop();
    await redis?.stop();
    await postgres?.stop();
    await network?.stop();
    for (const socket of sockets) socket.destroy();
    smtp.close();
    await once(smtp, 'close');
  }, 90_000);

  it('reconciles a lead created while the entire configured worker process is stopped and never resends SENT replay', async () => {
    const address = smtp.address();
    if (!address || typeof address === 'string') throw new Error('SMTP_SINK_ADDRESS_MISSING');
    const startWorker = async () => new GenericContainer('autosale-worker:latest')
      .withNetwork(network)
      .withEnvironment({
        NODE_ENV: 'test', HEALTH_PORT: '3002',
        DATABASE_URL: `postgresql://${postgres.getUsername()}:${postgres.getPassword()}@postgres:5432/${postgres.getDatabase()}`,
        REDIS_URL: 'redis://redis:6379', APP_PUBLIC_URL: 'https://example.test',
        S3_ENDPOINT: 'http://minio:9000', S3_REGION: 'us-east-1', S3_BUCKET: 'fictional-acceptance',
        S3_ACCESS_KEY_ID: 'fictionalminio', S3_SECRET_ACCESS_KEY: 'fictionalminiosecret',
        OPENAI_API_KEY: `sk-${'fictional'.repeat(4)}`, META_APP_ID: '1234567890',
        META_APP_SECRET: 'fictional-meta-secret', META_GRAPH_API_VERSION: 'v23.0',
        INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        SMTP_HOST: 'host.testcontainers.internal', SMTP_PORT: String(address.port),
        SMTP_USER: 'fictional-user', SMTP_PASSWORD: 'fictional-password',
        SMTP_FROM: 'noreply@example.test', DEMO_LEAD_EMAIL: 'internal@example.test',
      })
      .withExposedPorts(3002)
      .withWaitStrategy(Wait.forHttp('/health/live', 3002))
      .withStartupTimeout(120_000).start();

    worker = await startWorker();
    await worker.stop();
    worker = undefined;
    const lead = await prisma.demoLead.create({ data: {
      idempotencyKey: randomUUID(), name: 'Fictional Daria', company: 'Example Shop',
      email: 'lead@example.test', orderVolume: 'LESS_THAN_50', locale: 'en',
      notificationNextAttemptAt: new Date(Date.now() - 1_000),
    } });
    expect(acceptedMessages).toHaveLength(0);

    worker = await startWorker();
    await vi.waitFor(async () => {
      expect((await prisma.demoLead.findUniqueOrThrow({ where: { id: lead.id } })).notificationStatus).toBe('SENT');
    }, { timeout: 30_000, interval: 300 });
    expect(acceptedMessages).toHaveLength(1);
    expect(acceptedMessages[0]).toContain(`Message-ID: <demo-${lead.id}@sales-aito.com>`);
    expect(await prisma.demoLead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({
      notificationAttempts: 1, notificationNextAttemptAt: null,
    });

    await worker.stop();
    worker = await startWorker();
    const replayQueue = new Queue<{ leadId: string }>('demo-leads', {
      connection: { host: redis.getHost(), port: redis.getMappedPort(6379) },
    });
    try {
      const replay = await replayQueue.add('demo-lead.notify', { leadId: lead.id }, {
        jobId: `acceptance-replay-${lead.id}`, attempts: 1, removeOnComplete: 100, removeOnFail: 250,
      });
      await vi.waitFor(async () => expect(await replay.getState()).toBe('completed'), {
        timeout: 15_000, interval: 300,
      });
    } finally {
      await replayQueue.close();
    }
    expect(acceptedMessages).toHaveLength(1);
    expect((await prisma.demoLead.findUniqueOrThrow({ where: { id: lead.id } })).notificationAttempts).toBe(1);
  }, 180_000);
});
