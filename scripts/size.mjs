/**
 * How much `cnct-web-sdk/ui` adds to a page: bundled and minified as an app's bundler would, then
 * gzipped as a server would send it. Two numbers, because the interface brings the headless client
 * with it and an app that already uses the client pays only for the first.
 *
 *   node scripts/size.mjs           prints both
 *   node scripts/size.mjs --json    the same, for a test or a script to read
 */
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';

async function measure(entry, { uiOnly = false } = {}) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    legalComments: 'none',
    plugins: uiOnly
      ? [
          {
            name: 'headless-is-elsewhere',
            setup(on) {
              // Everything outside src/ui is the headless package, already on the page.
              on.onResolve({ filter: /^\.\.\// }, (args) =>
                args.importer.includes('/src/ui/')
                  ? { path: args.path, external: true }
                  : undefined,
              );
            },
          },
        ]
      : [],
  });
  const code = result.outputFiles[0].contents;
  return { minified: code.length, gzipped: gzipSync(code, { level: 9 }).length };
}

const root = new URL('..', import.meta.url).pathname;
const sizes = {
  ui: await measure(`${root}src/ui/index.ts`, { uiOnly: true }),
  uiWithClient: await measure(`${root}src/ui/index.ts`),
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(sizes));
} else {
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
  console.log(
    `cnct-web-sdk/ui on its own:          ${kb(sizes.ui.minified)} minified, ${kb(sizes.ui.gzipped)} gzipped`,
  );
  console.log(
    `with the headless client it brings:  ${kb(sizes.uiWithClient.minified)} minified, ${kb(sizes.uiWithClient.gzipped)} gzipped`,
  );
}
