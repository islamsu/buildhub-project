// ── The data-quality screen must never be able to say "fine" by accident ───
//
// The whole value of Part 49 is that an operator can trust a zero. Two ways to
// destroy that, and both are tested here:
//
//   A CHECK THAT THREW REPORTING ZERO. A broken query and a clean platform
//   would then be the same pixel. `count: null` is asserted, not hoped for.
//
//   A CHECK THAT COUNTS THE QA FIXTURES. `includeDummy` defaults to false and
//   every check carries the clause; a check that forgets it turns a seeded
//   verification database into a wall of false alarms, and the operator learns
//   to ignore the screen - which is the same outcome as not having it.
//
// Plus the boundary that makes this readable by a USER_ADMIN at all: the
// response carries record IDS and counts. No email address, no phone number,
// no price, no title.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { DATA_QUALITY_CHECK_KEYS, notDummy, runDataQualityChecks, SAMPLE_LIMIT } from './admin/dataQuality';

const SOURCE = readSourceForAssertions(readFileSync(new URL('./admin/dataQuality.ts', import.meta.url), 'utf8'));

/**
 * The LITERAL text of every sql`…` template in the file, with `${…}`
 * interpolations removed and nested templates handled.
 *
 * Written as a scanner rather than a regex because the interesting template
 * here contains `${includeDummy ? sql`` : sql`…`}` - one template inside
 * another inside an interpolation - and every regex that looks like it works
 * on that actually stops at the first inner backtick.
 */
function literalSqlTemplates(source: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < source.length; i += 1) {
    if (!source.startsWith('sql`', i)) continue;
    let depth = 0;
    let literal = '';
    let j = i + 4;
    while (j < source.length) {
      if (source.startsWith('${', j)) { depth += 1; j += 2; continue; }
      if (depth > 0) {
        if (source[j] === '{') depth += 1;
        else if (source[j] === '}') depth -= 1;
        j += 1;
        continue;
      }
      if (source[j] === '`') break;
      literal += source[j];
      j += 1;
    }
    found.push(literal);
    i = j;
  }
  return found;
}

/** A database that returns a fixed count and a fixed id list to every query. */
function stubDb(count: number, ids: number[]) {
  return {
    execute: (statement: unknown) => {
      const text = JSON.stringify(statement ?? '');
      // The count query is the one wrapped in `count(*)`. Everything else is a
      // row query.
      return Promise.resolve([text.includes('count(*)') ? [{ c: count }] : ids.map(id => ({ id })), []]);
    },
  };
}

describe('the checks that exist', () => {
  it('covers the questions Part 49 is actually about', () => {
    expect(DATA_QUALITY_CHECK_KEYS).toEqual([
      'approved_provider_missing_required_document',
      'rfq_open_past_deadline',
      'quotation_pending_on_settled_rfq',
      'notification_link_target_missing',
      'history_subject_missing',
      'duplicate_account_email',
      'duplicate_account_phone',
      'active_product_without_price',
      'active_product_of_frozen_supplier',
    ]);
  });

  it('every key is unique - a duplicate would silently overwrite a row in the UI', () => {
    expect(new Set(DATA_QUALITY_CHECK_KEYS).size).toBe(DATA_QUALITY_CHECK_KEYS.length);
  });
});

