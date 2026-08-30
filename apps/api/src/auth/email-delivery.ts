import nodemailer from 'nodemailer';
import type { ApiEnv } from '@autosale/config/api-env';

export interface EmailDelivery {
  sendVerification(email: string, url: string): Promise<string | undefined>;
  sendPasswordReset(email: string, url: string): Promise<string | undefined>;
  sendInvitation(email: string, url: string): Promise<string | undefined>;
}

export class DevelopmentEmailDelivery implements EmailDelivery {
  readonly previews: Array<{ kind: 'verification' | 'password-reset' | 'invitation'; email: string; url: string }> = [];
  async sendVerification(email: string, url: string): Promise<string> { this.previews.push({ kind: 'verification', email, url }); return url; }
  async sendPasswordReset(email: string, url: string): Promise<string> { this.previews.push({ kind: 'password-reset', email, url }); return url; }
  async sendInvitation(email: string, url: string): Promise<string> { this.previews.push({ kind: 'invitation', email, url }); return url; }
}

interface MailTransport { sendMail(message: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> }

export class SmtpEmailDelivery implements EmailDelivery {
  constructor(private readonly transport: MailTransport, private readonly from: string) {}

  static create(config: { host: string; port: number; user: string; password: string; from: string }): SmtpEmailDelivery {
    return new SmtpEmailDelivery(nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.port === 465, pool: true,
      auth: { user: config.user, pass: config.password }, disableFileAccess: true, disableUrlAccess: true,
    }), config.from);
  }

  sendVerification(email: string, url: string) { return this.send(email, 'Підтвердіть email в AutoSale', 'Підтвердити email', url); }
  sendPasswordReset(email: string, url: string) { return this.send(email, 'Відновлення пароля AutoSale', 'Створити новий пароль', url); }
  sendInvitation(email: string, url: string) { return this.send(email, 'Запрошення до команди AutoSale', 'Приєднатися до команди', url); }

  private async send(to: string, subject: string, action: string, url: string): Promise<undefined> {
    await this.transport.sendMail({ from: this.from, to, subject, text: `${action}: ${url}`, html: `<p>${action}</p><p><a href="${escapeHtml(url)}">${action}</a></p>` });
    return undefined;
  }
}

export class UnavailableEmailDelivery implements EmailDelivery {
  private unavailable(): never { throw new Error('Email delivery is not configured'); }
  async sendVerification(): Promise<string | undefined> { return this.unavailable(); }
  async sendPasswordReset(): Promise<string | undefined> { return this.unavailable(); }
  async sendInvitation(): Promise<string | undefined> { return this.unavailable(); }
}

export function createEmailDelivery(env: ApiEnv): EmailDelivery {
  if (env.NODE_ENV !== 'production') return new DevelopmentEmailDelivery();
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD && env.SMTP_FROM) {
    return SmtpEmailDelivery.create({ host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, password: env.SMTP_PASSWORD, from: env.SMTP_FROM });
  }
  return new UnavailableEmailDelivery();
}

function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }
