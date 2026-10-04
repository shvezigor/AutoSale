import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('deployment environment contract', () => {
  it('passes the Facebook Messenger feature flag to both API and worker', () => {
    const compose = readFileSync(resolve(process.cwd(), '../../compose.yaml'), 'utf8');
    const declarations = compose.match(
      /FACEBOOK_MESSENGER_ENABLED: \$\{FACEBOOK_MESSENGER_ENABLED:-false\}/g,
    );

    expect(declarations).toHaveLength(2);
  });

  it('passes dedicated Facebook OAuth credentials only to the API', () => {
    const compose = readFileSync(resolve(process.cwd(), '../../compose.yaml'), 'utf8');

    expect(compose.match(/FACEBOOK_APP_ID: \$\{FACEBOOK_APP_ID:-\}/g)).toHaveLength(1);
    expect(compose.match(/FACEBOOK_APP_SECRET: \$\{FACEBOOK_APP_SECRET:-\}/g)).toHaveLength(1);
  });

  it('passes the TikTok feature flag and credentials to API and worker', () => {
    const compose = readFileSync(resolve(process.cwd(), '../../compose.yaml'), 'utf8');

    expect(compose.match(/TIKTOK_BUSINESS_MESSAGING_ENABLED: \$\{TIKTOK_BUSINESS_MESSAGING_ENABLED:-false\}/g)).toHaveLength(2);
    expect(compose.match(/TIKTOK_CLIENT_ID: \$\{TIKTOK_CLIENT_ID:-\}/g)).toHaveLength(2);
    expect(compose.match(/TIKTOK_CLIENT_SECRET: \$\{TIKTOK_CLIENT_SECRET:-\}/g)).toHaveLength(2);
  });
});
