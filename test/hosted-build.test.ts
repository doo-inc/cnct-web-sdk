import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { memoryTokenStore } from '../src/index.js';
import { startMockCnct, type MockCnct } from './support/server.js';

/**
 * The bundle CNCT serves at `/sdk/v1/cnct-chat.js`.
 *
 * Tested as a built artefact rather than as source, because everything that can go wrong with it goes
 * wrong in the build: a minifier that rewrites `import.meta.url`, an import that survives into a file
 * that is supposed to have none, an export renamed out from under every page that already loaded it.
 * This file runs on other people's websites and we cannot deploy to it.
 */
const bundlePath = fileURLToPath(new URL('../dist/hosted/cnct-chat.js', import.meta.url));

let cnct: MockCnct;
let hosted: typeof import('../src/hosted.js');

beforeAll(async () => {
  if (!existsSync(bundlePath)) {
    execFileSync('npm', ['run', 'build:hosted'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      stdio: 'ignore',
    });
  }
  hosted = (await import(pathToFileURL(bundlePath).href)) as typeof import('../src/hosted.js');
  cnct = await startMockCnct();
  /**
   * This build is for browsers, and a browser has always had a `WebSocket` — which is why it takes
   * no factory the way the package does. Node only grew one in 22, so it borrows `ws` to stand in
   * for the runtime this file actually ships to.
   */
  vi.stubGlobal('WebSocket', WebSocket);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await cnct.close();
});

describe('the file CNCT serves', () => {
  it('is one module with nothing to fetch after it', () => {
    const source = readFileSync(bundlePath, 'utf8');
    expect(source).not.toMatch(/^\s*import\s.*\sfrom\s/m);
    expect(source.startsWith('/*! cnct-chat')).toBe(true);
    expect(source).toContain('https://github.com/doo-inc/cnct-web-sdk');
  });

  it('still exports what every page that already loaded it imports by name', () => {
    expect(typeof hosted.createChatClient).toBe('function');
    expect(typeof hosted.default).toBe('function');
    expect(typeof hosted.ChatError).toBe('function');
    expect(typeof hosted.CnctChatClient).toBe('function');
  });

  it('keeps its own origin lookup through the minifier', () => {
    // If this is gone, `baseUrl` silently becomes '' and every install breaks at once.
    expect(readFileSync(bundlePath, 'utf8')).toContain('import.meta.url');
  });

  it('derives the host from where it was served rather than hardcoding one', () => {
    // Imported from a file:// URL there is no http origin to find, which is exactly what proves the
    // default is read at runtime. Served from a CNCT host, the same line resolves to that host.
    expect(() => hosted.createChatClient({ publicKey: 'k' })).toThrow(/absolute http/);
  });

  it('holds a whole conversation against a real server', async () => {
    const chat = hosted.createChatClient({
      publicKey: 'inbox-public-key',
      baseUrl: cnct.baseUrl,
      storage: memoryTokenStore(),
    });

    const inbox = await chat.boot();
    expect(inbox.business).toBe('Qimam Elevators');

    await chat.start({ displayName: 'Layla' });
    const sent = await chat.send('Do you open on Fridays?');
    expect(sent.body).toBe('Do you open on Fridays?');
    expect(chat.state.messages).toHaveLength(1);

    await chat.end();
    expect(chat.state.status).toBe('ended');
    chat.disconnect();
  });

  it('throws the error class it exports, so an old catch still narrows', async () => {
    const chat = hosted.createChatClient({
      publicKey: 'inbox-public-key',
      baseUrl: cnct.baseUrl,
      storage: memoryTokenStore(),
    });
    await expect(chat.send('nothing')).rejects.toBeInstanceOf(hosted.ChatError);
    chat.disconnect();
  });
});
