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
});
