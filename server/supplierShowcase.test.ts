/**
 * ── SUPPLIER SHOWCASE: THE FENCE IS THE FEATURE ─────────────────────────
 *
 * CLAUDE.md §18 keeps three kinds of emphasis apart. A Showcase is the one
 * the SUPPLIER controls, and the dangerous thing about it is exactly that.
 *
 * THE FAILURE THIS FILE EXISTS TO PREVENT: if a supplier's own selection
 * could influence marketplace discovery, category ranking or search order,
 * they would have granted themselves a placement - Sponsored inventory with
 * no admin decision, no period, no revocation and no label. BuildHub could
 * no longer answer "why is this supplier above that one", and the ordering
 * rule §18 states (FEATURED -> labelled SPONSORED -> ORGANIC) would have a
 * fourth, invisible competitor in it.
 *
 * So the assertions here are mostly NEGATIVE, and the strongest of them is
 * that no shared-surface reader imports this module at all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_SHOWCASE_ITEMS, SHOWCASE_ITEM_KINDS, isShowcaseItemKind,
  normaliseShowcase, showcaseKindLabel,
} from '../shared/supplierShowcase';
import { readSourceForAssertions } from './_testing/sourceText';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');
const src = (relative: string) => readSourceForAssertions(read(relative));

const SHOWCASE = src('server/supplierShowcase.ts');
const ROUTERS = src('server/routers.ts');
const MANAGER = src('client/src/components/ShowcaseManager.tsx');
const STRIP = src('client/src/components/ShowcaseStrip.tsx');

describe('a showcase never leaves the storefront it belongs to', () => {
  it('NO SHARED-SURFACE READER IMPORTS IT', () => {
    /*
     * The strongest form of this rule: not "the marketplace filters it out"
     * but "the marketplace has never heard of it". A module that is not
     * imported cannot leak through a forgotten WHERE clause.
     */
    const sharedSurfaces = [
      'server/vendorDirectory.ts',
      'server/vendorSponsorship.ts',
      'server/placementBooking.ts',
      'server/productLifecycle.ts',
    ];
    for (const file of sharedSurfaces) {
      expect(src(file), `${file} reads the supplier's own showcase`)
        .not.toContain('supplierShowcase');
    }
  });

  it('and no client discovery surface renders it', () => {
    // The storefront is the only page that may. A showcase strip on the
    // marketplace grid or the directory would be self-granted placement
    // rendered as though BuildHub had chosen it.
    for (const file of [
      'client/src/pages/Marketplace.tsx',
      'client/src/pages/MarketplaceHub.tsx',
      'client/src/pages/VendorsDirectory.tsx',
    ]) {
      expect(src(file), `${file} renders a supplier's own showcase on a shared surface`)
        .not.toContain('ShowcaseStrip');
    }
    expect(src('client/src/pages/VendorProfile.tsx')).toContain('<ShowcaseStrip userId={userId} />');
  });

  it('the table carries no field a shared list could rank by', () => {
    // `vendorSponsorships` has priority, package, surface, startsAt, endsAt -
    // every one a lever on a shared surface. The showcase table has a
    // position that is meaningful only WITHIN one supplier's own six.
    const schema = src('drizzle/schema.ts');
    const start = schema.indexOf("export const supplierShowcase = mysqlTable(");
    const end = schema.indexOf('}));', start);
    expect(start, 'the showcase table moved').toBeGreaterThan(-1);
    const table = schema.slice(start, end);
    for (const lever of ['priority', 'surface', 'package', 'startsAt', 'endsAt', 'grantedBy']) {
      expect(table, `supplierShowcase carries a placement lever: ${lever}`).not.toContain(lever);
    }
    expect(table).toContain('position');
  });

  it('and it is NOT stored in the table the placement engine reads', () => {
    // §11 says reuse a canonical system; it does not say put unlike things in
    // one table because the columns nearly fit. A showcase row inside
    // vendorSponsorships would be one missing WHERE clause from becoming real
    // marketplace placement.
    expect(SHOWCASE, 'the showcase writes into the sponsorship store')
      .not.toContain('vendorSponsorships');
  });

  it('the supplier is told what this does NOT do', () => {
    // A supplier who believed this moved them up the marketplace would have
    // been misled about what they were buying with their attention.
    expect(MANAGER).toContain('data-testid="showcase-scope-note"');
    expect(MANAGER).toMatch(/does not change your position in the marketplace/i);
  });

  it('and a buyer is told whose choice it is', () => {
    // Supplier-selected emphasis, BuildHub editorial Featured and a paid
    // Sponsored slot carry completely different weight as evidence, and a
    // buyer who cannot tell them apart is being misled (§68).
    expect(STRIP).toContain('data-testid="showcase-provenance"');
    expect(STRIP).toMatch(/Selected by this supplier/);
    expect(STRIP).toMatch(/Not a BuildHub recommendation, and not a paid placement/);
  });
});

