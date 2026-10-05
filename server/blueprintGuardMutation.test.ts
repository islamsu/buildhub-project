/**
 * ── THE MUTATION PROOF FOR THE BLUEPRINT GUARD ──────────────────────────
 *
 * The assertions this replaces were VACUOUS and nobody noticed for the life
 * of the file. They read:
 *
 *   expect(yaml).toContain('name: buildhub-staging');
 *   expect(yaml).toContain('name: buildhub-staging-mysql');
 *
 * and the first could not fail while the second passed, because
 * "name: buildhub-staging" is a substring of "name: buildhub-staging-mysql".
 * A complete rename of the web service - the declaration AND the
 * `fromService` self-reference - left every deployment assertion green.
 *
 * So this file exists to stop a guard being trusted on the strength of
 * reading well. It takes the REAL render.yaml, edits exactly one protected
 * field at a time, and requires that at least one real invariant rejects the
 * result. It imports the same BLUEPRINT_INVARIANTS the guard runs, so there
 * is no second implementation that could agree with the first while both are
 * wrong.
 *
 * A green result here means: no protected field can be changed in the
 * Blueprint without a test going red.
 *
 * NOTHING IS WRITTEN TO DISK. render.yaml is read once and mutated in memory.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLUEPRINT_INVARIANTS, parseBlueprint } from './_testing/blueprintInvariants';

const RAW = readFileSync(join(import.meta.dirname, '..', 'render.yaml'), 'utf8');

/**
 * Run every invariant and collect which ones rejected. Each `check` throws on
 * failure, which is what vitest's `expect` does outside an `it()` as much as
 * inside one, so a throw IS the rejection signal.
 */
function rejections(yamlText: string): string[] {
  const failed: string[] = [];
  let blueprint: ReturnType<typeof parseBlueprint>;
  try {
    blueprint = parseBlueprint(yamlText);
  } catch {
    /* An unparseable Blueprint is rejected by every invariant, trivially. */
    return BLUEPRINT_INVARIANTS.map(i => i.name);
  }
  for (const invariant of BLUEPRINT_INVARIANTS) {
    try {
      invariant.check(blueprint);
    } catch {
      failed.push(invariant.name);
    }
  }
  return failed;
}

/**
 * Each mutation is ONE edit a careless rebrand or a copy-paste would plausibly
 * make. `replace` is deliberately first-occurrence-only except where noted, so
 * each case is a single field rather than a sweep.
 */
