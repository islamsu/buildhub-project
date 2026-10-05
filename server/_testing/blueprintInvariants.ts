/**
 * ── THE RENDER BLUEPRINT INVARIANTS, AS DATA ────────────────────────────
 *
 * One list, imported by two suites, so the mutation proof exercises the
 * SAME predicates the guard runs rather than a restatement of them. A
 * mutation test that re-implements what it is testing proves only that two
 * copies agree.
 *
 * brandGuards.test.ts turns each entry into an `it()`.
 * blueprintGuardMutation.test.ts edits one field of the Blueprint at a time
 * and requires that at least one entry rejects every edit.
 *
 * ── WHY THESE ARE STRUCTURAL AND NOT SUBSTRING MATCHES ──────────────────
 *
 * The assertions these replaced read:
 *
 *   expect(yaml).toContain('name: buildhub-staging');
 *   expect(yaml).toContain('name: buildhub-staging-mysql');
 *
 * The first could never fail while the second passed, because
 * "name: buildhub-staging" is a substring of "name: buildhub-staging-mysql".
 * The check that was supposed to pin the web service was satisfied by the
 * line below it, and a complete web-service rename left every assertion
 * green. Comparing parsed fields removes the whole class of mistake: a
 * renamed service reads as a changed value, not as an absent line.
 */
import { expect } from 'vitest';
import { parse as parseYaml } from 'yaml';

export type BlueprintEnvVar = {
  key: string;
  value?: unknown;
  sync?: boolean;
  generateValue?: boolean;
  fromService?: { type: string; name: string; envVarKey: string };
};

export type BlueprintService = {
  type: string;
  name: string;
  branch?: string;
  healthCheckPath?: string;
  preDeployCommand?: string;
  disk?: { name: string; mountPath: string; sizeGB: number };
  envVars?: BlueprintEnvVar[];
};

export type Blueprint = { services: BlueprintService[] };

export const parseBlueprint = (yamlText: string): Blueprint =>
  parseYaml(yamlText) as Blueprint;

/**
 * Exactly one service of a type, asserted rather than assumed. `find` would
 * silently take the first of two, and "Render created a SECOND web service
 * because the Blueprint still named the old one" is precisely the failure the
 * dashboard-first rename sequence exists to avoid. A duplicate has to be red.
 */
function service(blueprint: Blueprint, type: string): BlueprintService {
  const matches = blueprint.services.filter(s => s.type === type);
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

const literal = (svc: BlueprintService, key: string): unknown =>
  svc.envVars?.find(v => v.key === key)?.value;

export type BlueprintInvariant = {
  name: string;
  check: (blueprint: Blueprint) => void;
};

export const BLUEPRINT_INVARIANTS: readonly BlueprintInvariant[] = [
  {
    name: 'the web service is the rebranded rakiza-staging, and is stateless',
    /*
     * The owner-approved rename, and the reason it was approvable: this
     * service holds NO DISK. Everything it has is an environment variable or
     * a built image, so renaming it destroys no data. The disk assertion sits
     * next to the name because it is the justification for it - if a disk is
     * ever attached here, the rename stops being safe and this must fail.
     */
    check: bp => {
      const web = service(bp, 'web');
      expect(web.name).toBe('rakiza-staging');
      expect(web.disk).toBeUndefined();
    },
  },
  {
    name: 'APP_BASE_URL points at the web service by its CURRENT name',
    /*
     * A `fromService` reference resolves BY NAME. Renaming the service and
     * leaving this behind makes the Blueprint reference a service that does
     * not exist - and APP_BASE_URL is what the sitemap, canonical URLs and
     * password-reset links are built from, so it surfaces as missing SEO and
     * broken email rather than as anything that mentions a rename.
     */
    check: bp => {
      const web = service(bp, 'web');
      expect(web.envVars?.find(v => v.key === 'APP_BASE_URL')?.fromService).toEqual({
        type: 'web',
        name: web.name,
        envVarKey: 'RENDER_EXTERNAL_URL',
      });
    },
  },
  {
    name: 'the database service keeps its name AND its disk, because the name is the disk',
    /*
     * Render matches Blueprint services by name, so this name is not a label -
     * it is a handle on `mysql-data`. Change it and Render does not rename
     * anything: it provisions a new private service with a new empty disk and
     * the staging database is gone.
     */
    check: bp => {
      const mysql = service(bp, 'pserv');
      expect(mysql.name).toBe('buildhub-staging-mysql');
      expect(mysql.disk).toEqual({ name: 'mysql-data', mountPath: '/var/lib/mysql', sizeGB: 10 });
    },
  },
  {
    name: 'the database name and user are unchanged',
    /*
     * A schema and a grant, both stored INSIDE that volume rather than in the
     * Blueprint. One layer below the service name, same consequence.
     */
    check: bp => {
      const mysql = service(bp, 'pserv');
      expect(literal(mysql, 'MYSQL_DATABASE')).toBe('buildhub');
      expect(literal(mysql, 'MYSQL_USER')).toBe('buildhub');
    },
  },
  {
    name: 'VITE_APP_ID is unchanged, because it is a session claim and not a service name',
    /*
     * server/_core/sdk.ts stamps `appId: ENV.appId` into every session JWT and
     * rejects a token whose appId differs from the configured value. Rebranding
     * this to match the service name signs out every staging user, and the
     * symptom - "I was logged out but signing in still works" - names nothing
     * that leads anyone back to a rename.
     */
    check: bp => {
      expect(literal(service(bp, 'web'), 'VITE_APP_ID')).toBe('buildhub-staging');
    },
  },
  {
    name: 'staging still announces itself as staging',
    /*
     * NODE_ENV is a build mode and every deployed environment sets it to
     * production, so APP_ENV is the only thing standing between /version and
     * STAGING ANNOUNCING ITSELF AS PRODUCTION. It lives in the same file and
     * dies to the same careless edit, so it is pinned here.
     */
    check: bp => {
      const web = service(bp, 'web');
      expect(literal(web, 'APP_ENV')).toBe('staging');
      expect(literal(web, 'NODE_ENV')).toBe('production');
    },
  },
];
