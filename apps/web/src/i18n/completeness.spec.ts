import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { enMessages } from './messages/en';
import { ukMessages } from './messages/uk';
import { messageLeafPaths } from './translator';

const localizedUiFiles = [
  '../components/catalogue-import-wizard.tsx',
  '../components/catalogue-source-settings.tsx',
  '../components/instagram-settings-form.tsx',
  '../components/delivery-settings-card.tsx',
  '../components/meest-settings-card.tsx',
  '../components/ukrposhta-settings-card.tsx',
  '../components/loading-button.tsx',
  '../components/route-skeleton.tsx',
  '../../app/(workspace)/error.tsx',
];

describe('localization completeness', () => {
  it('keeps every English and Ukrainian message leaf aligned', () => {
    expect(messageLeafPaths(enMessages)).toEqual(messageLeafPaths(ukMessages));
  });

  it.each(localizedUiFiles)('keeps application copy out of %s', (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), 'src/i18n', relativePath), 'utf8');
    expect(source).not.toMatch(/[А-Яа-яІіЇїЄє]/);
  });
});
