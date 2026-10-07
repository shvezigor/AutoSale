import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('conversation viewport contract', () => {
  it('keeps the workspace fixed to the viewport and scrolls only the internal lists', () => {
    const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

    expect(css).toMatch(/html:has\(\.app-shell-content\),\s*body:has\(\.app-shell-content\)\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.workspace-route-transition > \.app-shell-content\s*\{[^}]*height:\s*calc\(100dvh - 72px\)[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.thread-scroll\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.conversation-list\s*\{[^}]*overflow-y:\s*auto/s);
  });

  it('contains visually hidden message labels inside each scrollable message bubble', () => {
    const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

    expect(css).toMatch(/\.message-bubble\s*\{[^}]*position:\s*relative/s);
  });

  it('fits the mobile conversation panel below the current workspace header', () => {
    const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

    expect(css).toContain('.conversation-panel { position: fixed; inset: 72px 0 0; z-index: 2; height: auto;');
  });

  it('lets the reply editor grow vertically without forcing document scrolling', () => {
    const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

    expect(css).toMatch(/\.social-reply-composer textarea\s*\{[^}]*min-height:\s*72px[^}]*max-height:\s*min\(50dvh,\s*420px\)[^}]*resize:\s*vertical/s);
    expect(css).toMatch(/\.reply-area\s*\{[^}]*max-height:\s*min\(60dvh,\s*520px\)[^}]*overflow-y:\s*auto/s);
  });
});