describe('you can only showcase what is yours, and what is published', () => {
  it('the writer takes its subject from the session, never from the payload', () => {
    const start = ROUTERS.indexOf('setShowcase: approvedProviderProcedure');
    const end = ROUTERS.indexOf('savedItems: protectedProcedure', start);
    expect(start).toBeGreaterThan(-1);
    const body = ROUTERS.slice(start, end);
    // An id in the input is the whole IDOR: it would let one supplier write
    // another's storefront.
    expect(body, 'setShowcase accepts a userId from the caller').not.toMatch(/userId:\s*z\./);
    expect(body).toContain('ctx.user.id');
  });

  it('ownership AND publication are checked in the same WHERE', () => {
    /*
     * SLICED TO `ownedVisibleIds`, WHICH IS THE WRITE GATE.
     *
     * This assertion was first written over the whole module, and it
     * SURVIVED the mutation it exists to catch: deleting
     * `eq(products.supplierId, userId)` from the write gate left all
     * assertions green, because the identical string still appeared in
     * `listShowcaseCandidates` further down the file. A guard satisfied by
     * a different function's code is not a guard - and the defect it was
     * hiding is one supplier showcasing another supplier's product.
     *
     * Split apart, ownership and publication also drift: one refactor later
     * "is it mine" is enforced and "can it be shown" is not, and a draft
     * product is emphasised on a public page where it 404s for every
     * visitor. Both must be in this one function.
     */
    const start = SHOWCASE.indexOf('async function ownedVisibleIds');
    const end = SHOWCASE.indexOf('export type ShowcaseWriteResult');
    expect(start, 'the write gate moved').toBeGreaterThan(-1);
    expect(end, 'the write gate moved').toBeGreaterThan(start);
    const gate = SHOWCASE.slice(start, end);
    expect(gate.length, 'the slice is empty, so every assertion below is vacuous')
      .toBeGreaterThan(200);

    expect(gate, 'a supplier can showcase another supplier\'s product')
      .toContain('eq(products.supplierId, userId)');
    expect(gate).toContain('publicProductFilter()');
    expect(gate, 'a provider can showcase another provider\'s service')
      .toContain('eq(serviceOfferings.providerId, userId)');
    expect(gate).toContain("eq(serviceOfferings.status, 'active')");
    expect(gate, 'a provider can showcase another provider\'s past work')
      .toContain('eq(portfolioItems.userId, userId)');

    // And every branch of the gate constrains the owner - not two of three.
    const ownerChecks = (gate.match(/eq\((products\.supplierId|serviceOfferings\.providerId|portfolioItems\.userId), userId\)/g) ?? []);
    expect(ownerChecks, 'one of the three kinds is not ownership-checked').toHaveLength(3);
  });

  it('the three tables name their owner differently, and each is used correctly', () => {
    // products.supplierId, serviceOfferings.providerId, portfolioItems.userId.
    // A single hand-written check gets this wrong once and never notices.
    const schema = read('drizzle/schema.ts');
    expect(schema).toContain("supplierId: int('supplierId')");
    expect(schema).toContain("providerId:  int('providerId')");
    expect(SHOWCASE).not.toContain('eq(products.providerId');
    expect(SHOWCASE).not.toContain('eq(serviceOfferings.userId');
  });

  it('the READER re-checks publication rather than trusting the write', () => {
    // A product archived after it was showcased must leave the storefront the
    // moment it is archived, without anything having to run.
    const start = SHOWCASE.indexOf('export async function listShowcase');
    const end = SHOWCASE.indexOf('export async function listShowcaseCandidates');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const reader = SHOWCASE.slice(start, end);
    expect(reader).toContain('publicProductFilter()');
    expect(reader).toContain('eq(products.supplierId, supplierId)');
  });

  it('the candidate list is computed by the SAME rule the writer applies', () => {
    // A form that offers something submitting will refuse fails on submit for
    // no visible reason.
    const start = SHOWCASE.indexOf('export async function listShowcaseCandidates');
    const candidates = SHOWCASE.slice(start);
    expect(candidates).toContain('publicProductFilter()');
    expect(candidates).toContain("eq(serviceOfferings.status, 'active')");
  });

  it('a refusal does not say WHICH condition failed', () => {
    /*
     * "not yours" and "not published" are both simply refused, so the
     * endpoint cannot be used to probe which product ids exist on the
     * platform. Asserted on the SHAPE of the answer rather than on the
     * comment explaining it: `refused` carries the entry and nothing else,
     * so there is no field a reason could travel in.
     */
    expect(SHOWCASE).toContain('refused: ShowcaseEntry[]');
    for (const leak of ['reason', 'notOwned', 'notPublished', 'exists']) {
      expect(SHOWCASE, `a refusal carries a ${leak}`)
        .not.toMatch(new RegExp(`refused[^\\n]*${leak}`, 'i'));
    }
  });
});

