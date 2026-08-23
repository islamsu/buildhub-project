import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

/**
 * How migrations reach the database.
 *
 * Staging was migrated by a person typing `drizzle-kit migrate` into a Render
 * shell. That worked, but it is not a deploy process - it is an undocumented
 * ritual, and the failure mode is silent: skip it under pressure and the app
 * serves against a schema it does not match.
 *
 * The fix is Render's preDeployCommand, which runs once per deploy rather than
 * once per instance and halts the deploy on failure with the old version still
 * serving. These tests pin the properties that make that choice correct, and
 * the anti-patterns that would quietly undo it.
 */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const RENDER_RAW = read('../render.yaml');
const RENDER = parseYaml(RENDER_RAW) as {
  services: { type: string; name: string; plan?: string; preDeployCommand?: string }[];
};
const DOCKERFILE = read('../Dockerfile');
const PACKAGE_JSON = JSON.parse(read('../package.json'));
const web = () => RENDER.services.find((s) => s.type === 'web')!;

describe('migrations run as a release step, not at container start', () => {
  it('the web service declares a preDeployCommand that applies migrations', () => {
    expect(web().preDeployCommand).toBeTruthy();
    expect(web().preDeployCommand).toContain('drizzle-kit migrate');
  });

  it('applies migrations only - never generates them at deploy time', () => {
    // `db:push` is `drizzle-kit generate && drizzle-kit migrate`. Generating
    // from the live schema during a deploy can author a migration nobody
    // reviewed, and drizzle will happily emit a DROP COLUMN.
    const cmd = web().preDeployCommand ?? '';
    expect(cmd).not.toContain('generate');
    expect(cmd).not.toContain('push');
  });

  it('does NOT put migrations in the container start command', () => {
    // Every instance runs the start command, so this races on any scale-out,
    // re-runs on every crash-loop restart, and destroys the old version before
    // discovering the migration is broken.
    const cmd = DOCKERFILE.split('\n').find((l) => l.startsWith('CMD')) ?? '';
    expect(cmd).toBe('CMD ["node", "dist/index.js"]');
    expect(cmd).not.toContain('drizzle');
    expect(cmd).not.toContain('migrate');
  });

  it('ships everything the pre-deploy step needs inside the image', () => {
    // preDeployCommand runs in the built image. If drizzle-kit were a
    // devDependency, `pnpm prune --prod` would delete it and the deploy would
    // fail on every release.
    expect(PACKAGE_JSON.dependencies['drizzle-kit']).toBeTruthy();
    expect(PACKAGE_JSON.devDependencies?.['drizzle-kit']).toBeUndefined();
    expect(DOCKERFILE).toContain('/app/node_modules ./node_modules');
    expect(DOCKERFILE).toContain('/app/drizzle ./drizzle');
    expect(DOCKERFILE).toContain('/app/drizzle.config.ts ./drizzle.config.ts');
  });

  it('runs on an instance type that supports preDeployCommand', () => {
    // Render only runs preDeployCommand on paid instance types. A silent
    // downgrade to a free plan would skip migrations entirely rather than
    // erroring, which is the worst possible failure shape.
    expect(web().plan).toBeTruthy();
    expect(web().plan).not.toBe('free');
  });

  it('records the constraints the mechanism does NOT solve', () => {
    // A future reader must not mistake "migrations are automated" for
    // "migrations are safe". Backward compatibility during a deploy is a
    // review rule that nothing enforces, and rollback does not undo DDL.
    expect(RENDER_RAW).toContain('BACKWARD COMPATIBLE');
    expect(RENDER_RAW).toContain('ROLLBACK DOES NOT UNDO A MIGRATION');
  });

  it('keeps the liveness probe on /healthz, not /readyz', () => {
    // Unchanged, and re-asserted here because preDeployCommand sits next to it:
    // pointing Render's health check at /readyz would restart the container
    // forever whenever the database is the thing that is down.
    expect(web()).toMatchObject({ healthCheckPath: '/healthz' });
  });
});
