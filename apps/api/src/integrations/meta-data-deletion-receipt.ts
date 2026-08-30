import { createHmac } from 'node:crypto';

export type MetaDataDeletionReceiptValue = {
  url: string;
  confirmation_code: string;
};

export class MetaDataDeletionReceipt {
  private readonly statusUrl: URL;

  constructor(
    private readonly appSecret: string,
    appPublicUrl: string,
  ) {
    this.statusUrl = new URL('/privacy/data-deletion', appPublicUrl);
  }

  create(externalAccountId: string): MetaDataDeletionReceiptValue {
    const confirmationCode = createHmac('sha256', this.appSecret)
      .update(`instagram-data-deletion:${externalAccountId}`)
      .digest('hex')
      .slice(0, 32);
    const url = new URL(this.statusUrl);
    url.searchParams.set('code', confirmationCode);
    return { url: url.toString(), confirmation_code: confirmationCode };
  }
}
