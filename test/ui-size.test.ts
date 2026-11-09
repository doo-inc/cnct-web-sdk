import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * What the interface costs a page, held to a budget so it only grows on purpose. Bundled, minified
 * and gzipped the way an app ships it — see `scripts/size.mjs`.
 */
describe('the size of cnct-web-sdk/ui', () => {
  const sizes = JSON.parse(
    execFileSync(process.execPath, ['scripts/size.mjs', '--json'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
    }),
  ) as Record<'ui' | 'uiWithClient', { minified: number; gzipped: number }>;

  it('stays under 26 kB gzipped on its own', () => {
    expect(sizes.ui.gzipped).toBeLessThan(26 * 1024);
  });

  it('stays under 35 kB gzipped with the headless client it brings', () => {
    expect(sizes.uiWithClient.gzipped).toBeLessThan(35 * 1024);
  });
});
