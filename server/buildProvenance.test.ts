import { describe, expect, it, afterEach } from 'vitest';
import { buildCommit, buildEnvironment, resolveBuildCommit } from './_core/health';

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

  /*
   * A THIRD SOURCE EXISTS NOW, and these three tests were written when there
   * were two. `scripts/build-info.mjs` writes a build stamp beside the bundle,
   * because `.git` is excluded from the Docker build context and an image had
   * no way to know its own identity - which is what let a deployment lag look
   * exactly like a missing feature.
   *
   * So "no environment variable" no longer means "unknown": it means the build
   * stamp answers. That is the feature, not a regression, and asserting the
   * old result would require deleting it.
   *
   * The INTENT of all three is preserved at full strength below, and the
   * no-source case is now tested for real rather than by proxy: it goes
   * through `resolveBuildCommit`, which takes its three sources as arguments,
   * because that branch is unreachable through `buildCommit()` in a built tree.
   */
  it('says "unknown" when NO source can answer', () => {
    expect(resolveBuildCommit(undefined, undefined, null)).toBe('unknown');
  });

  it('says "unknown" for an empty or whitespace value with no other source', () => {
    expect(resolveBuildCommit('', undefined, null)).toBe('unknown');
    expect(resolveBuildCommit('   ', undefined, null)).toBe('unknown');
    expect(resolveBuildCommit(undefined, '', null)).toBe('unknown');
  });

  it('falls back to the build stamp when the environment says nothing', () => {
    expect(resolveBuildCommit(undefined, undefined, '93a7314')).toBe('93a7314');
    expect(resolveBuildCommit('', '  ', '93a7314')).toBe('93a7314');
  });

  it('refuses to echo a value that is not a commit SHA', () => {
    // The endpoint is public. An env var holding something else is a
    // misconfiguration, and the fix is to stay silent - not to forward
    // whatever arbitrary string happens to be in the environment.
    //
    // STRONGER THAN "should be unknown": the junk must not appear in the
    // answer AT ALL, and the answer must still be a well-formed identity.
    // With a build stamp present the honest result is that stamp - a
    // misconfigured variable should not throw away an answer that is sitting
    // right there and is correct.
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
      // Through the real function, with whatever stamp this tree has.
      set(junk);
      const live = buildCommit();
      expect(live, `should not echo: ${junk}`).not.toBe(junk);
      expect(live, `should stay well-formed: ${junk}`).toMatch(/^([0-9a-f]{7,40}|unknown)$/i);
      expect(live, `should not contain: ${junk}`).not.toContain(junk);
      // And with no other source at all, junk still yields "unknown".
      expect(resolveBuildCommit(junk, undefined, null), `no source: ${junk}`).toBe('unknown');
    }
  });

  it('trims surrounding whitespace from an otherwise valid SHA', () => {
    set('  93a7314  ');
    expect(buildCommit()).toBe('93a7314');
  });
});

/**
 * WHICH ENVIRONMENT, as the process was TOLD - never guessed.
 *
 * An unset NODE_ENV reads as "unknown" rather than being assumed to be
 * development. Assuming is how a production process ends up wearing a safe
 * label, and every safety decision downstream reads that label.
 */
describe('buildEnvironment', () => {
  const ORIGINAL_NODE = process.env.NODE_ENV;
  const ORIGINAL_APP = process.env.APP_ENV;
  const restore = (key: 'NODE_ENV' | 'APP_ENV', value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  afterEach(() => {
    restore('NODE_ENV', ORIGINAL_NODE);
    restore('APP_ENV', ORIGINAL_APP);
  });
  const set = (node?: string, app?: string) => {
    delete process.env.NODE_ENV;
    delete process.env.APP_ENV;
    if (node !== undefined) process.env.NODE_ENV = node;
    if (app !== undefined) process.env.APP_ENV = app;
  };

  /**
   * THE ONE THAT MATTERS. Every deployed environment sets NODE_ENV to
   * "production" - staging included, because React and Vite need it - so
   * reporting NODE_ENV as the environment made STAGING ANNOUNCE ITSELF AS
   * PRODUCTION. The owner opens the site to check which build they are
   * looking at; telling them the wrong deployment is worse than telling them
   * nothing.
   */
  it('does NOT call staging "production" just because NODE_ENV says so', () => {
    set('production', 'staging');
    expect(buildEnvironment()).toBe('staging');
  });

  it('APP_ENV wins wherever both are set', () => {
    set('production', 'preview');
    expect(buildEnvironment()).toBe('preview');
    set('development', 'staging');
    expect(buildEnvironment()).toBe('staging');
  });

  it('falls back to NODE_ENV so local development needs nothing configured', () => {
    set('development', undefined);
    expect(buildEnvironment()).toBe('development');
    set('production', undefined);
    expect(buildEnvironment()).toBe('production');
    // An empty APP_ENV is not an answer either.
    set('development', '   ');
    expect(buildEnvironment()).toBe('development');
  });

  it('says "unknown" rather than assuming development', () => {
    set(undefined, undefined);
    expect(buildEnvironment()).toBe('unknown');
    set('   ', undefined);
    expect(buildEnvironment()).toBe('unknown');
  });
});

/**
 * THE DEPLOYED CONFIGURATION HAS TO AGREE WITH THE CODE.
 *
 * A correct `buildEnvironment()` proves nothing if the environment that runs
 * it never sets APP_ENV. render.yaml is the staging deployment, so the claim
 * "staging will not call itself production" is only true if that file says so.
 */
describe('the staging blueprint names itself', () => {
  it('render.yaml sets APP_ENV, not just NODE_ENV', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const blueprint = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
    expect(blueprint).toMatch(/key:\s*APP_ENV/);
    expect(blueprint).toMatch(/key:\s*APP_ENV[\s\S]{0,80}value:\s*staging/);
    // And NODE_ENV is still production, because it is a BUILD mode.
    expect(blueprint).toMatch(/key:\s*NODE_ENV[\s\S]{0,80}value:\s*production/);
  });
});