describe('the selection is bounded and de-duplicated before it is stored', () => {
  it('six, and the limit is the point', () => {
    expect(MAX_SHOWCASE_ITEMS).toBe(6);
    const many = Array.from({ length: 40 }, (_, index) => ({ kind: 'product', itemId: index + 1 }));
    expect(normaliseShowcase(many)).toHaveLength(MAX_SHOWCASE_ITEMS);
  });

  it('the same item twice is one slot, not two', () => {
    // With a cap of six, a duplicate silently costs a third of the showcase.
    const entries = [
      { kind: 'product', itemId: 5 },
      { kind: 'product', itemId: 5 },
      { kind: 'service', itemId: 5 },
    ];
    const out = normaliseShowcase(entries);
    expect(out).toHaveLength(2);
    // A product 5 and a service 5 are DIFFERENT things - the key is the pair.
    expect(out.map(entry => entry.kind).sort()).toEqual(['product', 'service']);
  });

  it('everything malformed is dropped rather than stored', () => {
    const hostile = [
      null, undefined, 'product', 42, [],
      { kind: 'product' }, { itemId: 3 },
      { kind: 'vendor', itemId: 3 },
      { kind: 'product', itemId: 0 },
      { kind: 'product', itemId: -1 },
      { kind: 'product', itemId: 1.5 },
      { kind: 'product', itemId: 'abc' },
      { kind: 'product', itemId: null },
    ];
    expect(normaliseShowcase(hostile)).toEqual([]);
  });

  it('and the order the supplier chose is the order that is stored', () => {
    // The per-kind grouping the ownership checks use is an implementation
    // detail and must not reorder the page.
    const entries = [
      { kind: 'portfolio', itemId: 9 },
      { kind: 'product', itemId: 3 },
      { kind: 'service', itemId: 7 },
    ];
    expect(normaliseShowcase(entries).map(entry => entry.kind))
      .toEqual(['portfolio', 'product', 'service']);
    expect(SHOWCASE, 'the writer stores its own grouping rather than the request order')
      .toContain('const stored = requested.filter');
  });

  it('the write is wholesale and transactional', () => {
    // The selection IS the state: positions are contiguous by construction
    // and no sequence of partial updates can leave a gap or a duplicate. A
    // failure leaves the old showcase rather than an empty page.
    expect(SHOWCASE).toContain('db.transaction');
    expect(SHOWCASE).toContain('tx.delete(supplierShowcase)');
  });
});

