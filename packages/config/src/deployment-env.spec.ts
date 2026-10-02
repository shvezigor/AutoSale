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
});
