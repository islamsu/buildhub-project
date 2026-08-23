import { describe, expect, it, afterEach } from 'vitest';
import { buildCommit } from './_core/health';

/**
 * The deployment must be able to say which commit it is.
 *
 * This exists because a green 22-point staging gate was run against a Render
 * service that redeploys on every push, with nothing recording or exposing the
 * commit that answered it. The result was true but unreproducible: "it passed"
 * could not be attached to a build.
 *
 * The rule these tests protect is narrow and deliberate: report a real commit,
 * or report "unknown". Never guess, never echo something that is not a SHA.
 */

const ORIGINAL = { render: process.env.RENDER_GIT_COMMIT, build: process.env.BUILD_COMMIT };
afterEach(() => {
  process.env.RENDER_GIT_COMMIT = ORIGINAL.render;
  process.env.BUILD_COMMIT = ORIGINAL.build;
  if (ORIGINAL.render === undefined) delete process.env.RENDER_GIT_COMMIT;
  if (ORIGINAL.build === undefined) delete process.env.BUILD_COMMIT;
});

const set = (render?: string, build?: string) => {
  delete process.env.RENDER_GIT_COMMIT;
  delete process.env.BUILD_COMMIT;
  if (render !== undefined) process.env.RENDER_GIT_COMMIT = render;
  if (build !== undefined) process.env.BUILD_COMMIT = build;
};

describe('buildCommit', () => {
  it('reports the commit Render injects', () => {
    set('93a7314bd1ab591c8c98f77ba5af1d845a10431a');
    expect(buildCommit()).toBe('93a7314bd1ab591c8c98f77ba5af1d845a10431a');
  });

  it('accepts a short SHA', () => {
    set('93a7314');
    expect(buildCommit()).toBe('93a7314');
  });

  it('falls back to BUILD_COMMIT off Render', () => {
    // Vultr production is not Render, and neither is a local `docker run`.
    set(undefined, '24e3db1');
    expect(buildCommit()).toBe('24e3db1');
  });

  it('prefers RENDER_GIT_COMMIT when both are set', () => {
    set('aaaaaaa', 'bbbbbbb');
    expect(buildCommit()).toBe('aaaaaaa');
  });

  it('says "unknown" rather than inventing an identity', () => {
    set(undefined, undefined);
    expect(buildCommit()).toBe('unknown');
  });

  it('says "unknown" for an empty or whitespace value', () => {
    set('');
    expect(buildCommit()).toBe('unknown');
    set('   ');
    expect(buildCommit()).toBe('unknown');
  });

  it('refuses to echo a value that is not a commit SHA', () => {
    // The endpoint is public. An env var holding something else is a
    // misconfiguration, and the fix is to stay silent - not to forward
    // whatever arbitrary string happens to be in the environment.
    for (const junk of [
      'main',
      'refs/heads/claude/phase4b',
      'mysql://buildhub:pw@host:3306/db',
      '<script>alert(1)</script>',
      '../../etc/passwd',
      'zzzzzzz',
      'a'.repeat(41),
      '93a7314 && rm -rf /',
    ]) {
      set(junk);
      expect(buildCommit(), `should not echo: ${junk}`).toBe('unknown');
    }
  });

  it('trims surrounding whitespace from an otherwise valid SHA', () => {
    set('  93a7314  ');
    expect(buildCommit()).toBe('93a7314');
  });
});
