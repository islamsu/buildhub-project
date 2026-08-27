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

  it('the role matrix is CHAINED, so each rotation is also a demotion check', () => {
    // Each role's permitted probe is deliberately the NEXT role's forbidden
    // one. That is what makes the forbidden probe do double duty: after a
    // rotation it is the endpoint the PREVIOUS role could reach, refused on the
    // very same cookie - which is the evidence that authority narrows the
    // instant the role changes, with no re-login and no session teardown.
    //
    // Break the chain and the section still passes, but it stops proving
    // demotion. So the chain is pinned here.
    const rows = [...section25().matchAll(
      /\{ role: '([A-Z_]+)',\s*allow: \['([a-zA-Z.]+)', '[a-z.]+'\],\s*deny: \['([a-zA-Z.]+)', '[a-z.]+'\]/g,
    )].map(m => ({ role: m[1], allowEndpoint: m[2], denyEndpoint: m[3] }));

    expect(rows.length, 'the role matrix could not be parsed - rewire this test').toBe(4);
    for (let i = 1; i < rows.length; i++) {
      expect(
        rows[i].denyEndpoint,
        `${rows[i].role}'s forbidden probe must be ${rows[i - 1].role}'s permitted probe, ` +
          'or the rotation stops proving that the previous role lost its access',
      ).toBe(rows[i - 1].allowEndpoint);
    }
  });

  it('a role change is asserted to keep the session and change the authority', () => {
    // Recording the correction, as an assertion. The first draft asserted the
    // target's session DIES on a role change; it failed three times against live
    // staging because setAdminRole deliberately does not touch
    // sessionsInvalidBefore. authenticateRequest re-reads the user row every
    // request, so the role is always live and demotion takes effect at once
    // without logging anyone out.
    const body = section25();
    expect(body, 'the harness must not re-assert that a role change kills the session')
      .not.toContain('the previous session dies');
    expect(body, 'the live-authority property is no longer asserted')
      .toContain('carries ${role} immediately, with no re-login');
    expect(body, 'the assertion must read the role back from admin.me on the OLD cookie')
      .toContain("get('admin.me', undefined, SUB)");
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

describe('§6 the AI sections cannot claim an AI that was never exercised', () => {
  // Sections 27/28 exist because the gate ran 306 green checks against a
  // deployment whose AI assistant was broken for every user. Their own honesty
  // is the thing worth pinning - and with a real provider configured, the
  // SKIP/FAIL line matters most: a configured provider that fails must never
  // be softened into a skip.
  const AI_BLOCK = (() => {
    const start = GATE.indexOf('// ── 27. AI Assistant');
    const end = GATE.indexOf("section('21. Secret exposure')");
    if (start === -1 || end === -1 || end < start) {
      throw new Error('AI section anchors not found - this test is no longer reading the AI sections');
    }
    return GATE.slice(start, end);
  })();

  // Comments explain the reasoning and mention the very strings some of these
  // assertions forbid, so every check below reads executable lines only.
  const EXECUTABLE = AI_BLOCK.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

  // The paid request lives in the Arabic branch. Anchored by offset on BOTH
  // ends: taking a first-occurrence match silently yields an empty slice, and
  // every assertion below would then pass vacuously rather than fail.
  const PAID_START = EXECUTABLE.indexOf('const AR_QUESTION');
  const PAID_END = EXECUTABLE.indexOf('const arDelivered', PAID_START);
  if (PAID_START === -1 || PAID_END === -1) {
    throw new Error('Arabic paid-request anchors not found - this test is no longer reading the live request');
  }
  const PAID = EXECUTABLE.slice(PAID_START, PAID_END);

  const UNCONFIGURED = (() => {
    const i = EXECUTABLE.indexOf("skip('28. a real OpenAI request answers a real question'");
    if (i === -1) throw new Error('unconfigured skip not found');
    return EXECUTABLE.slice(i, EXECUTABLE.indexOf('}', i));
  })();

  it('a CONFIGURED provider failure is a FAILURE and can never be skipped', () => {
    // The single most important property in this file. If OPENAI_API_KEY is
    // set and OpenAI returns 401, 429, 500, a timeout or an empty answer, the
    // gate must go red. A skip there would hide a broken paid integration
    // behind a green run - the exact shape of the original incident.
    expect(PAID).not.toContain('skip(');
    expect(PAID).toContain('the Arabic AI request succeeds against the configured provider');
    expect(PAID).toContain('BuildHub returns a non-empty Arabic answer');
  });

  it('only the unconfigured branch skips, and it says exactly what it needs', () => {
    expect(UNCONFIGURED).toContain('OPENAI_API_KEY');
    expect(UNCONFIGURED).not.toContain('succeeds against the configured provider');
  });

  it('the ANSWER must be Arabic, not just the page around it', () => {
    // A page in Arabic that returns an English answer is a half-working
    // feature, and the surrounding chrome would carry Arabic either way.
    expect(PAID).toContain('the answer itself is written in Arabic');
    expect(PAID).toContain('arabicChars > 20');
  });

  it('the answer cannot be the question echoed back', () => {
    expect(PAID).toContain('the answer is not the question echoed back');
    expect(PAID).toContain('arContent.trim() !== AR_QUESTION');
  });

  it('rendering is proved from the DOM, beyond the length of the typed question', () => {
    expect(PAID).toContain('the Arabic answer appears on screen, beyond the question that was typed');
    expect(PAID).toContain('AR_QUESTION.length');
    expect(PAID).toContain('the rendered Arabic answer is the one the server returned');
  });

  it('right-to-left must survive the answer arriving', () => {
    // An RTL page that flips to LTR when content lands is a broken Arabic
    // experience, and it would pass a check that only looked before the send.
    expect(PAID).toContain('still right-to-left after the answer renders');
  });

  it('the one paid request goes through the real UI, not a bare API call', () => {
    expect(PAID).toContain('arComposer.fill(AR_QUESTION)');
    expect(PAID).toContain("arComposer.press('Enter')");
  });

  it('a DEFAULT run makes at most ONE paid provider call, and proves it', () => {
    // Scoped to the ALWAYS-ON sections. Section 29 is opt-in and makes six more
    // by design, so counting across the whole block would conflate "what a
    // routine run costs" with "what an acceptance run costs".
    const alwaysOnEnd = EXECUTABLE.indexOf('if (AI_KNOWLEDGE_SUITE) {');
    expect(alwaysOnEnd).toBeGreaterThan(0);
    const ALWAYS_ON = EXECUTABLE.slice(0, alwaysOnEnd);
    // Two ai.chat posts, both free: the anonymous 401 and the unconfigured 503.
    expect(ALWAYS_ON.match(/post\('ai\.chat'/g) ?? []).toHaveLength(2);
    // One composer submission: the single paid request.
    expect(ALWAYS_ON.match(/press\('Enter'\)/g) ?? []).toHaveLength(1);
    expect(ALWAYS_ON).toContain('englishAiRequests === 0');
  });

  it('the paid knowledge suite is OPT-IN and says what it costs', () => {
    // Extra paid calls must never ride along on a routine gate run. It is
    // gated on an explicit input, and the skip says so instead of going quiet.
    // The COUNT is asserted against the skip text so that adding a scenario
    // without updating what the operator is told fails here.
    expect(GATE).toContain('const AI_KNOWLEDGE_SUITE');
    expect(GATE).toContain("process.env.STAGING_AI_KNOWLEDGE_SUITE ?? ''");
    expect(GATE).toContain('if (AI_KNOWLEDGE_SUITE) {');
    expect(GATE).toContain("skip('29. BuildHub knowledge priority (live)'");
    expect(GATE).toContain('twelve extra paid provider requests');
    // And the number matches how many paid asks the suite actually makes.
    const suite = GATE.slice(GATE.indexOf('29. BuildHub knowledge priority'));
    const paidAsks = (suite.match(/await ask\(/g) ?? []).length;
    expect(paidAsks).toBe(12);
    expect(WORKFLOW).toContain('ai_knowledge_suite:');
    expect(WORKFLOW).toContain('STAGING_AI_KNOWLEDGE_SUITE:');
  });

  it('the knowledge suite proves grounding with a number only BuildHub knows', () => {
    // "The model seems to know BuildHub" is not evidence. The expected price is
    // read from the deployment's own billing.plans, so the check cannot pass on
    // general knowledge and cannot pass by coincidence.
    const SUITE = GATE.slice(GATE.indexOf('if (AI_KNOWLEDGE_SUITE) {'), GATE.indexOf("skip('29. BuildHub knowledge priority (live)'"));
    expect(SUITE).toContain("get('billing.plans')");
    expect(SUITE).toContain('answer.includes(PRICE)');
    // Both languages must carry the SAME fact.
    expect(SUITE).toContain('the same authoritative fact reaches both languages');
  });

  it('the knowledge suite covers all ten cases the owner listed', () => {
    const SUITE = GATE.slice(GATE.indexOf('if (AI_KNOWLEDGE_SUITE) {'), GATE.indexOf("skip('29. BuildHub knowledge priority (live)'"));
    expect(SUITE).toContain('29.1 a general construction question');
    expect(SUITE).toContain('29.2 a BuildHub fact is answered from BuildHub content');
    expect(SUITE).toContain('29.3 BuildHub content beats the generic marketplace assumption');
    expect(SUITE).toContain('29.4 an unpublished point is acknowledged, not invented');
    expect(SUITE).toContain('29.5 the Arabic question is answered in Arabic');
    expect(SUITE).toContain('29.6 the English question is answered in English');
    expect(SUITE).toContain('29.7 a provider recommendation request is answered');
    expect(SUITE).toContain('29.8 a no-match request never fabricates a company name');
    expect(SUITE).toContain('29.9 a current-information question is answered');
    expect(SUITE).toContain('29.10 the request is refused rather than partially answered');
  });

  it('the cost-control decision is documented in the harness itself', () => {
    expect(AI_BLOCK).toContain('AT MOST ONE PAID PROVIDER REQUEST');
  });

  it('the live question is not an obedience test', () => {
    expect(EXECUTABLE).not.toMatch(/Reply with exactly/i);
  });

  it('every browser context that needs a session gets one - ai.chat is a protectedProcedure', () => {
    // Four CALL SITES now: the English AI surface, the Arabic one, the
    // attachment composer in section 30, and the role loop in section 31 -
    // which is one call site executed once per role. Pinned so a new context
    // that forgets its cookie fails here rather than producing a mysterious
    // 401 on staging.
    expect(EXECUTABLE.match(/addCookies/g) ?? []).toHaveLength(4);
  });

  it('the batched tRPC envelope is handled - the browser does not send bare objects', () => {
    expect(EXECUTABLE).toContain('Array.isArray(parsed) ? parsed[0] : parsed');
  });

  it('Arabic layout is proved by dir=rtl, not by the presence of Arabic glyphs', () => {
    // The navbar's language toggle is itself labelled العربية, so a presence
    // check passes on a page that never switched.
    expect(EXECUTABLE).toContain("dirBefore === 'rtl'");
    expect(EXECUTABLE).toContain("langBefore === 'ar'");
    expect(EXECUTABLE).toContain("localStorage.setItem('buildhub_lang', 'ar')");
  });

  it('the AI response and both pages are checked for credential leakage', () => {
    for (const leak of ['OPENAI_API_KEY', 'api.openai.com', 'Bearer ']) {
      expect(EXECUTABLE).toContain(leak);
    }
    expect(EXECUTABLE).toContain('the Arabic AI response payload contains no');
    expect(EXECUTABLE).toContain('the delivered Arabic AI page contains no API-key-shaped string');
  });

  it('the tool set is COUNTED from the page, not matched against English names', () => {
    // This test used to require eight specific English names, and it passed
    // right up until the grid became role-aware - at which point the gate
    // failed seven checks against a working product. A harness pinned to labels
    // reports a defect whenever the labels legitimately change, which is the
    // opposite of what a gate is for.
    expect(AI_BLOCK).toContain('eight tools are offered for the signed-in role');
    expect(AI_BLOCK).toContain('no tool renders a raw translation key');
    expect(AI_BLOCK).not.toContain('Quantity Surveyor');
  });
});

/** The gate with comment lines stripped, so an assertion cannot be satisfied by prose. */
const CODE = GATE.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');

describe('§7 the attachment section proves the feature without faking storage', () => {
  const SECTION = CODE.slice(CODE.indexOf("section('30. AI Assistant attachments')"));

  it('checks authorization before anything else', () => {
    expect(SECTION).toContain('anonymous attachment upload is refused');
    expect(SECTION).toContain('anonymous attachment deletion is refused');
  });

  it('exercises the validation gate against the real deployment', () => {
    // These run BEFORE storage, so they are genuine live results even on a
    // deployment with no bucket - which is why the section is worth having now
    // rather than after S3 is configured.
    for (const refusal of [
      'an SVG relabelled as a PNG is refused',
      'an HTML document relabelled as a PNG is refused',
      'a format BuildHub does not advertise is refused',
      'a name that disagrees with its own declared type is refused',
      'an empty file is refused',
    ]) {
      expect(SECTION).toContain(refusal);
    }
  });

  it('a storage-blocked upload becomes a SKIP that names what it needs, never a pass', () => {
    expect(SECTION).toContain("skip('30. storing an AI attachment end to end'");
    expect(SECTION).toContain('S3_* not configured on this deployment');
    // And the cross-user check is skipped too rather than silently dropped -
    // it cannot run without a stored file, and pretending otherwise would be
    // the worst kind of green.
    expect(SECTION).toContain("skip('30. cross-user attachment access, live'");
  });

  it('when storage IS configured it proves cross-user refusal and removal', () => {
    expect(SECTION).toContain('another user cannot reference this attachment id');
    expect(SECTION).toContain('a removed attachment can no longer be sent to the model');
    expect(SECTION).toContain('the upload response carries no URL and no storage key');
  });

  it('the picker offers exactly what the server accepts, and is checked in Arabic and on mobile', () => {
    expect(SECTION).toContain('the picker offers exactly what the server accepts');
    expect(SECTION).toContain('the picker does NOT offer a format the server would refuse');
    expect(SECTION).toContain('still usable at 375px');
    expect(SECTION).toContain('labelled in ARABIC, not English');
    // dir=rtl, not "Arabic glyphs are present somewhere" - the same trap that
    // made an earlier Arabic check pass on the navbar's language toggle.
    expect(SECTION).toContain("check(dir === 'rtl'");
  });
});

describe('§8 the regulatory scenario refuses to invent a code requirement', () => {
  const SUITE = CODE.slice(CODE.indexOf('29.11 regulatory'));

  it('asserts the edition is not presented as simply current', () => {
    expect(SUITE).toContain('it does not present the 2018 edition as simply current');
  });

  it('asserts NO numeric requirement is stated', () => {
    // The assistant was never given a cover depth. If one appears in the
    // answer it was invented, and that is the single most dangerous output
    // this product can produce.
    expect(SUITE).toContain('it does NOT invent a numeric code requirement');
    // The actual guard in the gate: a two-or-three digit millimetre figure.
    expect(SUITE).toContain('s?mm');
  });

  it('asserts the answer points at the authority', () => {
    expect(SUITE).toContain('it points at the authority rather than answering the clause from memory');
  });
});

describe('§9 semantic retrieval is proven live, not assumed', () => {
  // Anchored at the ask() itself: the INFO line comes after it, so slicing on
  // the label would cut off the very statement under test.
  const SUITE = CODE.slice(CODE.indexOf('const q12 = await ask('));

  it('asks a question that shares NO keyword with the corpus', () => {
    // If the question matched lexically, a pass would prove nothing about
    // semantic ranking - the old ranker would have found it too.
    expect(SUITE).toContain('Water is seeping through the underground car park slab');
  });

  it('reads the capability rather than inferring retrieval from answer quality', () => {
    // The model has its own construction knowledge, so a good answer is not
    // evidence that BuildHub's corpus was consulted. The server has to say.
    expect(SUITE).toContain('aiSemanticRetrieval');
    expect(SUITE).toContain("check(caps?.aiSemanticRetrieval === true");
    expect(SUITE).toContain('not by keyword fallback');
  });
});

describe('§10 the role section proves six experiences, not six headings', () => {
  const SECTION = CODE.slice(CODE.indexOf("section('31. Role-aware AI experiences')"));

  it('walks every role, not a sample', () => {
    expect(SECTION).toContain('for (const role of ROLES)');
    expect(SECTION).toContain("check(seen.size === ROLES.length");
  });

  it('asserts DISTINCT tool sets, not just distinct titles', () => {
    // A page that changed only its heading would pass a title-only check while
    // delivering none of the feature. This is the assertion that would catch it.
    expect(SECTION).toContain('every role has a DISTINCT tool set');
    expect(SECTION).toContain('new Set(toolSets).size === seen.size');
  });

  it('checks a specific pair, so six shuffles of one tool set cannot pass', () => {
    expect(SECTION).toContain('the homeowner is NOT shown contractor RFQ tooling');
    expect(SECTION).toContain('the contractor is NOT shown the homeowner designer finder');
  });

  it('proves the general composer survives personalisation for every role', () => {
    expect(SECTION).toContain('the general composer is still available');
  });

  it('costs nothing - opening a role page fires no AI request', () => {
    expect(SECTION).toContain('opening the page costs nothing');
    expect(SECTION).toContain('aiRequests === 0');
  });

  it('covers Arabic per role, by dir=rtl and a translated title', () => {
    expect(SECTION).toContain("check(dir === 'rtl'");
    expect(SECTION).toContain('the role title is in ARABIC');
    expect(SECTION).toContain('no untranslated key is rendered in Arabic');
  });
});
