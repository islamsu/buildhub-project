import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ADMIN_ROLES, ADMIN_ROLE_PERMISSIONS } from '@shared/adminRoles';

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

/**
 * Section 25's source, sliced by real anchors.
 *
 * Throws when either anchor is missing rather than returning '', because a
 * slice that collapses to the empty string makes every assertion over it pass
 * vacuously - the failure mode these tests exist to prevent.
 */
const section25 = () => {
  const start = GATE.indexOf("section('25.");
  const end = GATE.indexOf('18. ADMIN AUTHORIZATION', start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('section 25 could not be located in staging-qa.mjs - rewire these tests');
  }
  return GATE.slice(start, end);
};

describe('§4 it covers the agreed 22 points', () => {
  const points = new Set(
    (GATE.match(/'(\d+)(?:\/\d+)?\. /g) ?? []).map(m => Number(m.match(/\d+/)![0])),
  );

  it('every one of the 22 numbered requirements has at least one check', () => {
    const missing = Array.from({ length: 22 }, (_, i) => i + 1).filter(n => !points.has(n));
    // 22 is the regression suite, which runs in CI rather than against a URL.
    //
    // This caught a real collision: the administrator checks were first numbered
    // 22, which made the gate LOOK like it covered the CI regression suite from
    // a URL - something it cannot do. They are 23 now, and 22 stays reserved.
    expect(missing).toEqual([22]);
  });

  it('24 is the content abuse controls, and it is genuinely covered', () => {
    // Also beyond the original 22, for the same reason: authenticated content
    // rate limiting is a new concern. Pinned so a section that costs real time
    // to run cannot be quietly dropped to make the gate faster.
    expect(points.has(24), 'the abuse-control section is missing from the gate').toBe(true);
    expect(GATE).toContain('upload flooding is refused');
    expect(GATE).toContain('RFQ flooding is refused');
    // The half that stops this becoming a test of "the limit is set to zero".
    expect(GATE).toContain('the limit does not block legitimate posting');
  });

  it('the abuse probe uses its own account, so it cannot make other sections order-dependent', () => {
    const section = GATE.slice(GATE.indexOf("section('24."), GATE.indexOf('13-14. RFQ'));
    expect(section.length, 'section 24 could not be isolated - rewire this test').toBeGreaterThan(0);
    expect(section, 'the probe must sign up its own user rather than burn a shared persona')
      .toContain("signUp('homeowner', 'rate')");
    expect(section).not.toContain('users.contractor.cookie');
    expect(section).not.toContain('users.homeowner.cookie');
  });

  it('25 is the sub-admin lifecycle, and it is genuinely covered', () => {
    expect(points.has(25), 'the sub-admin lifecycle section is missing from the gate').toBe(true);

    // ONLY the executed branch. The skip branch names the same five claims so
    // an unsupplied credential still reports what is missing - which means a
    // toContain over the whole section matches the SKIP LIST and passes even if
    // the real check is deleted. Caught by mutation testing: removing the
    // single-use check left this test green until it was sliced this way.
    const executed = section25().slice(section25().indexOf('} else {'));
    expect(executed.length, 'the executed branch of section 25 could not be isolated').toBeGreaterThan(0);

    for (const claim of [
      'a Super Admin can invite a sub-administrator',
      'the invitee redeems the invitation and sets a password',
      'the invitation is single-use',
      'the new sub-administrator signs in at /admin/login',
      'a deactivated administrator can no longer sign in',
    ]) {
      const at = executed.indexOf(claim);
      expect(at, `section 25 no longer mentions: ${claim}`).toBeGreaterThan(-1);
      expect(
        executed.slice(Math.max(0, at - 400), at),
        `"${claim}" is no longer the subject of a check() - deleting the check while ` +
          'leaving the name in the skip list must not read as coverage',
      ).toContain('check(');
    }

    // Every management endpoint the harness had zero coverage of before, pinned
    // at the exact CALL SITE. `toContain('admin.setAdminRole')` was not enough:
    // the string also appears in the self-elevation attempt, so breaking the
    // role ROTATION left it green.
    expect(executed, 'the sub-admin is no longer created')
      .toContain("post('admin.createAdmin'");
    expect(executed, 'the invitation is no longer redeemed')
      .toContain("post('auth.completeAdminInvitation', { token, password: subPassword })");
    expect(executed, 'the role is no longer ROTATED by a Super Admin')
      .toContain("post('admin.setAdminRole', { userId: subId, adminRole: role }, SUPER)");
    expect(executed, 'self-elevation is no longer attempted')
      .toContain("post('admin.setAdminRole', { userId: subId, adminRole: 'SUPER_ADMIN' }, SUB)");
    expect(executed, 'the invitation audit is no longer read')
      .toContain("get('admin.adminInvitations'");
    expect(executed, 'the QA sub-admin is no longer deactivated at the end')
      .toContain("post('admin.setAdminActive', { userId: subId, active: false }, SUPER)");
  });

  it('the role matrix is DISCRIMINATING, checked against the real permission map', () => {
    // The failure this exists to prevent: a permitted/forbidden pair chosen from
    // permissions every role happens to share, so the test passes for all four
    // roles and proves nothing about any of them. `users.read` is the trap -
    // all five roles hold it - so a matrix using admin.users as its permitted
    // probe would be green and worthless.
    //
    // Parsed out of the harness and cross-checked against ADMIN_ROLE_PERMISSIONS,
    // so weakening the matrix fails HERE rather than passing silently on staging.
    const rows = [...GATE.matchAll(
      /\{\s*role:\s*'([A-Z_]+)',\s*allow:\s*\[[^\]]*?'([a-z.]+)'\s*\],\s*deny:\s*\[[^\]]*?'([a-z.]+)'\s*\]/g,
    )].map(m => ({ role: m[1], allow: m[2], deny: m[3] }));

    expect(rows.length, 'the role matrix could not be parsed - rewire this test').toBe(4);
    expect(rows.map(r => r.role).sort())
      .toEqual(['BILLING_ADMIN', 'MARKETPLACE_ADMIN', 'SUPPORT_ADMIN', 'USER_ADMIN']);

    for (const { role, allow, deny } of rows) {
      const held = ADMIN_ROLE_PERMISSIONS[role as keyof typeof ADMIN_ROLE_PERMISSIONS];
      expect(held, `${role} is not a real role`).toBeDefined();
      expect(held, `${role} does NOT hold ${allow}, so the permitted probe would fail for the wrong reason`)
        .toContain(allow);
      expect(held, `${role} DOES hold ${deny}, so the forbidden probe would pass for the wrong reason`)
        .not.toContain(deny);
    }

    // And the trap itself, stated as an assertion rather than a comment.
    const universal = ADMIN_ROLES.filter(r => ADMIN_ROLE_PERMISSIONS[r].includes('users.read'));
    expect(universal.length, 'users.read is meant to be held by every role').toBe(ADMIN_ROLES.length);
    expect(rows.map(r => r.allow), 'a permission every role holds cannot discriminate between roles')
      .not.toContain('users.read');
  });

  it('the sub-admin section never prints the token or the password', () => {
    const body = section25();

    // `check` prints its third argument. No detail may be derived from the
    // credential itself; a length is fine, the value never is.
    const details = [...body.matchAll(/check\([^;]*?,\s*`([^`]*)`\s*\)/gs)].map(m => m[1]);
    for (const d of details) {
      expect(d, `a check detail interpolates a credential: ${d}`).not.toMatch(/\$\{\s*token\s*\}/);
      expect(d, `a check detail interpolates a credential: ${d}`).not.toMatch(/\$\{\s*subPassword\s*\}/);
      expect(d, `a check detail interpolates a credential: ${d}`).not.toMatch(/\$\{\s*inviteLink\s*\}/);
    }
    expect(body, 'the token must never be console.logged').not.toMatch(/console\.log\([^)]*token/);
  });

  it('23 is the administrator door, and it is genuinely covered', () => {
    // Numbered beyond the original 22 because administrator authentication is a
    // new concern, not one of the agreed points. Pinned so it cannot quietly
    // disappear the way an unnumbered section could.
    expect(points.has(23), 'the administrator section is missing from the gate').toBe(true);
    expect(GATE).toContain('a customer CANNOT sign in at the administrator door');
    expect(GATE).toContain('INDISTINGUISHABLE from an unknown account');
  });

  it('a failed check actually fails the workflow', () => {
    // The gate exits 1 on a failed check and always has. But the workflow piped
    // it into `tee`, and a pipeline's exit status is the LAST command's - tee
    // always succeeds - so the step exited 0 regardless. `bash -e` does not
    // change that; only `pipefail` does.
    //
    // Invisible until a run was genuinely red: run #13 published two named
    // FAILURES and "171/173 checks passed" under a green tick. Pinned here
    // because the failure mode is silent by construction - the only symptom is
    // a gate that never goes red, which looks exactly like a healthy one.
    const wf = read('../.github/workflows/staging-qa.yml');
    const step = wf.slice(wf.indexOf('Staging launch-readiness gate'));
    const block = step.slice(0, step.indexOf('Record which build was tested'));
    expect(block.length, 'the gate step could not be isolated - rewire this test').toBeGreaterThan(0);

    // COMMENTS STRIPPED FIRST, and that is the whole point of this line. The
    // first version of this test asserted `toContain('set -o pipefail')` over
    // the raw block - which matched the COMMENT explaining pipefail, so
    // deleting the actual command left the test green. Caught by mutation
    // testing. Only executable lines may satisfy an assertion about behaviour.
    const commands = block
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));

    expect(commands, 'the gate is piped into tee').toContain(
      'node scripts/staging-qa.mjs "${{ steps.target.outputs.url }}" | tee qa-output.txt',
    );
    expect(
      commands,
      'piping the gate into tee without pipefail throws away its exit code',
    ).toContain('set -o pipefail');
    expect(
      commands.indexOf('set -o pipefail'),
      'pipefail must be set BEFORE the pipeline it protects',
    ).toBeLessThan(commands.findIndex(line => line.startsWith('node scripts/staging-qa.mjs')));
  });

  it('the harness itself still exits non-zero on a failed check', () => {
    // The other half. pipefail only helps if there is a failure to propagate.
    expect(GATE).toContain('process.exit(fail === 0 ? 0 : 1)');
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
