import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SDK_VERSION } from '../src/index.js';

/**
 * The version is written in four places, and a release with two of them disagreeing is a release
 * that reports itself wrongly in somebody's logs. The release workflow already refuses a tag that
 * differs from `package.json`; this holds the rest to it.
 */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json')) as { version: string };

describe('the version', () => {
  it('is the same in package.json, the lockfile and the User-Agent', () => {
    const lock = JSON.parse(read('package-lock.json')) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages['']?.version).toBe(pkg.version);
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it('has the CHANGELOG’s newest entry', () => {
    const newest = read('CHANGELOG.md').match(/^## (\S+)/m)?.[1];
    expect(newest).toBe(pkg.version);
  });

  it('is what the README tells people to install', () => {
    const readme = read('README.md');
    expect(readme).toContain(`github:doo-inc/cnct-web-sdk#v${pkg.version}`);
    expect(readme).toContain(`/releases/download/v${pkg.version}/cnct-web-sdk-${pkg.version}.tgz`);
  });
});
