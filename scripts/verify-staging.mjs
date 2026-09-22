/**
 * ── DID STAGING GET THE BUILD WE THINK IT DID? ──────────────────────────
 *
 * This engineering container cannot reach `*.onrender.com` - the proxy
 * refuses the connection under an organization egress policy - so the owner
 * is the one who can see /version. That makes "is staging current?" a
 * question answered by pasting, and pasting invites eyeballing two long hex
 * strings, which is exactly how a stale build gets accepted.
 *
 * So it is mechanical instead.
 *
 *   curl -s https://<staging-host>/version | node scripts/verify-staging.mjs
 *
 * or, with the output already in hand:
 *
 *   node scripts/verify-staging.mjs '{"commit":"...","environment":"staging"}'
 *
 * It compares against the RELEASE CANDIDATE HEAD in this checkout and exits
 * non-zero when they differ, so it can be used in a pipeline as well as read.
 *
 * WHAT IT REFUSES TO CALL VERIFIED:
 *
 *   a commit that is not this branch's head        - staging is behind
 *   "unknown"                                      - the build cannot say
 *   environment "production"                       - wrong deployment, and
 *                                                    the one mistake that
 *                                                    matters most
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BRANCH = 'claude/buildhub-global-release-candidate';

function readInput() {
  const arg = process.argv.slice(2).join(' ').trim();
  if (arg) return arg;
  try { return readFileSync(0, 'utf8').trim(); } catch { return ''; }
}

const raw = readInput();
if (!raw) {
  console.error('Usage: curl -s https://<host>/version | node scripts/verify-staging.mjs');
  process.exit(2);
}

let served;
try {
  served = JSON.parse(raw);
} catch {
  console.error('That is not the JSON /version returns. Paste the whole response.');
  console.error(`Got: ${raw.slice(0, 120)}`);
  process.exit(2);
}

const expected = execSync(`git rev-parse ${BRANCH}`, { encoding: 'utf8' }).trim();
const commit = String(served.commit ?? '').toLowerCase();
const environment = String(served.environment ?? '');

const problems = [];
if (!commit || commit === 'unknown') {
  problems.push('the deployed build cannot say which commit it is (commit: "unknown")');
} else if (commit !== expected.toLowerCase()) {
  // Behind, ahead or simply different - all the same answer: not this build.
  let relation = 'a different commit';
  try {
    execSync(`git cat-file -e ${commit}^{commit}`, { stdio: 'ignore' });
    const behind = execSync(`git rev-list --count ${commit}..${expected}`, { encoding: 'utf8' }).trim();
    if (Number(behind) > 0) relation = `${behind} commit(s) BEHIND the release candidate`;
  } catch {
    relation = 'a commit this checkout does not contain';
  }
  problems.push(`staging is serving ${commit.slice(0, 7)} — ${relation}`);
}
if (environment === 'production') {
  problems.push('environment reads "production" — either this is the wrong host, or APP_ENV is not set on staging');
} else if (!environment || environment === 'unknown') {
  problems.push('environment is not set — add APP_ENV=staging to the service');
}

console.log(`expected  ${expected.slice(0, 7)}  (${BRANCH})`);
console.log(`serving   ${commit ? commit.slice(0, 7) : '—'}  environment ${environment || '—'}  built ${served.buildTime ?? '—'}`);

if (problems.length === 0) {
  console.log('\nSTAGING MATCHES THE RELEASE CANDIDATE.');
  console.log('Browser acceptance against this host can be trusted for this SHA.');
  process.exit(0);
}

console.log('\nNOT VERIFIED:');
for (const problem of problems) console.log(`  - ${problem}`);
console.log('\nDo not treat anything on that host as visually verified for this SHA.');
process.exit(1);
