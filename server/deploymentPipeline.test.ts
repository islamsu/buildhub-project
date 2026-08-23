import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

/**
 * Slice 6 — the deployment pipeline.
 *
 * BuildHub had no `.github` directory, no Dockerfile, and no deployment
 * configuration of any kind. Everything below is new, and none of it can be
 * executed from this sandbox: Vultr is unreachable through the egress
 * allowlist, no Docker daemon runs here, and no infrastructure or credentials
 * exist yet. The CI `docker` job is where the image first gets built and booted
 * for real.
 *
 * So these tests do the one thing that IS checkable here, and it happens to be
 * the thing that matters most: the pipeline's SAFETY properties. A deploy
 * pipeline's failure modes are not "it didn't run" - they are "it ran when it
 * shouldn't have", "it deployed something nobody tested", and "it committed a
 * credential".
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const CI_RAW = read('../.github/workflows/ci.yml');
const STAGING_RAW = read('../.github/workflows/deploy-staging.yml');
const PRODUCTION_RAW = read('../.github/workflows/deploy-production.yml');
const DOCKERFILE = read('../Dockerfile');
const DOCKERIGNORE = read('../.dockerignore');
const COMPOSE_RAW = read('../deploy/docker-compose.yml');
const SMOKE = read('../scripts/smoke.mjs');
const PACKAGE_JSON = JSON.parse(read('../package.json'));

const CI = parseYaml(CI_RAW);
const STAGING = parseYaml(STAGING_RAW);
const PRODUCTION = parseYaml(PRODUCTION_RAW);
const COMPOSE = parseYaml(COMPOSE_RAW);

const WORKFLOWS: [string, string][] = [
  ['ci.yml', CI_RAW],
  ['deploy-staging.yml', STAGING_RAW],
  ['deploy-production.yml', PRODUCTION_RAW],
];

// ── §1 Nothing deploys itself by accident ──────────────────────────────────

describe('§1 production can only be released deliberately', () => {
  it('has no push, pull_request or schedule trigger at all', () => {
    // `on:` parses to the boolean true in YAML 1.1, so read the key explicitly.
    const triggers = Object.keys(PRODUCTION[true] ?? PRODUCTION.on ?? {});
    expect(triggers).toEqual(['workflow_dispatch']);
  });

  it('requires a typed confirmation before it will do anything', () => {
    expect(PRODUCTION_RAW).toContain("inputs.confirm != 'DEPLOY'");
    const inputs = (PRODUCTION[true] ?? PRODUCTION.on).workflow_dispatch.inputs;
    expect(inputs.confirm.required).toBe(true);
  });

  it('refuses to release from anything but the default branch', () => {
    expect(PRODUCTION_RAW).toContain("github.ref != 'refs/heads/main'");
  });

  it('gates the release job behind a GitHub environment, which is the human approval', () => {
    expect(PRODUCTION.jobs.release.environment.name).toBe('production');
    expect(PRODUCTION.jobs.release.needs).toBe('preflight');
  });

  it('deploys an image that already exists rather than building a new one', () => {
    // Rebuilding would ship a different artefact from the one staging verified.
    expect(PRODUCTION_RAW).not.toContain('docker/build-push-action');
    expect(PRODUCTION_RAW).not.toContain('pnpm run build');
    expect(PRODUCTION_RAW).toContain('inputs.image_tag');
  });

  it('only accepts a commit-SHA tag, never a moving one like "latest"', () => {
    expect(PRODUCTION_RAW).toContain("grep -Eq '^[0-9a-f]{12}$'");
  });

  it('refuses to start when production is not configured, rather than half-deploying', () => {
    expect(PRODUCTION_RAW).toContain('Production is not configured');
  });
});

describe('§1b staging is inert until it is configured', () => {
  it('skips quietly instead of failing every push while infrastructure is being set up', () => {
    expect(STAGING.jobs.gate).toBeDefined();
    expect(STAGING.jobs.verify.if).toContain("needs.gate.outputs.configured == 'true'");
  });

  it('keeps publish and deploy behind that gate TRANSITIVELY, via needs', () => {
    // Only `verify` carries the `if:`. publish and deploy are held back solely
    // because a skipped `needs` skips its dependents - which is real, but
    // invisible: delete `needs: verify` from publish while "tidying up" and
    // every push to main would build and ship an image, with nothing failing
    // to say so. This pins the chain that actually does the work.
    expect(STAGING.jobs.publish.needs).toBe('verify');
    expect(STAGING.jobs.deploy.needs).toBe('publish');
  });

  it('has no deploy job reachable without passing through the gate', () => {
    // Walk each job back to `gate`. Any job that performs a deploy-ish action
    // and cannot reach the gate is a hole, whatever its `if:` says.
    const reachesGate = (name: string, seen = new Set<string>()): boolean => {
      if (name === 'gate') return true;
      if (seen.has(name)) return false;
      seen.add(name);
      const needs = STAGING.jobs[name]?.needs;
      const parents = Array.isArray(needs) ? needs : needs ? [needs] : [];
      return parents.length > 0 && parents.every(parent => reachesGate(parent, seen));
    };
    for (const name of Object.keys(STAGING.jobs)) {
      if (name === 'gate') continue;
      expect(reachesGate(name), `job "${name}" can run without the staging gate`).toBe(true);
    }
  });

  it('runs only from the default branch', () => {
    expect((STAGING[true] ?? STAGING.on).push.branches).toEqual(['main']);
  });

  it('never touches production', () => {
    expect(STAGING_RAW).not.toContain('PRODUCTION_SSH');
    expect(STAGING.jobs.deploy.environment.name).toBe('staging');
  });
});

// ── §2 Nothing untested reaches a server ───────────────────────────────────

describe('§2 the gate is the same one every slice was held to', () => {
  it('CI runs typecheck, tests and build', () => {
    const steps = CI.jobs.verify.steps.map((step: { run?: string }) => step.run).filter(Boolean);
    expect(steps).toContain('pnpm run check');
    expect(steps).toContain('pnpm run test');
    expect(steps).toContain('pnpm run build');
  });

  it('CI runs on every branch, so a problem is found before a pull request exists', () => {
    expect((CI[true] ?? CI.on).push.branches).toEqual(['**']);
  });

  it('staging re-runs the full gate before it publishes an image', () => {
    expect(STAGING.jobs.publish.needs).toBe('verify');
    const steps = STAGING.jobs.verify.steps.map((step: { run?: string }) => step.run).filter(Boolean);
    for (const command of ['pnpm run check', 'pnpm run test', 'pnpm run build']) {
      expect(steps).toContain(command);
    }
  });

  it('every deploy is smoke tested, and a failure rolls back', () => {
    for (const raw of [STAGING_RAW, PRODUCTION_RAW]) {
      expect(raw).toContain('node scripts/smoke.mjs');
      expect(raw).toContain('if: failure()');
      expect(raw).toMatch(/\.image\.env\.previous/);
    }
  });

  it('CI proves the migrations apply to an empty database, and are re-runnable', () => {
    expect(CI.jobs.migrations.services.mariadb.image).toContain('mariadb');
    const steps = CI.jobs.migrations.steps.map((step: { name?: string }) => step.name);
    expect(steps).toContain('Apply migrations to an empty database');
    expect(steps).toContain('Applying twice is a no-op');
  });

  it('CI builds the image AND boots it — a container that cannot start is a broken deploy', () => {
    expect(CI.jobs.docker).toBeDefined();
    expect(CI_RAW).toContain('docker build -t buildhub:ci .');
    expect(CI_RAW).toContain('/healthz');
  });

  it('CI fails the build if the previewer runtime or a build placeholder returns', () => {
    expect(CI_RAW).toContain('id="manus-runtime"');
    expect(CI_RAW).toContain("grep -q '%VITE_'");
  });
});

// ── §3 Migrations apply, never generate ────────────────────────────────────

describe('§3 migrations are apply-only everywhere', () => {
  it('db:migrate does not generate, and db:push (which can drop columns) is separate', () => {
    expect(PACKAGE_JSON.scripts['db:migrate']).toBe('drizzle-kit migrate');
    expect(PACKAGE_JSON.scripts['db:push']).toContain('generate');
  });

  it('no workflow ever runs db:push or drizzle-kit generate against a server', () => {
    for (const [name, raw] of WORKFLOWS) {
      // Comments stripped: ci.yml's own note explains that this must never be
      // `db:push`, so a naive search finds the warning and reports the opposite.
      const code = raw.split('\n').filter(line => !line.trim().startsWith('#')).join('\n');
      expect(code, name).not.toContain('db:push');
      expect(code, name).not.toContain('drizzle-kit generate');
    }
  });

  it('a production release backs up the database before migrating', () => {
    const names = PRODUCTION.jobs.release.steps.map((step: { name?: string }) => step.name);
    const backupIndex = names.indexOf('Back up the database before migrating');
    const migrateIndex = names.indexOf('Apply database migrations');
    expect(backupIndex).toBeGreaterThan(-1);
    expect(backupIndex).toBeLessThan(migrateIndex);
  });

  it('says plainly that a rollback does not revert the migration', () => {
    // Rolling the image back while the schema has moved forward is the trap
    // here; the operator needs to know before they are in the middle of it.
    expect(PRODUCTION_RAW).toContain('The database migration was NOT reverted');
  });
});

// ── §4 No secret is ever committed ─────────────────────────────────────────

describe('§4 secrets live in GitHub and on the host, never in the repository', () => {
  it('workflows reference secrets only through the secrets context', () => {
    for (const [name, raw] of WORKFLOWS) {
      const assignments = raw.match(/(?:JWT_SECRET|DATABASE_URL|S3_SECRET_ACCESS_KEY|SSH_KEY)\s*[:=]\s*(\S+)/g) ?? [];
      for (const assignment of assignments) {
        // Matched against the whole assignment, not a re-split value: a
        // connection string contains both ':' and '/' and does not survive
        // being taken apart and reassembled.
        //
        // Real values come only from the secrets context. The exceptions are
        // throwaways scoped to a CI job's own ephemeral service container,
        // which grant access to nothing that outlives the run.
        const fromSecretsContext = assignment.includes('${{');
        const ephemeralCiOnly = /ci-root|mysql:\/\/unused|ci-only-secret/.test(assignment);
        expect(fromSecretsContext || ephemeralCiOnly, `${name}: ${assignment}`).toBe(true);
      }
    }
  });

  it('the compose file supplies every value from the environment', () => {
    for (const value of Object.values(COMPOSE.services.app.environment as Record<string, string>)) {
      const literal = String(value);
      const isInterpolated = literal.startsWith('${');
      const isSafeConstant = ['production', '3000', 'buildhub'].includes(literal);
      expect(isInterpolated || isSafeConstant, literal).toBe(true);
    }
  });

  it('the compose file refuses to start without the values that must not default', () => {
    const env = COMPOSE.services.app.environment as Record<string, string>;
    for (const required of ['DATABASE_URL', 'JWT_SECRET', 'APP_BASE_URL']) {
      expect(String(env[required])).toMatch(/:\?/);
    }
  });

  it('.dockerignore keeps real environment files out of the image', () => {
    expect(DOCKERIGNORE).toContain('.env');
    expect(DOCKERIGNORE).toContain('.env.*');
    expect(DOCKERIGNORE).toContain('!.env.example');
  });

  it('the CI database password is obviously a throwaway and is never reused', () => {
    expect(CI_RAW).toContain('ci-root');
    expect(CI_RAW).not.toContain('buildhub:buildhub');
  });
});

// ── §5 The image ───────────────────────────────────────────────────────────

describe('§4b GitHub Actions runtime', () => {
  // Every workflow file on disk, not just the deploy trio in WORKFLOWS -
  // staging-qa.yml is the only one that uses upload-artifact, so leaving it out
  // made the version assertion below match nothing and pass vacuously.
  const WORKFLOW_SOURCES = readdirSync(new URL('../.github/workflows/', import.meta.url))
    .filter(name => name.endsWith('.yml'))
    .map(name => read(`../.github/workflows/${name}`))
    .join('\n');

  it('runs no action still pinned to the Node 20 runtime', () => {
    // GitHub forces Node 24 from 2026-06-02 and removes Node 20 on
    // 2026-09-16. Until these were bumped every run carried:
    //   "Node.js 20 is deprecated. The following actions target Node.js 20
    //    but are being forced to run on Node.js 24"
    expect(WORKFLOW_SOURCES).not.toContain('actions/checkout@v4');
    expect(WORKFLOW_SOURCES).not.toContain('actions/setup-node@v4');
    expect(WORKFLOW_SOURCES).not.toContain('actions/upload-artifact@v4');
  });

  it('uses upload-artifact v6 or later, NOT v5', () => {
    // The trap in this upgrade. checkout and setup-node move to Node 24 at
    // v5, but upload-artifact v5 still DEFAULTS to Node 20 - only v6 changes
    // the runtime. A uniform "bump everything to v5" leaves the deprecation
    // warning exactly where it was and looks like it fixed something.
    const versions = [...WORKFLOW_SOURCES.matchAll(/actions\/upload-artifact@v(\d+)/g)].map(m => Number(m[1]));
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) expect(v).toBeGreaterThanOrEqual(6);
  });

  it('leaves pnpm/action-setup alone, for a reason that is NOT "it is fine"', () => {
    // CORRECTION. An earlier version of this test claimed pnpm/action-setup
    // "was never in the deprecation warning". That was wrong. It was absent
    // from the warning the staging-qa job emits - that job does not use pnpm -
    // but once the three actions/* were upgraded, the CI job's warning read:
    //
    //   Node.js 20 is deprecated. The following actions target Node.js 20 but
    //   are being forced to run on Node.js 24: pnpm/action-setup@v4
    //
    // Verified against the action's own manifest rather than inferred:
    //   pnpm/action-setup@master -> runs.using: node24
    //   pnpm/action-setup@v4     -> runs.using: node20
    //
    // So upstream has the fix on master but has NOT released a tag carrying
    // it. Pinning CI to a mutable branch, or to an unreleased commit, is worse
    // than living with a warning for an action GitHub already force-runs on
    // Node 24. This asserts only that a version is pinned at all - it must not
    // block the upgrade the moment a real tag ships.
    expect(WORKFLOW_SOURCES).toMatch(/pnpm\/action-setup@v\d+/);
  });
});

describe('§5 Dockerfile', () => {
  it('pins the same Node major as engines and CI', () => {
    expect(DOCKERFILE).toContain('FROM node:22-bookworm-slim');
    expect(PACKAGE_JSON.engines.node).toBe('>=22');
    expect(CI_RAW).toContain('node-version: 22');
  });

  it('pins pnpm to the version that produced the committed lockfile', () => {
    // ONE source of truth, and every consumer derives from it.
    //
    // The earlier version of this test asserted `CI_RAW` contained
    // 'version: 10.4.1' - a literal pnpm version pinned a second time, in the
    // workflow. That is precisely what pnpm/action-setup@v4 refuses: it aborts
    // with "Multiple versions of pnpm specified" when both its `version` input
    // and package.json's `packageManager` field are present, EVEN IF THEY
    // AGREE. So the old assertion did not protect the pin; it pinned the
    // failure in place. It is replaced by the guarantee it was reaching for.
    const pinned = PACKAGE_JSON.packageManager;
    expect(pinned).toMatch(/^pnpm@\d+\.\d+\.\d+/);

    const version = pinned.slice('pnpm@'.length).split('+')[0];
    expect(DOCKERFILE).toContain(`corepack prepare pnpm@${version}`);
  });

  it('never specifies a pnpm version twice, which pnpm/action-setup rejects', () => {
    // Reproduces the failure mode directly: for every workflow step that uses
    // pnpm/action-setup, assert it passes no `version` input. package.json's
    // `packageManager` field is the pin, and the action reads it itself.
    for (const [name, raw] of WORKFLOWS) {
      const parsed = parseYaml(raw) as {
        jobs?: Record<string, { steps?: { uses?: string; with?: Record<string, unknown> }[] }>;
      };
      for (const [jobName, job] of Object.entries(parsed.jobs ?? {})) {
        for (const step of job.steps ?? []) {
          if (!step.uses?.startsWith('pnpm/action-setup')) continue;
          expect(
            step.with?.version,
            `${name} job "${jobName}" pins a pnpm version in the workflow as well as in ` +
              `package.json's packageManager field. pnpm/action-setup fails the job with ` +
              `"Multiple versions of pnpm specified" when both are set, even when they match.`,
          ).toBeUndefined();
        }
      }
    }
  });

  it('still installs pnpm in every JOB that runs a pnpm command', () => {
    // The fix above removes an input, not the action. Guard against someone
    // "simplifying" further by deleting the setup step and leaving `pnpm
    // install` to fail on a runner that has no pnpm.
    //
    // Scoped per JOB, not per file. ci.yml has two jobs that each need their
    // own setup step - a file-level check would stay green after one of them
    // lost it, because the other job's step still matches.
    let jobsChecked = 0;
    for (const [name, raw] of WORKFLOWS) {
      const parsed = parseYaml(raw) as {
        jobs?: Record<string, { steps?: { uses?: string; run?: string }[] }>;
      };
      for (const [jobName, job] of Object.entries(parsed.jobs ?? {})) {
        const steps = job.steps ?? [];
        const runsPnpm = steps.some((step) => /(^|[\s&|;(])pnpm\s/.test(step.run ?? ''));
        if (!runsPnpm) continue;
        jobsChecked += 1;
        expect(
          steps.some((step) => step.uses?.startsWith('pnpm/action-setup')),
          `${name} job "${jobName}" runs a pnpm command but never sets pnpm up`,
        ).toBe(true);
      }
    }
    // The loop above is only meaningful if it found jobs. If a refactor moves
    // the pnpm commands somewhere this cannot see, fail rather than pass empty.
    expect(jobsChecked).toBeGreaterThanOrEqual(3);
  });

  it('installs from the lockfile, so a build is reproducible', () => {
    expect(DOCKERFILE).toContain('pnpm install --frozen-lockfile');
  });

  it('ships node_modules, because esbuild bundles with --packages=external', () => {
    expect(PACKAGE_JSON.scripts.build).toContain('--packages=external');
    expect(DOCKERFILE).toContain('/app/node_modules ./node_modules');
    expect(DOCKERFILE).toContain('pnpm prune --prod');
  });

  it('ships the migrations, so a release can apply them', () => {
    expect(DOCKERFILE).toContain('/app/drizzle ./drizzle');
    expect(DOCKERFILE).toContain('drizzle.config.ts');
  });

  it('does not run as root', () => {
    expect(DOCKERFILE).toContain('USER node');
    expect(DOCKERFILE).toContain('--chown=node:node');
  });

  it('sets NODE_ENV=production, which every fail-closed behaviour keys off', () => {
    // Slice 1 pinned the Secure cookie, trust proxy and deterministic port
    // binding to this; Slice 4 pinned HSTS and the strict CSP to it too.
    expect(DOCKERFILE).toContain('ENV NODE_ENV=production');
  });

  it('health-checks liveness, not readiness — a database outage must not restart the app', () => {
    const healthcheck = DOCKERFILE.slice(DOCKERFILE.indexOf('HEALTHCHECK'));
    expect(healthcheck).toContain('/healthz');
    expect(healthcheck).not.toContain('/readyz');
    const composeCheck = JSON.stringify(COMPOSE.services.app.healthcheck);
    expect(composeCheck).toContain('/healthz');
    expect(composeCheck).not.toContain('/readyz');
  });

  it('the app is not exposed directly to the internet by the compose file', () => {
    expect(COMPOSE.services.app.ports).toEqual(['127.0.0.1:3000:3000']);
  });

  it('bounds the log volume, since production writes a JSON line per request', () => {
    expect(COMPOSE.services.app.logging.options['max-size']).toBeTruthy();
  });
});

// ── §6 The smoke test is worth running ─────────────────────────────────────

describe('§6 smoke test', () => {
  it('checks both liveness and readiness, and distinguishes them', () => {
    expect(SMOKE).toContain('/healthz');
    expect(SMOKE).toContain('/readyz');
    expect(SMOKE).toContain("body.checks?.database === true");
  });

  it('verifies the deployed page is the built artefact, not a placeholder', () => {
    expect(SMOKE).toContain("html.includes('<div id=\"root\">')");
    expect(SMOKE).toContain("!html.includes('%VITE_')");
    expect(SMOKE).toContain('!html.includes(\'id="manus-runtime"\')');
  });

  it('verifies the security headers survived the deployment', () => {
    expect(SMOKE).toContain('content-security-policy');
    expect(SMOKE).toContain('strict-transport-security');
    expect(SMOKE).toContain('x-powered-by');
  });

  it('verifies protected surfaces are still refusing anonymous callers', () => {
    expect(SMOKE).toContain('billing.mySubscription');
    expect(SMOKE).toContain('/manus-storage/');
  });

  it('is read-only — a smoke test that writes to production is one nobody dares run', () => {
    const code = SMOKE.split('\n').filter(line => !line.trim().startsWith('*') && !line.trim().startsWith('//')).join('\n');
    expect(code).not.toContain("method: 'POST'");
    expect(code).not.toContain('signIn');
  });

  it('exits non-zero on failure, which is what drives the rollback step', () => {
    expect(SMOKE).toContain('process.exit(failures === 0 ? 0 : 1)');
  });

  it('bounds every request, so a hung deployment fails the deploy instead of hanging it', () => {
    expect(SMOKE).toContain('TIMEOUT_MS');
    expect(SMOKE).toContain('AbortController');
  });
});

// ── §7 The scripts the workflows call actually exist ───────────────────────

describe('§7 referenced scripts exist and are executable', () => {
  const workflows = ['ci.yml', 'deploy-staging.yml', 'deploy-production.yml']
    .map(name => read(`../.github/workflows/${name}`)).join('\n');

  it('REGRESSION: every ./*.sh the workflows invoke is present in deploy/', () => {
    // The production workflow called ./backup-before-release.sh, which existed
    // nowhere in the repository. The release would have failed at the step
    // immediately before migrations - the worst possible moment to discover it.
    const referenced = Array.from(new Set(workflows.match(/\.\/[a-z0-9-]+\.sh/g) ?? []));
    expect(referenced.length).toBeGreaterThan(0);
    for (const script of referenced) {
      const name = script.replace('./', '');
      expect(() => read(`../deploy/${name}`), `${name} is referenced but missing`).not.toThrow();
    }
  });

  it('the backup verifies its own output rather than trusting the exit code', () => {
    const backup = read('../deploy/backup-before-release.sh');
    expect(backup).toContain('gzip -t');            // not corrupt
    expect(backup).toContain('Dump completed');     // not truncated
    expect(backup).toContain('CREATE TABLE');       // not empty
  });

  it('a restore counterpart exists — a backup nobody can restore is a rumour', () => {
    const restore = read('../deploy/restore-backup.sh');
    expect(restore).toContain('RESTORE_TARGET_DB');   // rehearsable against scratch
    expect(restore).toContain('RESTORE_ASSUME_YES');  // destructive, so confirmed
  });

  it('the restore checks the archive BEFORE dropping anything', () => {
    const restore = read('../deploy/restore-backup.sh');
    const verifyAt = restore.indexOf('gzip -t');
    const dropAt = restore.indexOf('DROP DATABASE');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(dropAt).toBeGreaterThan(verifyAt);
  });

  it('both use a PINNED client image, not whatever the host has installed', () => {
    // A host carrying MariaDB's client cannot dump a MySQL 8 server: it rejects
    // --set-gtid-purged and --ssl-mode outright.
    for (const name of ['backup-before-release.sh', 'restore-backup.sh']) {
      expect(read(`../deploy/${name}`), name).toContain('MYSQL_CLIENT_IMAGE');
    }
  });

  it('the backup does not require a privilege a managed database withholds', () => {
    // Without --no-tablespaces, mysqldump fails on PROCESS, which the
    // application user on a managed instance does not have.
    expect(read('../deploy/backup-before-release.sh')).toContain('--no-tablespaces');
  });

  it('TLS is required by default on both, and overridable only for a drill', () => {
    for (const name of ['backup-before-release.sh', 'restore-backup.sh']) {
      expect(read(`../deploy/${name}`), name).toContain('${DB_SSL_MODE:-REQUIRED}');
    }
  });
});

// ── §8 The runtime image can actually start ────────────────────────────────

describe('§8 defects only a real pruned container reveals', () => {
  const packageJson = JSON.parse(read('../package.json'));
  const dockerfile = read('../Dockerfile');

  it('the Dockerfile drops devDependencies, so anything the deploy runs must not be one', () => {
    expect(dockerfile).toContain('pnpm prune --prod');
  });

  it('REGRESSION: drizzle-kit is a RUNTIME dependency', () => {
    // Both deploy workflows run `npx drizzle-kit migrate` inside the runtime
    // image. As a devDependency it was pruned out, so npx tried to DOWNLOAD it
    // at deploy time - which fails without internet, and otherwise applies
    // migrations to a production database using an unpinned version that may
    // not be the one that generated them.
    expect(packageJson.dependencies).toHaveProperty('drizzle-kit');
    expect(packageJson.devDependencies ?? {}).not.toHaveProperty('drizzle-kit');
  });

  it('every tool the deploy workflows invoke inside the image is a runtime dependency', () => {
    const workflows = ['deploy-staging.yml', 'deploy-production.yml']
      .map(name => read(`../.github/workflows/${name}`)).join('\n');
    for (const [, tool] of workflows.matchAll(/npx ([a-z0-9-]+)/g)) {
      expect(packageJson.dependencies, `${tool} is run inside the image`).toHaveProperty(tool);
    }
  });

  it('REGRESSION: vite is never resolved at startup', () => {
    // `import ... from "vite"` at the top of vite.ts survived esbuild's
    // --packages=external into dist/index.js, so Node resolved it the instant
    // the process started - in production too, where prune has removed it. The
    // container crashed with ERR_MODULE_NOT_FOUND before binding a port, and
    // it was invisible from the host because node_modules there still has vite.
    const source = read('./_core/vite.ts');
    expect(source).not.toMatch(/^import .*from "vite";/m);
    expect(source).toContain('await import("vite")');
  });

  it('the server bundle does not import the vite config either', () => {
    // Importing it made esbuild inline vite.config.ts, whose own top-level
    // `import { defineConfig } from "vite"` reappeared as a static import and
    // reintroduced the identical crash.
    const source = read('./_core/vite.ts');
    expect(source).not.toContain('from "../../vite.config"');
    expect(source).not.toContain('await import("../../vite.config")');
    expect(source).toContain('configFile: path.resolve');
  });

  it('serveStatic stays reachable in production', () => {
    // It lives in the same module; only setupVite is deferred.
    expect(read('./_core/index.ts')).toContain('serveStatic(app)');
  });
});
