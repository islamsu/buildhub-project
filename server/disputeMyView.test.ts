// ── THE DISPUTE LIST A USER SEES ────────────────────────────────────────────
//
// `disputes.myDisputes` had NO CLIENT CALLER and there was no `/disputes`
// route, so nothing had ever exercised it against a real screen. Two defects
// survived in it because of that: a silent `.limit(200)` with no count, and a
// subject label resolved one dispute at a time through `partiesForSubject`,
// which reads the subject AND its whole cast per row.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { listMyDisputes, subjectLabels } from './disputeMyView';

const ME = 7;
const OTHER = 8;

function columnsIn(condition: unknown): string[] {
  const names: string[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.name === 'string' && node.table) names.push(node.name);
    for (const key of ['queryChunks', 'chunks']) if (Array.isArray(node[key])) node[key].forEach(walk);
    if (Array.isArray(node)) node.forEach(walk);
  };
  walk(condition);
  return names;
}

/**
 * The literals a condition compares against - and ONLY those.
 *
 * The first version also swept up drizzle's own SQL fragments (" or ", "="),
 * so `toEqual([ME, ME])` failed against a correct condition. A parameter is a
 * node carrying an encoder; an `inArray` carries its list under the same node,
 * which is flattened here so a status set reads as its values.
 */
function valuesIn(condition: unknown): unknown[] {
  const values: unknown[] = [];
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if ('value' in node && node.encoder) {
      if (Array.isArray(node.value)) values.push(...node.value); else values.push(node.value);
    }
    for (const key of ['queryChunks', 'chunks']) if (Array.isArray(node[key])) node[key].forEach(walk);
    if (Array.isArray(node)) node.forEach(walk);
  };
  walk(condition);
  return values;
}

/** Keyed by TABLE, so two reads of different tables cannot share an assertion. */
function fakeDb(rows: Record<string, any[]>) {
  const asked: Array<{ table: string; columns: string[]; limit?: number; offset?: number }> = [];
  const nameOf = (table: any) => String(table?.[Symbol.for('drizzle:Name')] ?? table?._?.name ?? 'unknown');
  const db: any = {
    select: (projection?: Record<string, unknown>) => {
      const counting = Object.keys(projection ?? {}).includes('count');
      const entry = { table: 'unknown', columns: [] as string[] } as any;
      let data: any[] = [];
      const chain: any = {
        from: (table: any) => {
          entry.table = counting ? `${nameOf(table)}:count` : nameOf(table);
          data = rows[entry.table] ?? [];
          asked.push(entry);
          return chain;
        },
        where: (condition: unknown) => { entry.columns = columnsIn(condition); entry.condition = condition; return chain; },
        orderBy: () => chain,
        limit: (value: number) => { entry.limit = value; return chain; },
        offset: (value: number) => { entry.offset = value; return chain; },
        then: (resolve: any, reject: any) => Promise.resolve(data).then(resolve, reject),
      };
      return chain;
    },
  };
  return { db, asked };
}

const dispute = (over: Record<string, unknown> = {}) => ({
  id: 1, reference: 'DSP-2026-000001', title: 'Late delivery',
  status: 'open', priority: 'medium', category: 'delivery',
  subjectType: 'project', subjectId: 10,
  reporterId: ME, respondentId: OTHER, createdAt: new Date(), ...over,
});

