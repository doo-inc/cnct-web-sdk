import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A page rendered on a server imports `cnct-web-sdk/ui` at the top of a file, where there is no
 * `window` and no `document`. So the module must touch none of the browser's globals when it is
 * imported — and `defineCnctChat()`, called there by shared code, must do nothing rather than throw.
 *
 * Every browser global is replaced with a getter that writes down who asked, and then the module is
 * imported fresh.
 */
const BROWSER = [
  'window',
  'document',
  'HTMLElement',
  'customElements',
  'localStorage',
  'sessionStorage',
  'matchMedia',
  'getComputedStyle',
  'CSS',
  'IntersectionObserver',
  'XMLHttpRequest',
  'requestAnimationFrame',
];

const touched: string[] = [];

function trap() {
  for (const name of BROWSER) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        touched.push(name);
        return undefined;
      },
    });
  }
}

afterEach(() => {
  for (const name of BROWSER) delete (globalThis as Record<string, unknown>)[name];
  touched.length = 0;
  vi.resetModules();
});

describe('on a server', () => {
  it('imports the UI without touching a browser global', async () => {
    trap();
    const ui = await import('../src/ui/index.js');
    expect(touched).toEqual([]);
    expect(typeof ui.defineCnctChat).toBe('function');
    expect(typeof ui.mountChat).toBe('function');
  });

  it('imports the fixture without touching one either', async () => {
    trap();
    await import('../src/ui/fixture.js');
    expect(touched).toEqual([]);
  });

  it('lets defineCnctChat() run, and do nothing', async () => {
    const ui = await import('../src/ui/index.js');
    expect(() => ui.defineCnctChat()).not.toThrow();
  });

  it('keeps the headless package free of any of it', async () => {
    trap();
    await import('../src/index.js');
    expect(touched).toEqual([]);
  });
});
