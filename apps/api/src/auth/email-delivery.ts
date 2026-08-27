export interface EmailDelivery {
  sendVerification(email: string, url: string): Promise<void>;
  sendPasswordReset(email: string, url: string): Promise<void>;
  sendInvitation(email: string, url: string): Promise<void>;
}

export class DevelopmentEmailDelivery implements EmailDelivery {
  readonly previews: Array<{ kind: 'verification' | 'password-reset' | 'invitation'; email: string; url: string }> = [];

  async sendVerification(email: string, url: string): Promise<void> {
    this.previews.push({ kind: 'verification', email, url });
  }

  async sendPasswordReset(email: string, url: string): Promise<void> {
    this.previews.push({ kind: 'password-reset', email, url });
  }

  async sendInvitation(email: string, url: string): Promise<void> {
    this.previews.push({ kind: 'invitation', email, url });
  }
}

export class UnavailableEmailDelivery implements EmailDelivery {
  private unavailable(): never {
    throw new Error('Email delivery is not configured');
  }
  async sendVerification(): Promise<void> { this.unavailable(); }
  async sendPasswordReset(): Promise<void> { this.unavailable(); }
  async sendInvitation(): Promise<void> { this.unavailable(); }
}