describe('the labels for a whole page of disputes', () => {
  it('reads each subject type ONCE, not once per dispute', async () => {
    const { db, asked } = fakeDb({
      projects: [{ id: 10, title: 'Villa slab' }, { id: 11, title: 'Roof' }],
    });
    const labels = await subjectLabels(db, [
      { subjectType: 'project', subjectId: 10 },
      { subjectType: 'project', subjectId: 11 },
      { subjectType: 'project', subjectId: 10 },
    ]);
    expect(labels.get('project:10')).toBe('Villa slab');
    expect(labels.get('project:11')).toBe('Roof');
    // ONE query for three rows. The procedure this replaces issued at least one
    // per dispute, each reading the subject's whole cast as well.
    expect(asked.filter(entry => entry.table === 'projects')).toHaveLength(1);
  });

  it('does not query a subject type no dispute on the page uses', async () => {
    const { db, asked } = fakeDb({ projects: [{ id: 10, title: 'Villa slab' }] });
    await subjectLabels(db, [{ subjectType: 'project', subjectId: 10 }]);
    expect(asked.map(entry => entry.table)).toEqual(['projects']);
  });

  /*
   * A quotation has no title of its own - it is a bid ON an RFQ - so it is
   * labelled by the RFQ it answers. Labelling it "quotation 30" would be the
   * id problem with extra steps.
   */
  it('labels a quotation by the request it answers', async () => {
    const { db } = fakeDb({
      quotations: [{ id: 30, rfqId: 20 }],
      rfqs: [{ id: 20, title: 'Roof waterproofing' }],
    });
    const labels = await subjectLabels(db, [{ subjectType: 'quotation', subjectId: 30 }]);
    // THE SAME SENTENCE the administrator's screen shows. Written once, in
    // server/disputeEligibility.ts - a live probe caught these two wording the
    // same record differently.
    expect(labels.get('quotation:30')).toBe('Quotation #30 on Roof waterproofing');
  });

  /*
   * A pre-0046 row had nothing to backfill a subject from. NO LABEL is the
   * honest answer; "project 0" would be a relationship the record does not
   * contain.
   */
  /*
   * AND ONE WRITER FOR IT. Behaviour above proves the sentence is right in this
   * service; only the source can say the OTHER service is not writing its own.
   * That divergence is exactly what a live probe found - the user's list and
   * the administrator's screen naming one quotation two different ways.
   */
  it('both dispute screens get that sentence from the same function', () => {
    const eligibility = readFileSync(new URL('./disputeEligibility.ts', import.meta.url), 'utf8');
    const mine = readFileSync(new URL('./disputeMyView.ts', import.meta.url), 'utf8');
    expect(eligibility).toContain('export function quotationSubjectLabel(');
    expect(eligibility).toContain('label: quotationSubjectLabel(');
    expect(mine).toContain('quotationSubjectLabel(Number(bid.id)');
    // Neither may hand-roll it beside the shared one.
    expect(mine).not.toContain('`Quotation on ');
    expect((eligibility.match(/`Quotation #/g) ?? []).length).toBe(1);
  });

  it('invents nothing for a row with no subject', async () => {
    const { db, asked } = fakeDb({});
    const labels = await subjectLabels(db, [
      { subjectType: 'project', subjectId: 0 },
      { subjectType: 'project', subjectId: null },
    ]);
    expect(labels.size).toBe(0);
    expect(asked).toHaveLength(0);
  });

  it('ignores a subject type outside the closed set', async () => {
    const { db, asked } = fakeDb({});
    await subjectLabels(db, [{ subjectType: 'invoice', subjectId: 5 } as any]);
    expect(asked).toHaveLength(0);
  });
});

describe('one page of my own disputes', () => {
  it('is scoped to BOTH sides - raised by me, and naming me', async () => {
    const { db, asked } = fakeDb({ 'disputes:count': [{ count: 1 }], disputes: [dispute()], projects: [] });
    await listMyDisputes(db, ME, { page: 0, pageSize: 20 });
    const listed = asked.find(entry => entry.table === 'disputes')!;
    expect(listed.columns).toEqual(expect.arrayContaining(['reporterId', 'respondentId']));
    expect(valuesIn(listed.condition)).toEqual([ME, ME]);
  });

  it('pages, and reports a real total rather than truncating in silence', async () => {
    const { db, asked } = fakeDb({ 'disputes:count': [{ count: 57 }], disputes: [dispute()], projects: [] });
    const page = await listMyDisputes(db, ME, { page: 2, pageSize: 20 });
    expect(page).toMatchObject({ total: 57, page: 2, pageSize: 20 });
    const listed = asked.find(entry => entry.table === 'disputes')!;
    expect(listed).toMatchObject({ limit: 20, offset: 40 });
  });

  it('counts under the same scope it lists', async () => {
    const { db, asked } = fakeDb({ 'disputes:count': [{ count: 1 }], disputes: [dispute()], projects: [] });
    await listMyDisputes(db, ME, { page: 0, pageSize: 20, status: 'open' });
    const counted = asked.find(entry => entry.table === 'disputes:count')!;
    const listed = asked.find(entry => entry.table === 'disputes')!;
    expect(counted.columns.sort()).toEqual(listed.columns.sort());
    expect(counted.columns).toContain('status');
  });

  it('the open filter names only the live statuses', async () => {
    const { db, asked } = fakeDb({ 'disputes:count': [{ count: 1 }], disputes: [dispute()], projects: [] });
    await listMyDisputes(db, ME, { page: 0, pageSize: 20, status: 'open' });
    const values = valuesIn(asked.find(entry => entry.table === 'disputes')!.condition);
    expect(values).toEqual(expect.arrayContaining(['open', 'investigating']));
    expect(values).not.toContain('resolved');
  });

  it('the closed filter names the concluded ones, withdrawn included', async () => {
    const { db, asked } = fakeDb({ 'disputes:count': [{ count: 1 }], disputes: [dispute()], projects: [] });
    await listMyDisputes(db, ME, { page: 0, pageSize: 20, status: 'closed' });
    const values = valuesIn(asked.find(entry => entry.table === 'disputes')!.condition);
    expect(values).toEqual(expect.arrayContaining(['resolved', 'rejected', 'withdrawn']));
    expect(values).not.toContain('open');
  });

  it('an unrecognised status filter shows everything rather than nothing', async () => {
    const { db, asked } = fakeDb({ 'disputes:count': [{ count: 1 }], disputes: [dispute()], projects: [] });
    await listMyDisputes(db, ME, { page: 0, pageSize: 20, status: 'urgent' });
    expect(asked.find(entry => entry.table === 'disputes')!.columns).not.toContain('status');
  });

  /*
   * WHICH SIDE YOU ARE ON, without a second query. "A dispute" with no
   * indication of whether you raised it or it names you is the difference
   * between a note and something you have to answer.
   */
  it('says which side of each dispute the reader is on', async () => {
    const { db } = fakeDb({
      'disputes:count': [{ count: 2 }],
      disputes: [dispute({ id: 1, reporterId: ME, respondentId: OTHER }),
        dispute({ id: 2, reporterId: OTHER, respondentId: ME })],
      projects: [{ id: 10, title: 'Villa slab' }],
    });
    const page = await listMyDisputes(db, ME, { page: 0, pageSize: 20 });
    expect(page.rows.map((row: any) => row.yourSide)).toEqual(['reporter', 'respondent']);
  });

  it('carries the subject in words', async () => {
    const { db } = fakeDb({
      'disputes:count': [{ count: 1 }], disputes: [dispute()],
      projects: [{ id: 10, title: 'Villa slab' }],
    });
    const page = await listMyDisputes(db, ME, { page: 0, pageSize: 20 });
    expect(page.rows[0].subjectLabel).toBe('Villa slab');
  });

  it('says null rather than guessing when the subject has no title', async () => {
    const { db } = fakeDb({ 'disputes:count': [{ count: 1 }], disputes: [dispute()], projects: [] });
    const page = await listMyDisputes(db, ME, { page: 0, pageSize: 20 });
    expect(page.rows[0].subjectLabel).toBeNull();
  });
});

/**
 * ── WHAT BEHAVIOUR CANNOT SEE ──────────────────────────────────────────────
 *
 * That the procedure reaches this service, that the routes exist, and that the
 * menu names them. A page nobody can navigate to is not in the product, which
 * is what `/disputes` NOT EXISTING meant for every dispute ever raised.
 */
describe('the surface is reachable', () => {
  const CLIENT = new URL('../client/src/', import.meta.url);
  const routers = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('App.tsx', CLIENT), 'utf8');
  const layout = readFileSync(new URL('components/DashboardLayout.tsx', CLIENT), 'utf8');

  it('the procedure pages through the service and no longer caps at 200', () => {
    expect(routers).toContain('listMyDisputes(db, ctx.user.id, input)');
    expect(routers).not.toContain('.orderBy(desc(disputes.createdAt))\n      .limit(200);');
  });

  it('both routes exist, so a dispute notification lands somewhere', () => {
    expect(app).toContain('path={"/disputes/:id"}');
    expect(app).toContain('path={"/disputes"}');
  });

  /*
   * EVERY ROLE, because every role can be NAMED in a dispute. A menu that
   * offered it only to the roles that tend to raise one would leave the
   * respondent - the person with something to answer - without a way in.
   */
  it('every role menu names it, because every role can be named in one', () => {
    const menus = layout.split(/^const (?:HOMEOWNER_MENU_KEYS|ROLE_MENU_KEYS)/m);
    const body = menus.slice(1).join('');
    const roles = ['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager'];
    // One DISPUTES_MENU_ITEM per role menu, plus the homeowner list above.
    expect((body.match(/DISPUTES_MENU_ITEM,/g) ?? []).length).toBe(roles.length);
    expect(layout).toContain("path: '/disputes'");
  });

  it('a dispute can be raised about all three subjects, from one dialog', () => {
    const dialog = readFileSync(new URL('components/OpenDisputeDialog.tsx', CLIENT), 'utf8');
    // The respondent comes from the subject's real cast, never free-typed.
    expect(dialog).toContain('trpc.disputes.subjectParties.useQuery');
    expect(dialog).not.toContain('respondentId: Number(typed');
    for (const [page, subject] of [
      ['pages/ProjectDetail.tsx', 'project'],
      ['pages/RFQDetail.tsx', 'rfq'],
      ['pages/QuotationDetail.tsx', 'quotation'],
    ] as const) {
      const text = readFileSync(new URL(page, CLIENT), 'utf8');
      expect(text, `${page} does not offer a dispute`).toContain(`subjectType="${subject}"`);
    }
  });

  /*
   * ProjectDetail had its OWN dispute form - the only one there was - with a
   * free-text "type" box, no category and no respondent. It must not survive
   * beside the shared dialog: two forms writing the same table is how they
   * drift apart.
   */
  it('and the old project-only form is gone rather than left beside it', () => {
    const project = readFileSync(new URL('pages/ProjectDetail.tsx', CLIENT), 'utf8');
    expect(project).not.toContain('trpc.disputes.create.useMutation');
    expect(project).not.toContain('data-testid="dispute-type"');
  });
});

/**
 * The label dictionaries must cover the closed sets, or a value added to
 * shared/disputes.ts renders as its own raw enum name on three screens.
 */
describe('the dispute vocabulary is translated in both languages', async () => {
  const { DISPUTE_VOCABULARIES, disputeLabels } = await import('../client/src/lib/disputeCopy');

  for (const [kind, values] of Object.entries(DISPUTE_VOCABULARIES)) {
    it(`covers every ${kind} value in English and Arabic`, () => {
      for (const value of values as readonly string[]) {
        const en = (disputeLabels(false) as any)[kind](value);
        const ar = (disputeLabels(true) as any)[kind](value);
        expect(en, `${kind}.${value} has no English label`).not.toBe(value);
        expect(ar, `${kind}.${value} has no Arabic label`).not.toBe(value);
        expect(ar).not.toBe(en);
      }
    });
  }

  it('and an unknown value renders as itself rather than as a blank', () => {
    expect(disputeLabels(false).status('something-new')).toBe('something-new');
  });
});
