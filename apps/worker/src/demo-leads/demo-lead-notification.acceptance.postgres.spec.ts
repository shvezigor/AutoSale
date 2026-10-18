import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { resolve } from 'node:path';

import { createPrismaClient, DemoLeadNotificationStore } from '@autosale/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Queue, Worker } from 'bullmq';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDemoLeadEmailSender } from './demo-lead-email.js';
import { DemoLeadNotificationProcessor } from './demo-lead-notification.processor.js';
import { DemoLeadNotificationReconciler } from './demo-lead-notification.reconciler.js';

describe('demo lead notification acceptance', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: ReturnType<typeof createPrismaClient>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17.6-alpine').start();
    const connectionString = container.getConnectionUri();
    const pool = new pg.Pool({ connectionString });
    try {
      const root = resolve(process.cwd(), '../../packages/database/prisma/migrations');
      for (const entry of (await readdir(root, { withFileTypes: true }))
        .filter((item) => item.isDirectory()).map((item) => item.name).sort()) {
        await pool.query(await readFile(resolve(root, entry, 'migration.sql'), 'utf8'));
      }
    } finally {
      await pool.end();
    }
    prisma = createPrismaClient(connectionString);
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('recovers transient SMTP and lost queue wake-ups while keeping rejection and replay terminal', async () => {
    let clock = new Date('2026-10-18T12:00:00.000Z');
    let response: 'temporary' | 'permanent' | 'accept' = 'temporary';
    let queueUnavailable = false;
    const acceptedMessages: string[] = [];
    const queuedLeadIds: string[] = [];
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
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
          else if (line.startsWith('RCPT TO')) {
            socket.write(response === 'temporary' ? '450 4.2.0 retry later\r\n'
              : response === 'permanent' ? '550 5.1.1 rejected\r\n' : '250 2.1.5 recipient accepted\r\n');
          } else if (line === 'DATA') { readingBody = true; socket.write('354 continue\r\n'); }
          else if (line === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
          else socket.write('250 ok\r\n');
          end = buffer.indexOf('\r\n');
        }
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('SMTP_SINK_ADDRESS_MISSING');
    const sender = createDemoLeadEmailSender({
      SMTP_HOST: '127.0.0.1', SMTP_PORT: address.port,
      SMTP_USER: 'fictional-user', SMTP_PASSWORD: 'fictional-password',
      SMTP_FROM: 'noreply@example.test', DEMO_LEAD_EMAIL: 'internal@example.test',
    });
    const store = new DemoLeadNotificationStore(prisma, () => clock);
    const queue = {
      async add(_name: 'demo-lead.notify', data: { leadId: string }, _options: {
        jobId: string; delay?: number; attempts: 1; removeOnComplete: number; removeOnFail: number;
      }) {
        if (queueUnavailable) throw new Error('fictional Redis outage');
        queuedLeadIds.push(data.leadId);
      },
    };
    const processor = new DemoLeadNotificationProcessor(store, sender, queue, () => clock);
    const createDueLead = async () => prisma.demoLead.create({ data: {
      idempotencyKey: randomUUID(), name: 'Fictional Olena', company: 'Example Store',
      email: 'lead@example.test', orderVolume: 'LESS_THAN_50', locale: 'en',
      notificationNextAttemptAt: new Date(clock.getTime() - 1_000),
    } });

    try {
      const recovered = await createDueLead();
      expect(await processor.process({ leadId: recovered.id })).toBe('RETRY_SCHEDULED');
      expect(await prisma.demoLead.findUniqueOrThrow({ where: { id: recovered.id } })).toMatchObject({
        notificationStatus: 'FAILED', notificationAttempts: 1,
        notificationNextAttemptAt: new Date(clock.getTime() + 60_000),
      });
      expect(acceptedMessages).toHaveLength(0);

      clock = new Date(clock.getTime() + 60_000);
      response = 'accept';
      expect(await processor.process({ leadId: recovered.id })).toBe('SENT');
      expect(await processor.process({ leadId: recovered.id })).toBe('SKIPPED');
      expect(acceptedMessages).toHaveLength(1);
      expect(acceptedMessages[0]).toContain(`Message-ID: <demo-${recovered.id}@sales-aito.com>`);
      expect(await prisma.demoLead.findUniqueOrThrow({ where: { id: recovered.id } })).toMatchObject({
        notificationStatus: 'SENT', notificationAttempts: 2, notificationNextAttemptAt: null,
      });

      response = 'permanent';
      const rejected = await createDueLead();
      expect(await processor.process({ leadId: rejected.id })).toBe('TERMINAL');
      expect(await prisma.demoLead.findUniqueOrThrow({ where: { id: rejected.id } })).toMatchObject({
        notificationStatus: 'FAILED', notificationAttempts: 1, notificationNextAttemptAt: null,
        lastNotificationError: 'RECIPIENT_REJECTED',
      });
      expect(acceptedMessages).toHaveLength(1);

      response = 'accept';
      const stranded = await createDueLead();
      queuedLeadIds.length = 0;
      queueUnavailable = true;
      expect(await new DemoLeadNotificationReconciler(store, queue, () => clock).reconcile()).toEqual({
        attempted: 1, enqueued: 0, failed: 1,
      });
      expect(await prisma.demoLead.findUniqueOrThrow({ where: { id: stranded.id } })).toMatchObject({
        notificationStatus: 'PENDING', notificationAttempts: 0,
      });
      queueUnavailable = false;
      expect(await new DemoLeadNotificationReconciler(store, queue, () => clock).reconcile()).toEqual({
        attempted: 1, enqueued: 1, failed: 0,
      });
      expect(queuedLeadIds).toEqual([stranded.id]);
      expect(await processor.process({ leadId: queuedLeadIds[0]! })).toBe('SENT');
      expect(await processor.process({ leadId: stranded.id })).toBe('SKIPPED');
      expect(acceptedMessages).toHaveLength(2);
    } finally {
      sender.close();
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, 'close');
    }
  }, 30_000);

  it('recovers a due lead after Redis and BullMQ worker restart without resending a completed lead', async () => {
    let redis: StartedTestContainer | undefined;
    let queue: Queue<{ leadId: string }> | undefined;
    let worker: Worker<{ leadId: string }> | undefined;
    const deliveredLeadIds: string[] = [];
    const queueName = `demo-lead-acceptance-${randomUUID()}`;
    const store = new DemoLeadNotificationStore(prisma);
    const sender = { configured: true, async send(lead: { id: string }) {
      deliveredLeadIds.push(lead.id);
    } };
    const createDueLead = async () => prisma.demoLead.create({ data: {
      idempotencyKey: randomUUID(), name: 'Fictional Daria', company: 'Example Shop',
      email: 'lead@example.test', orderVolume: 'LESS_THAN_50', locale: 'en',
      notificationNextAttemptAt: new Date(Date.now() - 1_000),
    } });

    try {
      redis = await new GenericContainer('redis:8.2.1-alpine').withExposedPorts(6379).start();
      const startWorker = async () => {
        const connection = { host: redis!.getHost(), port: redis!.getMappedPort(6379) };
        queue = new Queue<{ leadId: string }>(queueName, { connection });
        await queue.waitUntilReady();
        const processor = new DemoLeadNotificationProcessor(store, sender, queue);
        worker = new Worker<{ leadId: string }>(queueName, (job) => processor.process(job.data), {
          connection, concurrency: 1,
        });
        await worker.waitUntilReady();
      };
      await startWorker();

      const completed = await createDueLead();
      expect(await new DemoLeadNotificationReconciler(store, queue!).reconcile()).toMatchObject({
        attempted: 1, enqueued: 1,
      });
      await vi.waitFor(async () => {
        expect((await prisma.demoLead.findUniqueOrThrow({ where: { id: completed.id } })).notificationStatus).toBe('SENT');
      }, { timeout: 15_000 });
      expect(deliveredLeadIds).toEqual([completed.id]);

      await worker!.close();
      await queue!.close();
      worker = undefined;
      queue = undefined;
      const stranded = await createDueLead();
      await redis.restart();
      await startWorker();
      expect(await new DemoLeadNotificationReconciler(store, queue!).reconcile()).toMatchObject({
        attempted: 1, enqueued: 1,
      });
      await vi.waitFor(async () => {
        expect((await prisma.demoLead.findUniqueOrThrow({ where: { id: stranded.id } })).notificationStatus).toBe('SENT');
      }, { timeout: 15_000 });

      const replay = await queue!.add('demo-lead.notify', { leadId: completed.id }, {
        jobId: `replay-${completed.id}`, attempts: 1, removeOnComplete: 100, removeOnFail: 250,
      });
      await vi.waitFor(async () => expect(await replay.getState()).toBe('completed'), { timeout: 15_000 });
      expect(deliveredLeadIds).toEqual([completed.id, stranded.id]);
      expect(await prisma.demoLead.findUniqueOrThrow({ where: { id: completed.id } })).toMatchObject({
        notificationStatus: 'SENT', notificationAttempts: 1,
      });
    } finally {
      await worker?.close();
      await queue?.close();
      await redis?.stop();
    }
  }, 120_000);
});
