import type { DemoLeadNotificationClaim, DemoLeadFailureCode } from '@autosale/database';
import nodemailer from 'nodemailer';

type SmtpSettings = {
  SMTP_HOST?: string | undefined;
  SMTP_PORT: number;
  SMTP_USER?: string | undefined;
  SMTP_PASSWORD?: string | undefined;
  SMTP_FROM?: string | undefined;
  DEMO_LEAD_EMAIL?: string | undefined;
};

type Mail = { from: string; to: string; subject: string; text: string; messageId: string };
type Transport = { sendMail(mail: Mail): Promise<{ accepted?: unknown[] }> };
type TransportOptions = {
  host: string; port: number; secure: boolean; pool: boolean;
  auth: { user: string; pass: string };
  disableFileAccess: true; disableUrlAccess: true;
  connectionTimeout: number; greetingTimeout: number; socketTimeout: number;
};

export class DemoLeadEmailError extends Error {
  constructor(readonly code: DemoLeadFailureCode, readonly terminal: boolean) {
    super(code);
    this.name = 'DemoLeadEmailError';
  }
}

export function classifyDemoLeadEmailError(error: unknown): { code: DemoLeadFailureCode; terminal: boolean } {
  if (error instanceof DemoLeadEmailError) return { code: error.code, terminal: error.terminal };
  const responseCode = error && typeof error === 'object' && 'responseCode' in error ? error.responseCode : undefined;
  if (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600) {
    return { code: 'RECIPIENT_REJECTED', terminal: true };
  }
  return { code: 'DELIVERY_FAILED', terminal: false };
}

export function createDemoLeadEmailSender(
  env: SmtpSettings,
  transportFactory: (options: TransportOptions) => Transport = (options) => nodemailer.createTransport(options),
): { send(lead: DemoLeadNotificationClaim): Promise<void> } {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM || !env.DEMO_LEAD_EMAIL) {
    return { async send() { throw new DemoLeadEmailError('NOT_CONFIGURED', true); } };
  }
  const transport = transportFactory({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    pool: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
  return { async send(lead) {
    const result = await transport.sendMail({
      from: env.SMTP_FROM!,
      to: env.DEMO_LEAD_EMAIL!,
      messageId: `<demo-${lead.id}@sales-aito.com>`,
      subject: `Sales AITO demo request ${lead.id}`,
      text: [
        `Name: ${lead.name}`, `Company: ${lead.company}`, `Email: ${lead.email ?? '-'}`,
        `Phone: ${lead.phone ?? '-'}`, `Orders: ${lead.orderVolume}`,
        `Locale: ${lead.locale}`, `Note: ${lead.note ?? '-'}`,
      ].join('\n'),
    });
    if (Array.isArray(result.accepted) && result.accepted.length === 0) {
      throw new DemoLeadEmailError('RECIPIENT_REJECTED', true);
    }
  } };
}
