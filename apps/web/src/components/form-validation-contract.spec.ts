import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'src');
const contextualExceptions = new Map([
  ['components/catalogue-table.tsx', 'Unconstrained catalogue search has no independently invalid input.'],
  ['components/orders-table.tsx', 'Unconstrained order search has no independently invalid input.'],
]);

function productionForms(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionForms(path);
    if (!entry.name.endsWith('.tsx') || entry.name.endsWith('.spec.tsx')) return [];
    return readFileSync(path, 'utf8').includes('<form') ? [path] : [];
  });
}

describe('form validation contract', () => {
  it('requires every production form to provide field errors or a documented contextual exception', () => {
    const forms = productionForms(root);
    const missing: string[] = [];
    const foundExceptions = new Set<string>();
    for (const path of forms) {
      const name = relative(root, path).replaceAll('\\', '/');
      const source = readFileSync(path, 'utf8');
      if (source.includes('data-validation-context="non-field"')) {
        if (!contextualExceptions.has(name)) missing.push(`${name}: undocumented exception`);
        foundExceptions.add(name);
      } else if (!/\b(FormField|FieldError|clearFieldError|nativeConstraintMessage)\b/.test(source)) {
        missing.push(`${name}: missing field-validation lifecycle`);
      }
    }
    expect(missing).toEqual([]);
    expect([...foundExceptions].sort()).toEqual([...contextualExceptions.keys()].sort());
  });
});
