import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The staging launch-readiness gate.
 *
 * The 22-point verification runs against a REAL deployed URL from a GitHub
 * runner, because the engineering sandbox is on an egress allowlist that
 * returns 403 for every Render host - it can build and test the artefact but
 * can never probe the deployment. A runner has ordinary internet access, which
 * makes the workflow the mechanism that actually verifies staging.
 *
 * These tests pin the harness's own safety properties, because a verification
 * tool that lies is worse than no verification tool.
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const GATE = read('../scripts/staging-qa.mjs');
const WORKFLOW = read('../.github/workflows/staging-qa.yml');

describe('§1 it cannot be pointed at production', () => {
  it('REFUSES a URL that does not look like staging', () => {
    // It registers accounts. That is intended - registration and the six roles
    // are part of what must be verified - and is exactly why the guard exists.
    expect(GATE).toContain('Refusing to run');
    expect(GATE).toMatch(/staging\|onrender\|localhost/);
  });

  it('the workflow refuses too, so the guard is not only in the script', () => {
    expect(WORKFLOW).toContain('does not look like staging');
    expect(WORKFLOW).toContain('exit 1');
  });
});

describe('§2 it does not overstate what it proved', () => {
  it('skips are counted separately from passes', () => {
    expect(GATE).toContain('let pass = 0, fail = 0, skipped = 0');
    expect(GATE).toContain('Skipped checks are NOT passes');
  });

  it('every skip states what it needs, not merely that it was skipped', () => {
    const skips = GATE.match(/skip\('[^']+',\s*[`'][^`']+/g) ?? [];
    expect(skips.length).toBeGreaterThanOrEqual(4);
    for (const s of skips) expect(s.length).toBeGreaterThan(40);
  });

  it('a failing check names the failure in the summary', () => {
    expect(GATE).toContain('FAILURES:');
    expect(GATE).toContain('process.exit(fail === 0 ? 0 : 1)');
  });
});

describe('§3 it classifies third-party failures by origin, not by message', () => {
  it('REGRESSION: uses requestfailed URLs rather than console text', () => {
    // Chromium reports a failed subresource as a bare "Failed to load
    // resource: net::ERR_..." with no URL in the message, so filtering on text
    // cannot tell a blocked font CDN from a broken application asset. The
    // first version of this harness did exactly that and reported a false
    // failure.
    expect(GATE).toContain("page.on('requestfailed'");
    expect(GATE).toContain('url.startsWith(BASE)');
    expect(GATE).toContain('thirdPartyFailures');
  });

  it('third-party failures are REPORTED, not silently dropped', () => {
    expect(GATE).toContain('third-party hosts that failed to load');
  });
});

describe('§0 provenance - the gate names the build it tested', () => {
  it('asks the deployment which commit it is, before anything else', () => {
    // A passing suite against an unidentified deployment is not evidence. The
    // provenance section must come FIRST so nothing below it is reported
    // against an unknown build.
    const provenance = GATE.indexOf('0. Provenance');
    const firstRealCheck = GATE.indexOf('1-3, 6. Service, health, readiness');
    expect(provenance).toBeGreaterThan(-1);
    expect(provenance).toBeLessThan(firstRealCheck);
    expect(GATE).toContain('/version');
  });

  it('prints the deployed commit where a human and a log will both see it', () => {
    expect(GATE).toContain('DEPLOYED COMMIT');
  });

  it('treats a commit mismatch as a FAILURE, never as a note', () => {
    // The whole point: testing yesterday's build and reporting it as today's
    // is the failure this section exists to prevent. It must reach check(),
    // which counts failures, and not skip() or a bare console.log.
    const block = GATE.slice(GATE.indexOf('if (EXPECT_COMMIT)'), GATE.indexOf('} else {'));
    expect(block).toContain('check(');
    expect(block).not.toContain('skip(');
  });

  it('skips rather than silently passing when no expected commit is given', () => {
    // Not knowing is not the same as matching. With nothing to compare
    // against, this must land in the skip column, which the summary reports
    // separately from passes.
    const elseBlock = GATE.slice(GATE.indexOf('} else {', GATE.indexOf('if (EXPECT_COMMIT)')));
    expect(elseBlock.slice(0, 400)).toContain('skip(');
  });

  it('requires a real SHA - "unknown" is never acceptable as an identity', () => {
    expect(GATE).toMatch(/\/\^\[0-9a-f\]\{7,40\}\$\/i/);
  });
});

describe('§4 it covers the agreed 22 points', () => {
  const points = new Set(
    (GATE.match(/'(\d+)(?:\/\d+)?\. /g) ?? []).map(m => Number(m.match(/\d+/)![0])),
  );

  it('every one of the 22 numbered requirements has at least one check', () => {
    const missing = Array.from({ length: 22 }, (_, i) => i + 1).filter(n => !points.has(n));
    // 22 is the regression suite, which runs in CI rather than against a URL.
    expect(missing).toEqual([22]);
  });

  it('the regression suite is the CI job, not something the URL gate claims', () => {
    // CI invokes it as `pnpm run test`, so assert the whole chain rather than
    // grepping for a tool name the workflow never spells out.
    const ci = read('../.github/workflows/ci.yml');
    expect(ci).toContain('pnpm run test');
    const scripts = JSON.parse(read('../package.json')).scripts;
    expect(scripts.test).toContain('vitest');
  });
});

describe('§5 the workflow runs somewhere that can reach staging', () => {
  it('runs on a GitHub runner and installs a real browser', () => {
    expect(WORKFLOW).toContain('runs-on: ubuntu-latest');
    expect(WORKFLOW).toContain('playwright install');
  });

  it('smoke runs before the expensive browser pass', () => {
    expect(WORKFLOW.indexOf('scripts/smoke.mjs')).toBeLessThan(WORKFLOW.indexOf('scripts/staging-qa.mjs'));
  });

  it('admin credentials come from secrets, never from the workflow file', () => {
    expect(WORKFLOW).toContain('secrets.STAGING_ADMIN_USER');
    expect(WORKFLOW).toContain('secrets.STAGING_ADMIN_PASSWORD');
    expect(WORKFLOW).not.toMatch(/STAGING_ADMIN_PASSWORD:\s*["'][^"'$]/);
  });

  it('the full log is kept, so a failure can be diagnosed after the fact', () => {
    expect(WORKFLOW).toContain('upload-artifact');
  });
});
