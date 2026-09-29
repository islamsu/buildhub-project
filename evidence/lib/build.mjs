/**
 * ── WHICH BUILD DID THIS PROBE ACTUALLY TEST? ────────────────────────────
 *
 * Every green number in this directory is a claim about a running BuildHub,
 * and until now none of them said WHICH one. That is precisely the ambiguity
 * that let a deployment lag masquerade as a missing feature: the owner clicked
 * a build that did not contain the code, the probes passed against a build
 * that did, and both reports were true about different things.
 *
 * So a probe states the build it tested, and refuses to report at all when it
 * was told to expect a particular commit and found another.
 *
 * TWO MODES, deliberately:
 *
 *   ZG_EXPECT_COMMIT set    the build MUST match, or the probe exits non-zero
 *                           before testing anything. This is what staging
 *                           acceptance uses: a pass against the wrong build is
 *                           worse than no pass, because somebody will act on it.
 *
 *   not set                 the build is printed and testing continues. Local
 *                           development rebuilds constantly and pinning it
 *                           would make the probes unusable where they are
 *                           written.
 *
 * "unknown" IS A FAILURE WHEN A COMMIT WAS EXPECTED. A build that cannot say
 * what it is cannot be verified, and accepting it would defeat the whole
 * mechanism. Where nothing was expected, "unknown" is reported loudly and the
 * run continues.
 */

/** A prefix match, so a seven-character short SHA can pin a full one. */
function commitsAgree(actual, expected) {
  if (!actual || actual === 'unknown') return false;
  const a = actual.toLowerCase();
  const e = expected.trim().toLowerCase();
  return a.startsWith(e) || e.startsWith(a);
}

/**
 * Read /version from the target and report it. Call this FIRST in a probe,
 * before any assertion, so the line appears above the results it describes.
 *
 * Returns the parsed identity so a probe can print or assert on it.
 */
export async function assertBuild(base, { expect = process.env.ZG_EXPECT_COMMIT } = {}) {
  let identity;
  try {
    const res = await fetch(`${base}/version`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    identity = await res.json();
  } catch (error) {
    // A target that cannot answer /version is not a target this probe can
    // make any honest claim about.
    console.error(`BUILD  unreachable: ${base}/version (${String(error).split('\n')[0]})`);
    process.exit(3);
  }

  const { commit = 'unknown', shortCommit = 'unknown', buildTime = null, environment = 'unknown' } = identity;
  const when = buildTime ? ` built ${buildTime}` : ' build time unknown';
  console.log(`BUILD  ${shortCommit} (${environment})${when}  ${base}`);

  if (expect) {
    if (!commitsAgree(commit, expect)) {
      console.error(`BUILD  MISMATCH: expected ${expect}, serving ${commit}.`);
      console.error('BUILD  Refusing to test - a pass against the wrong build is worse than no pass.');
      process.exit(3);
    }
    console.log(`BUILD  matches the expected commit ${expect}`);
  } else if (commit === 'unknown') {
    console.log('BUILD  WARNING: this target cannot say which commit it is.');
  }

  return { commit, shortCommit, buildTime, environment };
}
