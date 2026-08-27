export interface EmailDelivery {
  sendVerification(email: string, url: string): Promise<string | undefined>;
  sendPasswordReset(email: string, url: string): Promise<string | undefined>;
  sendInvitation(email: string, url: string): Promise<string | undefined>;
}

export class DevelopmentEmailDelivery implements EmailDelivery {
  readonly previews: Array<{ kind: 'verification' | 'password-reset' | 'invitation'; email: string; url: string }> = [];

  async sendVerification(email: string, url: string): Promise<string> {
    this.previews.push({ kind: 'verification', email, url });
    return url;
  }

  async sendPasswordReset(email: string, url: string): Promise<string> {
    this.previews.push({ kind: 'password-reset', email, url });
    return url;
  }

  async sendInvitation(email: string, url: string): Promise<string> {
    this.previews.push({ kind: 'invitation', email, url });
    return url;
  }
}

export class UnavailableEmailDelivery implements EmailDelivery {
  private unavailable(): never {
    throw new Error('Email delivery is not configured');
  }
  async sendVerification(): Promise<string | undefined> { return this.unavailable(); }
  async sendPasswordReset(): Promise<string | undefined> { return this.unavailable(); }
  async sendInvitation(): Promise<string | undefined> { return this.unavailable(); }
}
