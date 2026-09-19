/**
 * Bundle the hosted build — the single file CNCT serves at `/sdk/v1/cnct-chat.js`.
 *
 * One file, no imports, no build step for whoever loads it: this runs on other people's websites from
 * a bare `<script type="module">`, and a module graph would mean a second round trip to a path their
 * CSP has never heard of. `import.meta.url` survives the bundle, which is what lets the hosted entry
 * default `baseUrl` to the origin it was served from.
 *
 * Minified, with the banner kept, because this is fetched by a stranger's browser on a page whose
 * performance budget is not ours to spend.
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

await mkdir(new URL('../dist/hosted/', import.meta.url), { recursive: true });

const result = await build({
  entryPoints: ['src/hosted.ts'],
  outfile: 'dist/hosted/cnct-chat.js',
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  platform: 'browser',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  banner: {
    js:
      `/*! cnct-chat ${pkg.version} — the CNCT chat client.\n` +
      ' * Source, types and docs: https://github.com/doo-inc/cnct-web-sdk\n' +
      ' * BSD-3-Clause © DOO Inc\n' +
      ' */',
  },
  metafile: true,
});

const [output] = Object.values(result.metafile.outputs);
console.log(`dist/hosted/cnct-chat.js — ${(output.bytes / 1024).toFixed(1)} kB minified`);

// The types ship beside it, for a page that vendors the file rather than installing the package.
await writeFile(
  new URL('../dist/hosted/cnct-chat.d.ts', import.meta.url),
  [
    '// Types for the hosted build. The package itself ships richer ones — this file exists so a page',
    '// that vendors `cnct-chat.js` next to its own code still gets completion.',
    "export * from '../chat/types.js';",
    "export { ChatError, CnctError, CnctErrorCode } from '../errors.js';",
    "export { CnctChatClient } from '../chat/chat-client.js';",
    "export { createChatClient, type HostedChatClientOptions } from '../hosted.js';",
    "export { createChatClient as default } from '../hosted.js';",
    '',
  ].join('\n'),
  'utf8',
);