describe('a check that could not run is NOT reported as zero', () => {
  it('a throwing query yields null, not 0', async () => {
    const exploding = { execute: () => Promise.reject(new Error('table is gone')) };
    const results = await runDataQualityChecks(exploding as never, false);
    expect(results).toHaveLength(DATA_QUALITY_CHECK_KEYS.length);
    for (const result of results) {
      expect(result.count, result.key).toBeNull();
      expect(result.sampleIds, result.key).toEqual([]);
    }
  });

  it('one broken check does not take the other eight down with it', async () => {
    let calls = 0;
    const flaky = {
      execute: (statement: unknown) => {
        calls += 1;
        if (calls <= 2) return Promise.reject(new Error('first check is broken'));
        const text = JSON.stringify(statement ?? '');
        return Promise.resolve([text.includes('count(*)') ? [{ c: 3 }] : [{ id: 9 }], []]);
      },
    };
    const results = await runDataQualityChecks(flaky as never, false);
    expect(results[0].count).toBeNull();
    expect(results.filter(result => result.count !== null).length).toBeGreaterThan(0);
  });

  it('a count is a number even when the driver hands back a string', async () => {
    // MySQL drivers return COUNT(*) as a string often enough that this is not
    // hypothetical, and "12" > 0 is true while "0" > 0 is false - so a string
    // that slipped through would render correctly and sort wrongly.
    const stringy = {
      execute: (statement: unknown) => {
        const text = JSON.stringify(statement ?? '');
        return Promise.resolve([text.includes('count(*)') ? [{ c: '7' }] : [{ id: '4' }], []]);
      },
    };
    const results = await runDataQualityChecks(stringy as never, false);
    const sql = results.find(result => result.key === 'rfq_open_past_deadline')!;
    expect(sql.count).toBe(7);
    expect(typeof sql.count).toBe('number');
    expect(sql.sampleIds).toEqual([4]);
  });
});

describe('the count and the sample describe the same population', () => {
  it('both wrap the identical fragment', () => {
    // A panel that computes "340 found" with one query and "showing 20" with
    // another, differently-written one is the standard way this goes wrong.
    expect(SOURCE).toContain('select count(*) as c from (${rows}) as q');
    expect(SOURCE).toContain('select id from (${rows}) as q order by id desc limit ${SAMPLE_LIMIT}');
  });

  it('the sample is bounded', () => {
    expect(SAMPLE_LIMIT).toBeGreaterThan(0);
    expect(SAMPLE_LIMIT).toBeLessThanOrEqual(50);
  });

  it('reports the full count alongside a truncated sample', async () => {
    const results = await runDataQualityChecks(stubDb(500, [3, 2, 1]) as never, false);
    const check = results.find(result => result.key === 'rfq_open_past_deadline')!;
    expect(check.count).toBe(500);
    expect(check.sampleIds).toEqual([3, 2, 1]);
  });
});