describe('it is presented as a product, not as a database', () => {
  it('every kind is said in both languages, never as a raw enum', () => {
    for (const kind of SHOWCASE_ITEM_KINDS) {
      for (const lang of ['en', 'ar'] as const) {
        const label = showcaseKindLabel(kind, lang);
        expect(label, `${kind}/${lang}`).not.toBe(kind);
        expect(label.length).toBeGreaterThan(0);
      }
      expect(showcaseKindLabel(kind, 'ar')).toMatch(/[؀-ۿ]/);
    }
  });

  it('the kind guard is closed', () => {
    expect(isShowcaseItemKind('product')).toBe(true);
    for (const value of ['vendor', 'PRODUCT', '', null, undefined, 3, {}]) {
      expect(isShowcaseItemKind(value), String(value)).toBe(false);
    }
  });

  it('an empty showcase renders nothing at all, rather than an empty heading', () => {
    // A "Highlights" heading over a blank row reads as a broken page rather
    // than as a supplier who has not curated yet.
    expect(STRIP).toContain('if (showcase.isError || cards.length === 0) return null;');
  });

  it('a failed read is not reported as "highlighted nothing"', () => {
    // ERROR != EMPTY (§10), applied to an optional strip: the honest move is
    // to render nothing rather than to assert an absence the query never
    // established.
    expect(STRIP).toMatch(/showcase\.isError/);
  });

  it('the owner is told what was dropped; the public is not', () => {
    // A storefront that quietly shortens teaches its owner nothing about why.
    // Telling a VISITOR would leak how much unpublished stock a supplier holds.
    expect(MANAGER).toContain('data-testid="showcase-unavailable"');
    expect(SHOWCASE).toContain('options.includeUnavailable ? unavailable : 0');
    const start = ROUTERS.indexOf('showcase: publicProcedure');
    const end = ROUTERS.indexOf('showcaseCandidates:', start);
    expect(ROUTERS.slice(start, end), 'the public read leaks the unavailable count')
      .not.toContain('includeUnavailable');
  });

  it('reordering is reachable from a keyboard', () => {
    // A drag-only reorder is unusable without a mouse (§62), and every
    // control names the item it moves.
    expect(MANAGER).toContain('data-testid={`showcase-up-${entry.kind}-${entry.itemId}`}');
    expect(MANAGER).toMatch(/aria-label=\{ar \? `حرّك/);
  });

  it('and the empty state says where to start rather than dead-ending', () => {
    expect(MANAGER).toContain('data-testid="showcase-manager-empty-cta"');
  });

  it('the cap is announced, not enforced silently', () => {
    // A checkbox that simply refuses to tick reads as a broken control.
    expect(MANAGER).toMatch(/You can highlight \$\{MAX_SHOWCASE_ITEMS\} items at most/);
  });

  it('and the save reports the SERVER answer, not the request', () => {
    // If an entry was refused between load and save, "saved" over a shorter
    // showcase is a lie the supplier discovers only by reloading.
    expect(MANAGER).toContain('result.refused.length');
    expect(MANAGER).toContain('result.stored.length');
  });
});

describe('the capability is reachable', () => {
  it('the editor is mounted where the sibling managers already live', () => {
    // A capability no supplier can find is not a capability (§47).
    const settings = src('client/src/pages/SettingsPage.tsx');
    expect(settings).toContain('<ShowcaseManager />');
    expect(settings).toContain('id="settings-showcase"');
  });

  it('and it is gated to accounts that HAVE a storefront', () => {
    const settings = src('client/src/pages/SettingsPage.tsx');
    const start = settings.indexOf('id="settings-showcase"');
    const end = settings.indexOf('id="settings-portfolio"', start);
    expect(settings.slice(start, end)).toContain('isProvider');
  });

  it('no orphaned reference to the module survives anywhere else', () => {
    // A census rather than a spot check: any NEW importer of this module on a
    // shared surface is the leak this whole file is about.
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
      }
      return out;
    };
    const importers = walk(join(ROOT, 'server'))
      .concat(walk(join(ROOT, 'client/src')))
      .filter(file => readSourceForAssertions(readFileSync(file, 'utf8')).includes('supplierShowcase'))
      .map(file => file.slice(ROOT.length + 1));
    // Exactly these. A new name here is a deliberate decision, not a drift.
    /*
     * EXACTLY THESE FOUR, and each one is allowed for a stated reason:
     *
     *   server/supplierShowcase.ts      the module itself
     *   server/routers.ts               the three procedures
     *   ShowcaseStrip.tsx               the ONE storefront that renders it
     *   ShowcaseManager.tsx             the supplier's own editor
     *
     * A fifth name appearing here is the leak this whole file is about: it
     * would mean some other surface had started reading a supplier's
     * self-selected emphasis.
     */
    expect(importers.sort()).toEqual([
      'client/src/components/ShowcaseManager.tsx',
      'client/src/components/ShowcaseStrip.tsx',
      'server/routers.ts',
      'server/supplierShowcase.ts',
      // The Marketing Center COUNTS the showcase and reports it beside
      // Featured and Sponsored - explicitly as the supplier's own choice
      // that does NOT affect ranking. It reads the count and nothing else:
      // it never ranks by it, never merges it into a placement total, and
      // never exposes it on a shared surface.
      'server/vendorMarketing.ts',
    ].sort());
  });
});
