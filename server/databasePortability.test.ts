import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { parseProductReference } from '@shared/rfqAttachments';

/**
 * Database portability — MariaDB 10.11 and MySQL 8.
 *
 * BuildHub has only ever run on MariaDB. Managed database offerings are
 * generally MySQL 8, and the two disagree in one way that actually reaches
 * product behaviour: MariaDB's JSON is an alias for LONGTEXT, so the driver
 * returns a STRING, while MySQL 8's is a native type and the driver returns a
 * parsed OBJECT.
 *
 * Verified empirically against both engines rather than reasoned about:
 *
 *   MariaDB 10.11.14   typeof productReference === 'string'
 *   MySQL   8.0.46     typeof productReference === 'object'
 *
 * The old normaliser lived in the client and required an object, so the
 * marketplace-to-RFQ product handoff was DEAD on MariaDB and would have
 * started working by itself on a MySQL 8 staging database. Behaviour that
 * changes with the storage engine is worse than behaviour that is simply
 * broken, because nothing in the code says it might.
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

// ── §1 The parser is engine-independent ────────────────────────────────────

describe('§1 parseProductReference accepts both engines', () => {
  const reference = { productId: 7, variantId: 'v-red', variantLabel: 'Red 60x60' };

  it('parses the OBJECT MySQL 8 returns', () => {
    expect(parseProductReference(reference)).toEqual(reference);
  });

  it('parses the STRING MariaDB returns', () => {
    expect(parseProductReference(JSON.stringify(reference))).toEqual(reference);
  });

  it('REGRESSION: the exact MariaDB payload no longer yields null', () => {
    // Captured verbatim from a live MariaDB 10.11 round-trip.
    const fromMariaDb = '{"productId":7,"variantId":"v-red","variantLabel":"Red 60x60"}';
    expect(parseProductReference(fromMariaDb)).toEqual(reference);
  });

  it('both engine shapes produce IDENTICAL output', () => {
    expect(parseProductReference(reference)).toEqual(parseProductReference(JSON.stringify(reference)));
  });
});

// ── §2 It refuses everything else ──────────────────────────────────────────

describe('§2 rejection', () => {
  it('returns null for null, undefined and empty input', () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(parseProductReference(value)).toBeNull();
    }
  });

  it('returns null rather than throwing on malformed JSON', () => {
    expect(parseProductReference('{not json')).toBeNull();
    expect(parseProductReference('[[[')).toBeNull();
  });

  it('rejects an array — a JSON column can hold one, and it is not a reference', () => {
    expect(parseProductReference([1, 2, 3])).toBeNull();
    expect(parseProductReference('[1,2,3]')).toBeNull();
  });

  it('rejects a partial reference in either shape', () => {
    const partial = { productId: 7, variantId: 'v-red' };
    expect(parseProductReference(partial)).toBeNull();
    expect(parseProductReference(JSON.stringify(partial))).toBeNull();
  });

  it('rejects wrong types, including a numeric id sent as a string', () => {
    expect(parseProductReference({ productId: '7', variantId: 'v', variantLabel: 'L' })).toBeNull();
    expect(parseProductReference({ productId: 7, variantId: 1, variantLabel: 'L' })).toBeNull();
  });

  it('rejects empty strings in the identifying fields', () => {
    expect(parseProductReference({ productId: 7, variantId: '', variantLabel: 'L' })).toBeNull();
    expect(parseProductReference({ productId: 7, variantId: 'v', variantLabel: '' })).toBeNull();
  });

  it('rejects a non-finite product id', () => {
    expect(parseProductReference({ productId: NaN, variantId: 'v', variantLabel: 'L' })).toBeNull();
    expect(parseProductReference({ productId: Infinity, variantId: 'v', variantLabel: 'L' })).toBeNull();
  });

  it('rejects a JSON scalar, which both engines will happily store', () => {
    for (const value of ['"just a string"', '42', 'true', 'null']) {
      expect(parseProductReference(value)).toBeNull();
    }
  });
});

// ── §3 One definition, used everywhere ─────────────────────────────────────

describe('§3 no second copy of this logic', () => {
  it('the client uses the shared parser and keeps no local normaliser', () => {
    const page = read('../client/src/pages/RFQPage.tsx');
    expect(page).toContain('parseProductReference');
    expect(page).not.toContain('function normalizeProductReference');
  });

  it('the parser lives in shared/, reachable from both server and client', () => {
    const shared = read('../shared/rfqAttachments.ts');
    expect(shared).toContain('export function parseProductReference');
  });

  it('the shared module documents the engine difference it exists to absorb', () => {
    const shared = read('../shared/rfqAttachments.ts');
    expect(shared).toContain('MariaDB');
    expect(shared).toContain('MySQL 8');
  });
});

// ── §4 Database transport security ─────────────────────────────────────────

describe('§4 the connection is not silently unencrypted', () => {
  const db = read('./db.ts');

  it('TLS options are resolved rather than left to whatever the URL happens to say', () => {
    expect(db).toContain('function resolveSslOptions');
    expect(db).toContain('DATABASE_SSL');
  });

  it('PRODUCTION DEFAULTS TO require — a plain connection must be asked for', () => {
    expect(db).toContain('ENV.isProduction ? "require" : "disable"');
  });

  it('certificate verification is never disabled', () => {
    expect(db).toContain('rejectUnauthorized: true');
    expect(db).not.toContain('rejectUnauthorized: false');
  });

  it('a provider CA bundle can be supplied inline or by path', () => {
    expect(db).toContain('DATABASE_CA_CERT');
    expect(db).toContain('BEGIN CERTIFICATE');
    expect(db).toContain('readFileSync');
  });

  it('both new variables are documented in .env.example', () => {
    const env = read('../.env.example');
    expect(env).toContain('DATABASE_SSL');
    expect(env).toContain('DATABASE_CA_CERT');
  });
});