const MUTATIONS: { what: string; apply: (y: string) => string }[] = [
  {
    /*
     * THE DISCRIMINATING MUTANT, and the one this file was written for.
     *
     * Every other rename mutant below changes the service name OR the
     * `fromService` reference, so the name/reference equality invariant
     * catches it even if the web name itself is never pinned. This one
     * changes BOTH, consistently - which is exactly the edit the old
     * substring assertion could not see, and exactly what a careless
     * find-and-replace rebrand would do.
     *
     * It is here because its absence was a real hole: with it missing, the
     * suite stayed green when the vacuous `toContain('name: buildhub-staging')`
     * check was restored in place of the structural one. A mutation suite that
     * cannot tell a working guard from the broken guard it replaced is not a
     * proof of anything. Verified by re-running that experiment with this
     * case present: the suite now goes red.
     */
    what: 'the web service AND its fromService reference are renamed together',
    apply: y => y.split('name: rakiza-staging\n').join('name: buildhub-staging\n'),
  },
  {
    what: 'the web service is renamed back to the old brand',
    apply: y => y.replace('    name: rakiza-staging\n', '    name: buildhub-staging\n'),
  },
  {
    what: 'the web service is renamed to something else entirely',
    apply: y => y.replace('    name: rakiza-staging\n', '    name: rakiza-web\n'),
  },
  {
    what: 'the fromService self-reference is left pointing at the old name',
    apply: y => y.replace('          name: rakiza-staging\n', '          name: buildhub-staging\n'),
  },
  {
    what: 'APP_BASE_URL is pointed at the database service',
    apply: y => y.replace('          name: rakiza-staging\n', '          name: buildhub-staging-mysql\n'),
  },
  {
    what: 'APP_BASE_URL reads the wrong Render variable',
    apply: y => y.replace('envVarKey: RENDER_EXTERNAL_URL', 'envVarKey: RENDER_SERVICE_NAME'),
  },
  {
    what: 'the DATABASE service is rebranded along with the web service',
    apply: y => y.replace('    name: buildhub-staging-mysql\n', '    name: rakiza-staging-mysql\n'),
  },
  {
    what: 'the disk is renamed',
    apply: y => y.replace('      name: mysql-data\n', '      name: rakiza-data\n'),
  },
  {
    what: 'the disk mount path moves',
    apply: y => y.replace('mountPath: /var/lib/mysql', 'mountPath: /var/lib/rakiza'),
  },
  {
    what: 'the disk is resized',
    apply: y => y.replace('sizeGB: 10', 'sizeGB: 20'),
  },
  {
    what: 'the disk is removed from the database service',
    apply: y => y.replace(
      '    disk:\n      name: mysql-data\n      mountPath: /var/lib/mysql\n      sizeGB: 10\n',
      '',
    ),
  },
  {
    what: 'a disk is attached to the WEB service, which is what makes a rename unsafe',
    apply: y => y.replace(
      '    name: rakiza-staging\n',
      '    name: rakiza-staging\n    disk:\n      name: web-data\n      mountPath: /data\n      sizeGB: 1\n',
    ),
  },
  {
    what: 'MYSQL_DATABASE is rebranded',
    apply: y => y.replace('      - key: MYSQL_DATABASE\n        value: buildhub\n', '      - key: MYSQL_DATABASE\n        value: rakiza\n'),
  },
  {
    what: 'MYSQL_USER is rebranded',
    apply: y => y.replace('      - key: MYSQL_USER\n        value: buildhub\n', '      - key: MYSQL_USER\n        value: rakiza\n'),
  },
  {
    what: 'VITE_APP_ID is rebranded, which would sign out every staging user',
    apply: y => y.replace('      - key: VITE_APP_ID\n        value: buildhub-staging\n', '      - key: VITE_APP_ID\n        value: rakiza-staging\n'),
  },
  {
    what: 'APP_ENV is dropped, so /version would report staging as production',
    apply: y => y.replace('      - key: APP_ENV\n        value: staging\n', ''),
  },
  {
    what: 'APP_ENV says production',
    apply: y => y.replace('      - key: APP_ENV\n        value: staging\n', '      - key: APP_ENV\n        value: production\n'),
  },
  {
    what: 'a SECOND web service is added, the exact hazard the rename sequence avoids',
    apply: y => y.replace(
      'services:\n',
      'services:\n  - type: web\n    name: buildhub-staging\n    runtime: docker\n    dockerfilePath: ./Dockerfile\n',
    ),
  },
  {
    what: 'a SECOND private service is added',
    apply: y => y.replace(
      'services:\n',
      'services:\n  - type: pserv\n    name: buildhub-staging-mysql\n    runtime: image\n',
    ),
  },
];

describe('the Blueprint guard is not vacuous', () => {
  it('the real render.yaml satisfies every invariant', () => {
    /*
     * THE CONTROL. Without it, a guard that rejected everything would score a
     * perfect mutation result and be worthless - every mutant "caught", the
     * real file caught too.
     */
    expect(rejections(RAW)).toEqual([]);
  });

  it.each(MUTATIONS)('rejects: $what', ({ apply }) => {
    const mutant = apply(RAW);
    /*
     * The mutation has to have LANDED. A `replace` whose needle has drifted
     * returns the input unchanged, and an unchanged input then "passes" the
     * invariants - which would read as an uncaught mutant and send the next
     * reader hunting for a hole in the guard that is really a typo here.
     */
    expect(mutant).not.toBe(RAW);
    expect(rejections(mutant).length).toBeGreaterThan(0);
  });

  it('covers every invariant - no check is unexercised by the mutation set', () => {
    /*
     * The other half of the proof. "Every mutant is caught" says nothing
     * about an invariant no mutant ever reaches: that one could be vacuous
     * exactly as the substring assertions were, and this file would still be
     * green. So each invariant must be the sole or joint reason some mutant
     * was rejected.
     */
    const exercised = new Set<string>();
    for (const { apply } of MUTATIONS) {
      for (const name of rejections(apply(RAW))) exercised.add(name);
    }
    expect([...BLUEPRINT_INVARIANTS].map(i => i.name).filter(n => !exercised.has(n))).toEqual([]);
  });
});
