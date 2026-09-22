/**
 * ── WHICH COMMIT IS THIS BUILD? ──────────────────────────────────────────
 *
 * The owner looked at a deployed BuildHub, clicked through the admin console,
 * and reported that changes they had asked for were absent. They were right
 * about what they saw and wrong about why: the code was present on the branch
 * and the build in front of them did not contain it. Nothing in the running
 * product could answer "which commit am I looking at?", so a deployment lag
 * was indistinguishable from a missing feature, and days were spent looking
 * for a bug that did not exist.
 *
 * This writes the answer into the build itself, at build time, so the running
 * product can always say what it is.
 *
 * WHERE THE COMMIT COMES FROM, in order:
 *
 *   BUILD_COMMIT         an explicit override - a hand-built image, a CI job,
 *                        anywhere the other two are not available
 *   RENDER_GIT_COMMIT    injected by Render into every service it builds
 *   git rev-parse HEAD   a local or CI build with a working tree
 *
 * `.git` is excluded from the Docker build context (see .dockerignore), so
 * inside an image the third source does not exist. That is why the Dockerfile
 * takes BUILD_COMMIT as a build argument rather than relying on git being
 * there - a generator that quietly produced "unknown" in exactly the
 * environment that matters most would be worse than no generator at all.
 *
 * NOTHING IS INVENTED. If no source can answer, the file records "unknown"
 * and says which sources were tried. A build that cannot identify itself must
 * say so plainly: the staging gate treats "unknown" as a failure when it was
 * told to expect a specific commit, and that refusal is the entire point.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'build-info.json');

/** Only ever emit something that is shaped like a commit. */
const asCommit = value => {
  const trimmed = (value ?? '').trim();
  return /^[0-9a-f]{7,40}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
};

function resolveCommit() {
  const tried = [];
  for (const [source, value] of [
    ['BUILD_COMMIT', process.env.BUILD_COMMIT],
    ['RENDER_GIT_COMMIT', process.env.RENDER_GIT_COMMIT],
  ]) {
    tried.push(source);
    const commit = asCommit(value);
    if (commit) return { commit, source, tried };
  }
  tried.push('git');
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const commit = asCommit(out);
    if (commit) return { commit, source: 'git', tried };
  } catch {
    // No working tree - an image build. Falls through to "unknown", which is
    // the honest answer and the one the gate can act on.
  }
  return { commit: 'unknown', source: 'none', tried };
}

const { commit, source, tried } = resolveCommit();
const info = {
  commit,
  shortCommit: commit === 'unknown' ? 'unknown' : commit.slice(0, 7),
  // ISO, UTC, and generated once per build rather than read at request time -
  // "built at" and "started at" are different facts and conflating them hides
  // a container that has been restarting.
  buildTime: new Date().toISOString(),
  commitSource: source,
  sourcesTried: tried,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(info, null, 2)}\n`);

console.log(`[build-info] commit ${info.shortCommit} (from ${source}) at ${info.buildTime}`);
if (commit === 'unknown') {
  console.warn('[build-info] WARNING: this build cannot say which commit it is.');
  console.warn('[build-info] Pass BUILD_COMMIT, or build where RENDER_GIT_COMMIT or git is available.');
}
