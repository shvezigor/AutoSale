import type { DemoLeadNotificationClaim, DemoLeadNotificationStore } from '@autosale/database';

import { classifyDemoLeadEmailError } from './demo-lead-email.js';

interface DemoLeadQueue {
  add(name: 'demo-lead.notify', data: { leadId: string }, options: {
    jobId: string; delay: number; attempts: 1; removeOnComplete: number; removeOnFail: number;
  }): Promise<unknown>;
}

export class DemoLeadNotificationProcessor {
  constructor(
    private readonly store: Pick<DemoLeadNotificationStore, 'claim' | 'markSent' | 'markFailed'>,
    private readonly sender: { configured?: boolean; send(lead: DemoLeadNotificationClaim): Promise<void> },
    private readonly queue: DemoLeadQueue,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(job: { leadId: string }): Promise<'SENT' | 'RETRY_SCHEDULED' | 'TERMINAL' | 'SKIPPED' | 'DEFERRED'> {
    if (this.sender.configured === false) return 'DEFERRED';
    const claim = await this.store.claim(job.leadId);
    if (!claim) return 'SKIPPED';
    try {
      await this.sender.send(claim);
    } catch (error) {
      const failure = classifyDemoLeadEmailError(error);
      const dueAt = await this.store.markFailed(claim.id, claim.leaseId, failure.code, failure.terminal);
      if (!dueAt) return 'TERMINAL';
      try {
        await this.queue.add('demo-lead.notify', { leadId: claim.id }, {
          jobId: `demo-lead-${claim.id}-attempt-${claim.attempt + 1}`,
          delay: Math.max(0, dueAt.getTime() - this.now().getTime()),
          attempts: 1, removeOnComplete: 100, removeOnFail: 250,
        });
      } catch {
        // PostgreSQL is authoritative; periodic reconciliation restores this wake-up.
      }
      return 'RETRY_SCHEDULED';
    }
    return await this.store.markSent(claim.id, claim.leaseId) ? 'SENT' : 'SKIPPED';
  }
}
