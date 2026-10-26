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
  it('keeps home marketing actions on shared variants with a scoped marketing skin', () => {
    const home = readFileSync(resolve(__dirname, '../marketing/components/home-page.tsx'), 'utf8');
    const css = readFileSync(resolve(__dirname, '../../app/styles/marketing/home.css'), 'utf8');
    expect(home).toContain('primary-button marketing-button');
    expect(home).toContain('secondary-button marketing-button marketing-button--secondary');
    expect(home).not.toContain('className="marketing-button"');
    expect(css).toContain('.marketing-home .marketing-button.primary-button');
    expect(css).toContain('.marketing-home .marketing-button.secondary-button');
    expect(css).toContain('.marketing-home .marketing-final-cta a:focus-visible');
    const art = readFileSync(resolve(__dirname, '../marketing/components/hero-artwork.tsx'), 'utf8');
    expect(art).toContain('className="icon-button hero-art__control"');
    expect(css).toContain('.marketing-home .hero-art__control.icon-button');
  });
  it('styles the shared icon variant instead of leaving triage actions to browser defaults', () => {
    const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');
    const iconBase = css.match(/(?:^|\n)\.icon-button\s*\{([^}]+)\}/)?.[1];
    expect(iconBase).toMatch(/display:\s*inline-grid/);
    expect(iconBase).toMatch(/border:\s*1px solid var\(--border\)/);
    expect(iconBase).toMatch(/border-radius:\s*10px/);
    expect(iconBase).toMatch(/background:\s*#fff/);
    expect(css).toMatch(/\.icon-button:focus-visible\s*\{[^}]*outline:/);
    expect(css).toMatch(/\.icon-button:disabled\s*\{[^}]*cursor:\s*not-allowed/);
    expect(css).toMatch(/\.conversation-status-control \.icon-button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.conversation-status-menu \.text-button\s*\{[^}]*display:\s*flex/);
  });
  it('keeps triage menu mutations and triggers on shared variants', () => {
    const source = readFileSync(resolve(__dirname, 'conversation-status-menu.tsx'), 'utf8');
    expect(source).toContain('className="icon-button"');
    expect(source).toMatch(/<LoadingButton[^>]*className="text-button"/);
  });
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

  it('uses shared variants for platform integration mutations', () => {
    const source = readFileSync(resolve(__dirname, 'admin-integrations.tsx'), 'utf8');
    expect(source).toContain("'danger-button'");
    expect(source).toContain("'primary-button'");
    expect(source).toContain('<LoadingButton');
  });
});
