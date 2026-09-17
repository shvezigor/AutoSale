import type { ApiEnv } from '@autosale/config/api-env';
import nodemailer from 'nodemailer';

export type DemoLeadNotification = {
  id: string;
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  orderVolume: string;
  note: string | null;
  locale: string;
};

export interface DemoLeadNotifier { send(lead: DemoLeadNotification): Promise<void> }

export class NoopDemoLeadNotifier implements DemoLeadNotifier { async send(): Promise<void> {} }
export class UnavailableDemoLeadNotifier implements DemoLeadNotifier { async send(): Promise<void> { throw new Error('Demo lead notification is not configured'); } }

export function createDemoLeadNotifier(env: ApiEnv): DemoLeadNotifier {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM || !env.DEMO_LEAD_EMAIL) return env.NODE_ENV === 'production' ? new UnavailableDemoLeadNotifier() : new NoopDemoLeadNotifier();
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465, pool: true, auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }, disableFileAccess: true, disableUrlAccess: true });
  return { async send(lead) { await transport.sendMail({ from: env.SMTP_FROM!, to: env.DEMO_LEAD_EMAIL!, subject: `Sales AITO demo request ${lead.id}`, text: [`Name: ${lead.name}`, `Company: ${lead.company}`, `Email: ${lead.email ?? '-'}`, `Phone: ${lead.phone ?? '-'}`, `Orders: ${lead.orderVolume}`, `Locale: ${lead.locale}`, `Note: ${lead.note ?? '-'}`].join('\n') }); } };
}
