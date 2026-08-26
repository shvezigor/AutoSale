import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('reports a live process', () => {
    expect(new HealthController().live()).toEqual({ status: 'ok' });
  });
});
