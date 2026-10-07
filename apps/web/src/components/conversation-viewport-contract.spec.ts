import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('conversation viewport contract', () => {
  it('keeps the workspace fixed to the viewport and scrolls only the internal lists', () => {
    const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

    expect(css).toMatch(/\.workspace-route-transition > \.app-shell-content\s*\{[^}]*height:\s*calc\(100dvh - 72px\)[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.thread-scroll\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.conversation-list\s*\{[^}]*overflow-y:\s*auto/s);
  });

  it('contains visually hidden message labels inside each scrollable message bubble', () => {
    const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

    expect(css).toMatch(/\.message-bubble\s*\{[^}]*position:\s*relative/s);
  });
});
