import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function collectProductionTsx(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collectProductionTsx(path));
    } else if (path.endsWith('.tsx') && !path.endsWith('.spec.tsx')) {
      files.push(path);
    }
  }
  return files;
}

describe('button style contract', () => {
  it('does not allow legacy or browser-default action variants in production components', () => {
    const roots = [resolve(__dirname, '../../app'), resolve(__dirname, '.')];
    const legacyVariant = /className\s*=\s*["'](?:button-primary|button-secondary|secondary)["']/;
    const violations = roots
      .flatMap((root) => collectProductionTsx(root))
      .filter((file) => legacyVariant.test(readFileSync(file, 'utf8')));

    expect(violations).toEqual([]);
  });

  it('keeps LoadingButton on the shared primary variant by default', () => {
    const source = readFileSync(resolve(__dirname, 'loading-button.tsx'), 'utf8');
    expect(source).toContain("className = ''");
    expect(source).toContain("|| 'primary-button'");
  });
});
