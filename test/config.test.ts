import { describe, expect, it } from 'vitest';
import { Cnct, CnctConfig, CnctError, CnctHosts } from '../src/index.js';

describe('the host', () => {
  /**
   * It was required until there was a production host to default to — a default then would have
   * shipped apps to a dev box by accident. Now leaving it out means production.
   */
  it('is production when left out', () => {
    expect(new CnctConfig().baseUrl).toBe('https://app.doo.ooo');
    expect(new CnctConfig({}).baseUrl).toBe(CnctHosts.production);
    expect(new Cnct().config.socketBaseUrl).toBe('wss://app.doo.ooo');
  });

  /** An empty string is not "left out": it is an environment variable somebody meant to set. */
  it('refuses an empty one rather than quietly going to production', () => {
    expect(() => new CnctConfig({ baseUrl: '' })).toThrow(CnctError);
    expect(() => new CnctConfig({ baseUrl: '' })).toThrow(/baseUrl is empty/);
  });

  it('refuses anything that is not an absolute http(s) URL', () => {
    expect(() => new CnctConfig({ baseUrl: 'cnct.example.com' })).toThrow(/absolute http/);
    expect(() => new CnctConfig({ baseUrl: 'ftp://cnct.example.com' })).toThrow(/absolute http/);
  });

  it('strips a trailing slash so one written with and one written without behave alike', () => {
    const withSlash = new CnctConfig({ baseUrl: 'https://cnct.example.com/' });
    const without = new CnctConfig({ baseUrl: 'https://cnct.example.com' });
    expect(withSlash.baseUrl).toBe(without.baseUrl);
    expect(withSlash.resolve('/api/tags')).toBe('https://cnct.example.com/api/tags');
  });

  it('honours a path prefix, so fronting CNCT on your own domain needs no fork', () => {
    const config = new CnctConfig({ baseUrl: 'https://theirdomain.com/support' });
    expect(config.resolve('/api/contacts')).toBe('https://theirdomain.com/support/api/contacts');
    expect(config.resolveSocket('/ws/chat')).toBe('wss://theirdomain.com/support/ws/chat');
  });

  it('derives the socket origin rather than taking a second URL to keep in step', () => {
    expect(new CnctConfig({ baseUrl: 'https://a.example.com' }).socketBaseUrl).toBe(
      'wss://a.example.com',
    );
    expect(new CnctConfig({ baseUrl: 'http://localhost:3000' }).socketBaseUrl).toBe(
      'ws://localhost:3000',
    );
  });

  it('drops a query string and a fragment rather than carrying them onto every path', () => {
    const config = new CnctConfig({ baseUrl: 'https://cnct.example.com/support?a=1#x' });
    expect(config.baseUrl).toBe('https://cnct.example.com/support');
  });

  /** The old name still compiles, and goes where the old deployment's traffic went: production. */
  it('keeps the deprecated development name working', () => {
    expect(CnctHosts.development).toBe(CnctHosts.production);
    expect(() => new CnctConfig({ baseUrl: CnctHosts.development })).not.toThrow();
  });
});

describe('swapping hosts at runtime', () => {
  it('carries everything but the host across', () => {
    const staging = new CnctConfig({
      baseUrl: 'https://staging.example.com',
      headers: { 'x-trace': 'abc' },
      sendTimeoutMs: 1234,
    });
    const live = staging.copyWith({ baseUrl: 'https://api.example.com' });
    expect(live.baseUrl).toBe('https://api.example.com');
    expect(live.headers).toEqual({ 'x-trace': 'abc' });
    expect(live.sendTimeoutMs).toBe(1234);
  });

  it('leaves clients already built pointed where they were built', () => {
    const cnct = Cnct.host('https://a.example.com');
    const chat = cnct.chat('public-key');
    const moved = cnct.withBaseUrl('https://b.example.com');
    expect(chat.config.baseUrl).toBe('https://a.example.com');
    expect(moved.chat('public-key').config.baseUrl).toBe('https://b.example.com');
  });
});

describe('query building', () => {
  it('repeats a key for an array and drops what was never set', () => {
    const config = new CnctConfig({ baseUrl: 'https://cnct.example.com' });
    const url = config.resolve('/api/contacts', {
      attr: ['plan:gold', 'tier:2'],
      q: undefined,
      take: 100,
      cursor: null,
    });
    expect(url).toBe(
      'https://cnct.example.com/api/contacts?attr=plan%3Agold&attr=tier%3A2&take=100',
    );
  });
});
