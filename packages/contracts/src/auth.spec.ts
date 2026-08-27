import { describe, expect, it } from 'vitest';

import { loginRequestSchema, registerRequestSchema } from './auth.js';

describe('authentication contracts', () => {
  it('accepts a valid owner registration', () => {
    expect(registerRequestSchema.safeParse({
      email: 'owner@example.com',
      password: 'correct horse battery',
      name: 'Owner',
      tenantName: 'Store',
    }).success).toBe(true);
  });

  it('normalizes email and rejects short passwords', () => {
    expect(loginRequestSchema.parse({
      email: ' Owner@Example.COM ',
      password: 'correct horse battery',
    }).email).toBe('owner@example.com');
    expect(loginRequestSchema.safeParse({
      email: 'owner@example.com',
      password: 'too-short',
    }).success).toBe(false);
  });
});
