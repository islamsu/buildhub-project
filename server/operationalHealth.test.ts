// ── The screen that would be easiest to lie on (Part 50) ───────────────────
//
// SMTP and object storage are genuinely unset on this project's staging
// environment. That is a recorded, accepted, BLOCKED-BY-INFRASTRUCTURE state -
// and an operational dashboard showing them green would convert it into a
// false assurance in one glance, which is the single most damaging thing this
// feature could do.
//
// So the tests below are about what the payload may and may not contain:
//
//   A DEPENDENCY IS A BOOLEAN. Not a host, not a bucket, not a region, not a
//   key, not a URL, not a driver error. Asserted against a payload produced
//   with real-looking secrets in the environment, because "we do not select it"
//   is a claim and "it is not in these bytes" is evidence.
//
//   AN UNANSWERABLE QUESTION IS NULL. An unreachable database yields no counts
//   rather than zeroes, and an unrecorded migration state yields null rather
//   than "behind" - a wrong alarm sends an operator to run a migration that is
//   already applied.
//
//   WHAT IS NOT MEASURED IS NAMED. Uptime, error rate, latency, throughput and
//   queue depth are not persisted anywhere in BuildHub, and the screen says so
//   instead of showing a plausible number.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  NOT_MEASURED, readExpectedMigrationCount, readOperationalHealth,
} from './admin/operationalHealth';

const SOURCE = readSourceForAssertions(readFileSync(new URL('./admin/operationalHealth.ts', import.meta.url), 'utf8'));

/** A database that answers every query with one row of the given shape. */
function stubDb(row: Record<string, unknown>, options: { migrationsTable?: boolean } = {}) {
  return {
    execute: (statement: unknown) => {
      const text = JSON.stringify(statement ?? '');
      if (text.includes('information_schema')) {
        return Promise.resolve([[{ c: options.migrationsTable === false ? 0 : 1 }], []]);
      }
      if (text.includes('__drizzle_migrations')) return Promise.resolve([[{ c: 27 }], []]);
      return Promise.resolve([[row], []]);
    },
  };
}

const COUNTS = {
  users_: 10, rfqs_: 4, quotations_: 3, products_: 2, projects_: 1,
  unreadNotifications: 9, openDisputes: 1, complianceQueue: 2, pendingQuotations: 3, frozenAccounts: 0,
};

