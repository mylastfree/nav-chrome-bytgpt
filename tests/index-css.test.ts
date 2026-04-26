import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

describe('group sidebar action visibility', () => {
  test('hides quick actions until hover or keyboard focus', () => {
    expect(css).toMatch(
      /\.quick-actions\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;[^}]*transition:\s*opacity\s+0\.15s\s+ease;[^}]*\}/s,
    );
    expect(css).toMatch(
      /\.group-tab:hover\s+\.quick-actions,\s*\.group-tab:focus-within\s+\.quick-actions\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;[^}]*\}/s,
    );
  });
});