describe('seeded QA data is excluded unless it is asked for', () => {
  it('every SQL check carries the dummy clause', () => {
    // Counted rather than merely "present somewhere": eight of the nine checks
    // are SQL, and one forgetting the clause is exactly the drift that makes a
    // verification database look broken.
    const clauses = (SOURCE.match(/notDummy\('/g) ?? []).length;
    expect(clauses).toBeGreaterThanOrEqual(9);
    // The history check joins the owner nullably, so it spells the clause out.
    expect(SOURCE).toContain('u.id is null or u.isDummy = 0');
  });

  it('the clause it emits really excludes them - checked on the SQL, not the prose', () => {
    // A text assertion here SURVIVED a mutation that gutted notDummy, because
    // the same string shape appears in the history check's own inline ternary
    // and the match landed there. So this reads the emitted fragment instead.
    const excluding = JSON.stringify(notDummy('u', false).queryChunks);
    const including = JSON.stringify(notDummy('u', true).queryChunks);
    expect(excluding).toContain('isDummy = 0');
    expect(excluding).toContain('"u"');
    expect(including).toBe('[]');
  });

  it('the exclusion is the DEFAULT, at the check and at the router', () => {
    const routers = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));
    expect(routers).toContain('includeDummy: z.boolean().default(false)');
    expect(routers).toContain("runDataQualityChecks(db, input?.includeDummy ?? false)");
  });

  it('the provider check filters dummies too, not only the SQL ones', () => {
    const start = SOURCE.indexOf('const approvedProviderMissingDocument');
    const block = SOURCE.slice(start, SOURCE.indexOf('function sqlCheck', start));
    expect(block).toContain("notDummy('u', includeDummy)");
    // POSITIVE CONTROL: the slice is the right block.
    expect(block).toContain('getComplianceRequirements');
  });
});

describe('the response carries ids, never field values', () => {
  it('no check selects a business column into the payload', () => {
    // Every fragment selects exactly one thing, aliased `id`. A check that
    // selected `u.email as id` would satisfy the shape and defeat the point,
    // so the aliases are pinned individually.
    const selects = SOURCE.match(/select\s+\w+\.id as id/g) ?? [];
    expect(selects.length).toBeGreaterThanOrEqual(7);
    expect(SOURCE).not.toMatch(/\.email as id/);
    expect(SOURCE).not.toMatch(/\.phone as id/);
    expect(SOURCE).not.toMatch(/\.price as id/);
  });

  it('the duplicate checks group on the value and return only the ids', () => {
    // The whole risk of a duplicate-email check is that it names the emails.
    expect(SOURCE).toContain('group by lower(trim(email))');
    expect(SOURCE).toContain('group by trim(phone)');
    const results = SOURCE.slice(SOURCE.indexOf("duplicate_account_email"), SOURCE.indexOf('active_product_without_price'));
    expect(results).not.toMatch(/as email\b/);
  });

  it('the check result type has no field for a value', async () => {
    const [first] = await runDataQualityChecks(stubDb(1, [5]) as never, false);
    expect(Object.keys(first).sort()).toEqual(['count', 'key', 'sampleIds', 'severity', 'subject']);
  });
});

describe('the query survives the shapes MySQL actually has', () => {
  it('no SQL template contains a literal question mark - mysql2 eats it as a placeholder', () => {
    // This is not stylistic. A `?` inside a regex string reaches mysql2 as a
    // bind placeholder, the real parameters shift by one, and `limit ?` at the
    // end of the wrapping query becomes a syntax error. It happened.
    //
    // Only the LITERAL text of each template matters: `${...}` interpolations
    // are bound values or nested fragments, and one of them is a TypeScript
    // ternary that legitimately contains a question mark.
    // The scan has to be depth-aware. A lazy /sql`[\s\S]*?`/ stops at the
    // FIRST backtick, which inside `${includeDummy ? sql`` : …}` is the nested
    // template - so it returns a truncated string ending mid-ternary and
    // reports a question mark that is TypeScript, not SQL. Instrument first,
    // assertion second.
    const templates = literalSqlTemplates(SOURCE);
    expect(templates.length, 'no sql templates found - the scan is wrong').toBeGreaterThanOrEqual(8);
    for (const template of templates) {
      expect(template, `a literal ? in: ${template.slice(0, 70)}`).not.toContain('?');
    }
    // POSITIVE CONTROL: the scanner really did read the SQL, not empty strings.
    expect(templates.join('\n')).toContain('from fieldValueHistory h');
    expect(templates.join('\n')).toContain('from registrationDocuments d');
  });

  it('the deep-link check anchors every pattern', () => {
    // Unanchored, `/rfq/12?tab=bids` would cast to a wrong id and report a
    // dangling link that is not dangling.
    expect(SOURCE).toContain("'^/rfq/[0-9]+$'");
    expect(SOURCE).toContain("'^/quotations/[0-9]+$'");
    expect(SOURCE).toContain("'^/marketplace/products/[0-9]+$'");
    expect(SOURCE).toContain("rlike '^[0-9]+$'");
  });
});

describe('the router wiring', () => {
  const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));

  it('is audit.read, the permission that already governs platform-wide reads', () => {
    expect(ROUTERS).toContain("dataQuality: adminWith('audit.read')");
  });

  it('is not reachable by a non-administrator', () => {
    const start = ROUTERS.indexOf('  dataQuality: adminWith');
    const block = ROUTERS.slice(start, ROUTERS.indexOf('operationalHealth:', start));
    expect(block).not.toMatch(/protectedProcedure|publicProcedure/);
  });
});