describe('a dependency is reported as a boolean and nothing else', () => {
  const REAL_LOOKING_SECRETS = {
    SMTP_HOST: 'smtp.sendgrid.example',
    SMTP_USER: 'apikey',
    SMTP_PASSWORD: 'SG.a-real-looking-secret-value',
    SMTP_FROM: 'noreply@buildhub.example',
    S3_BUCKET: 'buildhub-prod-documents',
    S3_ENDPOINT: 'https://ewr1.vultrobjects.example',
    S3_ACCESS_KEY_ID: 'AKIAEXAMPLEKEYID',
    S3_SECRET_ACCESS_KEY: 'a-real-looking-s3-secret',
    OPENAI_API_KEY: 'sk-a-real-looking-openai-key',
    DATABASE_URL: 'mysql://buildhub:hunter2@db.internal.example:3306/buildhub',
  };
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [key, value] of Object.entries(REAL_LOOKING_SECRETS)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    vi.resetModules();
  });
  afterEach(() => {
    for (const key of Object.keys(REAL_LOOKING_SECRETS)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('not one configured value appears anywhere in the payload', async () => {
    const payload = JSON.stringify(await readOperationalHealth(stubDb(COUNTS) as never));
    for (const [key, value] of Object.entries(REAL_LOOKING_SECRETS)) {
      expect(payload, `${key} leaked into the operational health payload`).not.toContain(value);
    }
    // POSITIVE CONTROL: the payload is a real payload, not an empty object -
    // otherwise every assertion above passes vacuously.
    expect(payload).toContain('"dependencies"');
    expect(payload).toContain('"notMeasured"');
  });

  it('nor does a host name, a bucket or a key fragment', async () => {
    const payload = JSON.stringify(await readOperationalHealth(stubDb(COUNTS) as never));
    for (const fragment of ['sendgrid', 'vultrobjects', 'AKIA', 'sk-', 'hunter2', 'db.internal']) {
      expect(payload, `"${fragment}" must not appear`).not.toContain(fragment);
    }
  });

  it('every dependency entry is exactly key, configured, affects', async () => {
    const health = await readOperationalHealth(stubDb(COUNTS) as never);
    expect(health.dependencies.map(dependency => dependency.key).sort())
      .toEqual(['ai', 'objectStorage', 'smtp']);
    for (const dependency of health.dependencies) {
      expect(Object.keys(dependency).sort()).toEqual(['affects', 'configured', 'key']);
      expect(typeof dependency.configured, dependency.key).toBe('boolean');
    }
  });
});

describe('an unanswerable question is null, never a comfortable default', () => {
  it('an unreachable database yields no counts rather than zeroes', async () => {
    const dead = { execute: () => Promise.reject(new Error('connection refused')) };
    const health = await readOperationalHealth(dead as never);
    expect(health.database.reachable).toBe(false);
    expect(health.database.probeMs).toBeNull();
    // Empty, NOT {users: 0, ...}. "The platform is empty" and "we could not
    // ask" are different statements and an operator acts differently on each.
    expect(health.volumes).toEqual({});
    expect(health.backlogs).toEqual({});
  });

  it('an absent migrations table is "not recorded", not "behind"', async () => {
    const health = await readOperationalHealth(stubDb(COUNTS, { migrationsTable: false }) as never);
    expect(health.migrations.recorded).toBeNull();
    expect(health.migrations.atHead).toBeNull();
    expect(health.migrations.atHead).not.toBe(false);
  });

  it('a recorded migration count is compared against the journal', async () => {
    const health = await readOperationalHealth(stubDb(COUNTS) as never);
    expect(health.migrations.recorded).toBe(27);
    expect(health.migrations.expected).toBe(readExpectedMigrationCount());
    expect(health.migrations.atHead).toBe(health.migrations.recorded >= (health.migrations.expected ?? Infinity));
  });

  it('atHead is never defaulted to true when the expectation is unknown', () => {
    // The direction matters: defaulting to true hides a half-migrated database.
    expect(SOURCE).toContain('expected === null ? null : recorded >= expected');
  });

  it('the journal count is read from the repository, and is a real number', () => {
    const expected = readExpectedMigrationCount();
    expect(expected).not.toBeNull();
    expect(expected).toBeGreaterThan(20);
  });
});

describe('the build identity comes from one place', () => {
  it('reuses buildCommit rather than reading the environment again', () => {
    // A second copy of this logic is how a console and a deployment gate come
    // to disagree about which commit is running.
    expect(SOURCE).toContain("import { buildCommit } from '../_core/health'");
    expect(SOURCE).toContain('commit: buildCommit()');
    expect(SOURCE).not.toContain('RENDER_GIT_COMMIT');
  });

  it('reports the commit the version endpoint reports', async () => {
    const { buildCommit } = await import('./_core/health');
    const health = await readOperationalHealth(stubDb(COUNTS) as never);
    expect(health.commit).toBe(buildCommit());
  });
});

describe('what is not measured is named on the screen', () => {
  it('lists the metrics BuildHub does not persist', () => {
    expect([...NOT_MEASURED].sort()).toEqual([
      'background_queue_depth', 'request_error_rate', 'request_latency', 'throughput', 'uptime',
    ]);
  });

  it('and hands them to the client rather than dropping them', async () => {
    const health = await readOperationalHealth(stubDb(COUNTS) as never);
    expect(health.notMeasured).toEqual([...NOT_MEASURED]);
  });

  it('no invented metric is computed anywhere in the module', () => {
    for (const invented of ['uptimePercent', 'errorRate', 'availability', 'healthScore', 'Math.random']) {
      expect(SOURCE, `${invented} must not exist here`).not.toContain(invented);
    }
  });
});

describe('the counts are real rows', () => {
  it('reads volumes and backlogs from COUNT(*), in one round trip', async () => {
    const health = await readOperationalHealth(stubDb(COUNTS) as never);
    expect(health.volumes).toEqual({ users: 10, rfqs: 4, quotations: 3, products: 2, projects: 1 });
    expect(health.backlogs).toEqual({
      unreadNotifications: 9, openDisputes: 1, complianceQueue: 2, pendingQuotations: 3, frozenAccounts: 0,
    });
  });

  it('coerces a driver that returns counts as strings', async () => {
    const stringy = Object.fromEntries(Object.entries(COUNTS).map(([key, value]) => [key, String(value)]));
    const health = await readOperationalHealth(stubDb(stringy) as never);
    expect(health.volumes.users).toBe(10);
    expect(typeof health.volumes.users).toBe('number');
  });

  it('the probe is bounded, like the readiness probe it mirrors', () => {
    expect(SOURCE).toContain('DB_PROBE_TIMEOUT_MS');
    expect(SOURCE).toContain('database probe timed out');
  });

  it('a driver error is logged for the operator and not returned to the browser', () => {
    // Driver errors carry the host and sometimes the credentials.
    expect(SOURCE).toContain("console.error('[operationalHealth] database probe failed:'");
    expect(SOURCE).not.toMatch(/reachable:\s*false,\s*error/);
  });
});

describe('the router wiring', () => {
  const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));

  it('is audit.read and nothing weaker', () => {
    expect(ROUTERS).toContain("operationalHealth: adminWith('audit.read')");
  });

  it('takes no input at all - there is nothing here for a client to steer', () => {
    // Sliced to the next procedure, not to a fixed character count: a fixed
    // window ran into startVendorTrial's own `.input(` and failed on a
    // neighbour's code.
    const start = ROUTERS.indexOf('  operationalHealth: adminWith');
    expect(start, 'operationalHealth not found').toBeGreaterThan(-1);
    const block = ROUTERS.slice(start, ROUTERS.indexOf('\n  startVendorTrial:', start));
    expect(block.length, 'the slice is empty - the extraction is wrong').toBeGreaterThan(80);
    expect(block).not.toContain('.input(');
    expect(block).toContain('readOperationalHealth(db)');
  });
});
