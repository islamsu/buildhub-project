/**
 * ── WHAT A SERVICE CATALOGUE HAS TO GET RIGHT ─────────────────────────────
 *
 * Five rules this file exists to pin, each of which a plausible implementation
 * gets wrong:
 *
 *   QUOTE ON REQUEST CANNOT CARRY A PRICE. Not "the price is ignored" - the
 *   whole write is REFUSED. A dropped field is a provider who believes they
 *   published a rate and did not, and a customer who is shown two different
 *   answers will believe the number.
 *
 *   PUBLISHING NEEDS AN APPROVED ACCOUNT; DRAFTING DOES NOT. A provider still
 *   being vetted must be able to prepare a catalogue, or they arrive at an
 *   empty profile on the day they are approved. The line between those two is
 *   the only place approval is checked, and `create` routes through it rather
 *   than around it - otherwise "create it already active" is the bypass.
 *
 *   VISIBILITY HAS TWO CLAUSES, NOT ONE. Active offering AND approved provider.
 *   A product only ever needed the first; a service is somebody turning up at
 *   your home, and one clause would advertise unvetted trades.
 *
 *   A SERVICE CANNOT BE FILED UNDER A PRODUCT CATEGORY. Otherwise a trade lands
 *   in the shopper's goods browse and a bag of cement in the trades directory.
 *
 *   AND SOMEBODY ELSE'S SERVICE IS NOT_FOUND, NEVER FORBIDDEN. FORBIDDEN over a
 *   guessed id is a row-existence oracle across every provider's drafts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import {
  SERVICE_STATUSES, SERVICE_TRANSITIONS, SERVICE_PRICING_BASES,
  DEFAULT_PRICING_BASIS, basisAcceptsPrice, pricingBasisLabel, pricingBasisHelp,
  SERVICE_PRICE_MAX,
} from '@shared/serviceCatalogue';
import { PRODUCT_STATUSES, PRODUCT_TRANSITIONS } from '@shared/productLifecycle';
import {
  ServiceCatalogueError, validatePricing, validateCommitments,
  assertCategoryAcceptsServices, requireOwnedService, transitionService,
  canTransitionService, visibleServicesFor,
} from './serviceCatalogue';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const SCHEMA = readSourceForAssertions(read('../drizzle/schema.ts'));
const ROUTERS = readSourceForAssertions(read('./routers.ts'));
const SERVICE = readSourceForAssertions(read('./serviceCatalogue.ts'));
const MIGRATION = read('../drizzle/0052_service_catalogue.sql');
const MANAGER = readSourceForAssertions(read('../client/src/components/ServiceCatalogueManager.tsx'));
const PROFILE = readSourceForAssertions(read('../client/src/pages/VendorProfile.tsx'));
const SETTINGS = readSourceForAssertions(read('../client/src/pages/SettingsPage.tsx'));
const CONTEXT = read('../client/src/contexts/LanguageContext.tsx');

function tableFor(lang: 'en' | 'ar'): Map<string, string> {
  const start = CONTEXT.indexOf(`\n  ${lang}: {`);
  const end = lang === 'en' ? CONTEXT.indexOf('\n  ar: {') : CONTEXT.indexOf('\n};', start);
  const block = CONTEXT.slice(start, end);
  const table = new Map<string, string>();
  for (const match of block.matchAll(/^\s{4}'([^']+)':\s*'((?:[^'\\]|\\.)*)'/gm)) table.set(match[1], match[2]);
  return table;
}
const EN = tableFor('en');
const AR = tableFor('ar');

/** A db double answering selects in order and recording every write. */
function fakeDb(selects: unknown[][]) {
  let call = 0;
  const writes: { kind: 'insert' | 'update'; values: any }[] = [];
  const answer = () => Promise.resolve(selects[call++] ?? []);
  const chain = () => {
    let pending: Promise<unknown> | null = null;
    const take = () => (pending ??= answer());
    return {
      limit: () => take(),
      innerJoin: () => chain(),
      where: () => chain(),
      orderBy: () => take(),
      then: (ok: any, err: any) => take().then(ok, err),
    };
  };
  return {
    select: () => ({ from: () => chain() }),
    insert: () => ({ values: (values: any) => { writes.push({ kind: 'insert', values }); return Promise.resolve([{ insertId: 1 }]); } }),
    update: () => ({ set: (values: any) => ({ where: () => { writes.push({ kind: 'update', values }); return Promise.resolve(); } }) }),
    writes,
    get callCount() { return call; },
  } as any;
}

describe('one lifecycle, imported rather than restated', () => {
  it('the service states ARE the product states, not a copy that can drift', () => {
    // Two lifecycles with the same four words that slowly disagree is worse
    // than one that is slightly generic.
    expect(SERVICE_STATUSES).toBe(PRODUCT_STATUSES);
    expect(SERVICE_TRANSITIONS).toBe(PRODUCT_TRANSITIONS);
  });

  it('the module IMPORTS them rather than declaring its own', () => {
    const shared = readSourceForAssertions(read('../shared/serviceCatalogue.ts'));
    expect(shared).toContain("from './productLifecycle'");
    expect(shared).not.toMatch(/SERVICE_STATUSES\s*=\s*\[/);
  });

  it('every declared move is honoured and everything else refused', () => {
    for (const from of SERVICE_STATUSES) {
      for (const to of SERVICE_STATUSES) {
        const declared = (SERVICE_TRANSITIONS[from] as readonly string[]).includes(to);
        expect(canTransitionService(from, to), `${from} -> ${to}`).toBe(declared);
      }
    }
  });
});

describe('the pricing vocabulary is honest about what is not known', () => {
  it('QUOTE ON REQUEST IS THE DEFAULT', () => {
    // Most Egyptian construction work is priced per job after a site visit. A
    // catalogue that demanded a number would be answered with invented ones.
    expect(DEFAULT_PRICING_BASIS).toBe('quote_on_request');
    expect(SERVICE_PRICING_BASES).toContain('quote_on_request');
  });

  it('and it is the ONLY basis that forbids a figure', () => {
    for (const basis of SERVICE_PRICING_BASES) {
      expect(basisAcceptsPrice(basis), basis).toBe(basis !== 'quote_on_request');
    }
  });

  it('every basis has a distinct label AND a help line in both languages', () => {
    for (const basis of SERVICE_PRICING_BASES) {
      for (const lang of ['en', 'ar'] as const) {
        expect(pricingBasisLabel(basis, lang), `${basis} ${lang}`).toBeTruthy();
        expect(pricingBasisHelp(basis, lang), `${basis} help ${lang}`).toBeTruthy();
      }
      // Arabic that is the English string is an untranslated placeholder.
      expect(pricingBasisLabel(basis, 'ar')).not.toBe(pricingBasisLabel(basis, 'en'));
      expect(pricingBasisHelp(basis, 'ar')).not.toBe(pricingBasisHelp(basis, 'en'));
    }
  });
});

describe('the pricing coherence rule', () => {
  it('REFUSES a price on quote-on-request rather than dropping it', () => {
    // Dropping it silently is the failure mode that matters: the provider
    // believes they published a rate.
    for (const price of [{ priceMin: 500 }, { priceMax: 900 }, { priceMin: 500, priceMax: 900 }]) {
      expect(() => validatePricing({ pricingBasis: 'quote_on_request', ...price }))
        .toThrow(ServiceCatalogueError);
    }
  });

  it('allows quote-on-request with no figures at all', () => {
    expect(validatePricing({ pricingBasis: 'quote_on_request' }))
      .toEqual({ priceMin: null, priceMax: null });
  });

  it('accepts a range on a basis that carries one', () => {
    expect(validatePricing({ pricingBasis: 'per_square_metre', priceMin: 120, priceMax: 260 }))
      .toEqual({ priceMin: 120, priceMax: 260 });
  });

  it('REFUSES a maximum below the minimum rather than swapping them', () => {
    // Reordering somebody's range is a guess about which number they meant.
    expect(() => validatePricing({ pricingBasis: 'per_day', priceMin: 900, priceMax: 400 }))
      .toThrow(/below the minimum/);
  });

  it('refuses a negative, a non-finite and an implausible amount', () => {
    expect(() => validatePricing({ pricingBasis: 'per_unit', priceMin: -1 })).toThrow(ServiceCatalogueError);
    expect(() => validatePricing({ pricingBasis: 'per_unit', priceMin: Number.NaN })).toThrow(ServiceCatalogueError);
    expect(() => validatePricing({ pricingBasis: 'per_unit', priceMax: SERVICE_PRICE_MAX + 1 })).toThrow(ServiceCatalogueError);
  });

  it('an open-ended range is allowed - "from EGP 120" is a real offer', () => {
    expect(validatePricing({ pricingBasis: 'per_square_metre', priceMin: 120 }))
      .toEqual({ priceMin: 120, priceMax: null });
  });

  it('lead time and warranty are bounded, and absence is allowed', () => {
    expect(() => validateCommitments({})).not.toThrow();
    expect(() => validateCommitments({ leadTimeDays: 14, warrantyMonths: 60 })).not.toThrow();
    expect(() => validateCommitments({ leadTimeDays: -1 })).toThrow(ServiceCatalogueError);
    expect(() => validateCommitments({ leadTimeDays: 400 })).toThrow(ServiceCatalogueError);
    expect(() => validateCommitments({ warrantyMonths: 1200 })).toThrow(ServiceCatalogueError);
    expect(() => validateCommitments({ leadTimeDays: 2.5 })).toThrow(ServiceCatalogueError);
  });
});

describe('a service cannot be filed under a product category', () => {
  it('refuses a PRODUCT-scope category by name, not by "forbidden"', async () => {
    await expect(assertCategoryAcceptsServices(
      fakeDb([[{ id: 3, scope: 'PRODUCT', status: 'active' }]]), 3,
    )).rejects.toThrow(/service category/);
  });

  it('accepts SERVICE and BOTH', async () => {
    for (const scope of ['SERVICE', 'BOTH']) {
      await expect(assertCategoryAcceptsServices(
        fakeDb([[{ id: 3, scope, status: 'active' }]]), 3,
      )).resolves.toBeUndefined();
    }
  });

  it('refuses a hidden or archived category for a NEW listing', async () => {
    for (const status of ['hidden', 'archived']) {
      await expect(assertCategoryAcceptsServices(
        fakeDb([[{ id: 3, scope: 'SERVICE', status }]]), 3,
      )).rejects.toThrow(/no longer open/);
    }
  });

  it('a category that does not exist is NOT_FOUND', async () => {
    await expect(assertCategoryAcceptsServices(fakeDb([[]]), 99))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('ownership', () => {
  it("somebody else's service is NOT_FOUND, never FORBIDDEN", async () => {
    // FORBIDDEN over a guessed id tells a stranger the row exists.
    await expect(requireOwnedService(fakeDb([[{ id: 7, providerId: 20 }]]), 7, 99))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a service that does not exist is the SAME answer', async () => {
    await expect(requireOwnedService(fakeDb([[]]), 7, 99))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the owner gets their row', async () => {
    await expect(requireOwnedService(fakeDb([[{ id: 7, providerId: 20 }]]), 7, 20))
      .resolves.toMatchObject({ id: 7 });
  });
});

describe('publishing needs an approved account; drafting does not', () => {
  it('REFUSES to publish while the account is still being vetted', async () => {
    const db = fakeDb([
      [{ id: 7, providerId: 20, status: 'draft' }],
      [{ onboardingStatus: 'under_review' }],
    ]);
    await expect(transitionService(db, { serviceId: 7, providerId: 20, to: 'active' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.writes, 'a refused publish must write nothing').toEqual([]);
  });

  it('publishes for an approved account', async () => {
    const db = fakeDb([
      [{ id: 7, providerId: 20, status: 'draft' }],
      [{ onboardingStatus: 'approved' }],
    ]);
    await expect(transitionService(db, { serviceId: 7, providerId: 20, to: 'active' }))
      .resolves.toEqual({ from: 'draft', to: 'active' });
    expect(db.writes.some(w => w.kind === 'update' && w.values.status === 'active')).toBe(true);
  });

  it('ARCHIVING IS NOT GATED ON APPROVAL - withdrawing is always allowed', async () => {
    // A provider whose approval lapsed must still be able to take a listing
    // down. Gating every transition on approval would trap it live.
    const db = fakeDb([[{ id: 7, providerId: 20, status: 'active' }]]);
    await expect(transitionService(db, { serviceId: 7, providerId: 20, to: 'inactive' }))
      .resolves.toEqual({ from: 'active', to: 'inactive' });
  });

  it('an undeclared move names BOTH states', async () => {
    const db = fakeDb([[{ id: 7, providerId: 20, status: 'archived' }]]);
    await expect(transitionService(db, { serviceId: 7, providerId: 20, to: 'active' }))
      .rejects.toThrow(/archived to active/);
  });

  it('a no-op transition is accepted and writes nothing', async () => {
    const db = fakeDb([[{ id: 7, providerId: 20, status: 'active' }]]);
    await expect(transitionService(db, { serviceId: 7, providerId: 20, to: 'active' }))
      .resolves.toEqual({ from: 'active', to: 'active' });
    expect(db.writes).toEqual([]);
  });

  it('archiving stamps archivedAt and delisting clears it', async () => {
    const archived = fakeDb([[{ id: 7, providerId: 20, status: 'active' }]]);
    await transitionService(archived, { serviceId: 7, providerId: 20, to: 'archived' });
    expect(archived.writes[0].values.archivedAt).toBeInstanceOf(Date);
    const restored = fakeDb([[{ id: 7, providerId: 20, status: 'archived' }]]);
    await transitionService(restored, { serviceId: 7, providerId: 20, to: 'inactive' });
    expect(restored.writes[0].values.archivedAt).toBeNull();
  });

  it('every transition is recorded in the commercial trail', async () => {
    const db = fakeDb([[{ id: 7, providerId: 20, status: 'active' }]]);
    await transitionService(db, { serviceId: 7, providerId: 20, to: 'archived' });
    const audit = db.writes.find((w: any) => w.values?.action?.startsWith?.('service_'));
    expect(audit?.values.subjectType).toBe('service');
    expect(audit?.values.action).toBe('service_archived');
  });
});

describe('visibility has TWO clauses', () => {
  it('an unapproved provider publishes to nobody', async () => {
    // The offering may be active; the account is not. One clause would
    // advertise an unvetted trade.
    const db = fakeDb([[{ onboardingStatus: 'under_review' }], [{ id: 1 }]]);
    expect(await visibleServicesFor(db, 20)).toEqual([]);
  });

  it('a provider with no account row publishes to nobody', async () => {
    expect(await visibleServicesFor(fakeDb([[]]), 20)).toEqual([]);
  });

  it('an approved provider reaches the catalogue query', async () => {
    const db = fakeDb([[{ onboardingStatus: 'approved' }], [{ id: 1, title: 'Waterproofing' }]]);
    expect(await visibleServicesFor(db, 20)).toEqual([{ id: 1, title: 'Waterproofing' }]);
  });

  it('the provider clause is its own named rule, not spelled out at readers', () => {
    expect(SERVICE).toContain('approvedProviderFilter');
    expect(SERVICE).toContain('publicServiceFilter');
  });
});

describe('the procedures', () => {
  const slice = (name: string) => {
    const start = ROUTERS.indexOf(`const servicesRouter = router({`);
    const block = ROUTERS.slice(start, ROUTERS.indexOf('\n});', start));
    const at = block.indexOf(`  ${name}: `);
    expect(at, name).toBeGreaterThan(-1);
    const rest = block.slice(at + name.length + 3);
    const next = rest.search(/\n  [a-zA-Z]+: (complianceProcedure|publicProcedure|protectedProcedure|approvedProviderProcedure)/);
    return rest.slice(0, next === -1 ? undefined : next);
  };

  it('CREATE ROUTES PUBLISHING THROUGH THE ONE TRANSITION FUNCTION', () => {
    // "Create it already active" is the obvious bypass of the approval check,
    // and it is closed by inserting as draft and then transitioning.
    const body = slice('create');
    expect(body).toContain("status: 'draft'");
    expect(body).toContain('transitionService');
  });

  it('every write takes the provider from the session, never from the input', () => {
    for (const name of ['create', 'update', 'setStatus']) {
      const body = slice(name);
      expect(body, name).toContain('ctx.user.id');
      expect(body, name).not.toMatch(/providerId: input\./);
    }
  });

  it('the write procedures sit on the tier that allows an unapproved provider to draft', () => {
    for (const name of ['create', 'update', 'setStatus', 'mine']) {
      expect(ROUTERS, name).toContain(`  ${name}: complianceProcedure`);
    }
  });

  it('the public reads are public, and the private one is not', () => {
    expect(ROUTERS).toContain('  categories: publicProcedure');
    expect(ROUTERS).toContain('  forProvider: publicProcedure');
    expect(slice('mine')).toContain('eq(serviceOfferings.providerId, ctx.user.id)');
  });

  it('the public per-provider read goes through the two-clause helper', () => {
    expect(slice('forProvider')).toContain('visibleServicesFor');
  });

  it('the category list offers only service-scoped, active categories', () => {
    const body = slice('categories');
    // THE EXACT LIST, not a substring of it. `toContain("'SERVICE', 'BOTH'")`
    // passed with the product mutated to ['SERVICE', 'BOTH', 'PRODUCT'] - the
    // widened array still contains the narrower text, so the assertion could
    // not see the one change that matters.
    const scope = body.match(/inArray\(productCategories\.scope, \[([^\]]*)\]\)/);
    expect(scope, 'the scope filter is gone entirely').not.toBeNull();
    expect(scope![1].split(',').map(part => part.trim())).toEqual(["'SERVICE'", "'BOTH'"]);
    expect(body).toContain("eq(productCategories.status, 'active')");
  });

  it('a refusal keeps its reason instead of becoming a 500', () => {
    const mapper = ROUTERS.slice(ROUTERS.indexOf('function asServiceTrpcError'));
    expect(mapper.slice(0, 400)).toContain('ServiceCatalogueError');
    expect(mapper.slice(0, 400)).toContain('error.code');
  });
});

describe('the table and the migration say what the code assumes', () => {
  const table = () => {
    const start = SCHEMA.indexOf('export const serviceOfferings = mysqlTable');
    return SCHEMA.slice(start, SCHEMA.indexOf('}));', start));
  };

  it('prices are NULLABLE, because quote-on-request is the common case', () => {
    // A NOT NULL price column is how invented prices get published.
    const body = table();
    expect(body).toMatch(/priceMin.*decimal/);
    expect(body).not.toMatch(/decimal\('priceMin'[^)]*\)[^,]*\.notNull\(\)/);
    expect(body).not.toMatch(/decimal\('priceMax'[^)]*\)[^,]*\.notNull\(\)/);
  });

  it('the category reference is RESTRICT, so retiring a category keeps listings', () => {
    expect(table()).toContain("onDelete: 'restrict'");
    expect(MIGRATION).toContain('REFERENCES `productCategories`(`id`) ON DELETE restrict');
  });

  it('carries the two indexes its two real reads need', () => {
    expect(MIGRATION).toContain('serviceOfferings_provider_status_idx');
    expect(MIGRATION).toContain('serviceOfferings_category_status_idx');
  });

  it('THE AUDIT ENUM LEARNS "service" IN THE DATABASE, not only in TypeScript', () => {
    // A union widened in TypeScript alone compiles and then fails at MySQL on
    // the first published service - the worst possible place to find out.
    expect(MIGRATION).toContain('MODIFY COLUMN `subjectType`');
    expect(MIGRATION).toMatch(/enum\([^)]*'service'[^)]*\) NOT NULL/);
    expect(SCHEMA).toMatch(/mysqlEnum\('subjectType',[^)]*'service'/);
  });

  it('seeds SERVICE categories, which is what the unused scope was waiting for', () => {
    expect(MIGRATION).toContain("INSERT IGNORE INTO `productCategories`");
    const seeded = [...MIGRATION.matchAll(/\('svc-[a-z-]+'/g)].length;
    expect(seeded).toBeGreaterThanOrEqual(15);
  });

  it('and seeds them IDEMPOTENTLY, so a re-run rescopes nothing', () => {
    // A plain INSERT would collide on slug; an UPDATE would silently rescope a
    // PRODUCT category that already owns the name, taking its products with it.
    expect(MIGRATION).toContain('INSERT IGNORE');
    expect(MIGRATION).not.toMatch(/ON DUPLICATE KEY UPDATE/i);
    expect(MIGRATION).not.toMatch(/UPDATE `?productCategories`? SET/i);
  });

  it('every seeded category carries BOTH languages', () => {
    const rows = [...MIGRATION.matchAll(/\('svc-[a-z-]+',\s*'([^']+)',\s*'([^']+)'/g)];
    expect(rows.length).toBeGreaterThanOrEqual(15);
    for (const [, en, ar] of rows) {
      expect(en).toMatch(/[A-Za-z]/);
      expect(ar, `${en} has no Arabic`).toMatch(/[؀-ۿ]/);
    }
  });

  it('every statement is separated for the migration runner', () => {
    const sql = MIGRATION.split('\n').filter(line => !/^\s*--(?!>)/.test(line)).join('\n');
    const chunks = sql.split('--> statement-breakpoint');
    for (const chunk of chunks) {
      expect(chunk.split(';').filter(part => part.trim().length > 0).length).toBe(1);
    }
  });
});

describe('the screens tell the truth about price', () => {
  it('THE PRICE FIELDS ARE ABSENT on quote on request, not disabled', () => {
    // The server refuses that pairing outright. A form that offers a box the
    // server will refuse teaches a provider to distrust it.
    //
    // THE ASSIGNMENT, not the token. `toContain('basisAcceptsPrice')` passed
    // with the product mutated to `const showsPrice = true` - the identifier
    // still appeared elsewhere in the file, so the assertion proved the import
    // existed and nothing about whether it was connected to anything.
    const assignment = MANAGER.match(/const showsPrice = ([^;]+);/);
    expect(assignment, 'showsPrice is not derived at all').not.toBeNull();
    expect(assignment![1].trim()).toBe('basisAcceptsPrice(values.pricingBasis)');
    expect(MANAGER).toContain('{showsPrice && (');
  });

  it('and the figures are not even SENT when the basis does not carry one', () => {
    // A stale number from a field the provider can no longer see would fail a
    // save they did not understand.
    expect(MANAGER).toContain('showsPrice ? num(values.priceMin) : undefined');
    expect(MANAGER).toContain('showsPrice ? num(values.priceMax) : undefined');
  });

  it('NO ZERO EVER STANDS IN FOR AN UNKNOWN PRICE, on either screen', () => {
    // "from EGP 0" is a fabricated price wearing a number's clothes.
    //
    // Scoped to the formatting FUNCTION and looking for any zero default at
    // all. The first version named three exact spellings - `priceMin ?? 0` and
    // friends - and passed with `n(min ?? 0)`, which is the same defect under a
    // shorter variable name. An enumeration of spellings is not a rule.
    for (const [name, source] of [['manager', MANAGER], ['profile', PROFILE]] as const) {
      const at = source.search(/function (formatRange|publicPriceRange)/);
      expect(at, `${name} has no price formatter`).toBeGreaterThan(-1);
      const body = source.slice(at, source.indexOf('\n}', at));
      expect(body, name).not.toMatch(/\?\?\s*0\b/);
      expect(body, name).not.toMatch(/\|\|\s*0\b/);
      // And it must still be a real formatter, not an emptied one.
      expect(body, name).toContain('toLocaleString');
    }
  });

  it('quote on request renders the sentence and no range, on both screens', () => {
    for (const [name, source] of [['manager', MANAGER], ['profile', PROFILE]] as const) {
      expect(source, name).toContain("=== 'quote_on_request'");
      expect(source, name).toContain("pricingBasisLabel('quote_on_request', lang)");
    }
  });

  it('the pricing basis carries its help line, not just its name', () => {
    expect(MANAGER).toContain('pricingBasisHelp');
  });
});

describe('the catalogue is reachable and honest when empty', () => {
  it('Settings mounts it for providers, and says why not for everyone else', () => {
    expect(SETTINGS).toContain('<ServiceCatalogueManager />');
    expect(SETTINGS).toContain('id="settings-services"');
    // Not a blank section: a homeowner is told the section does not apply.
    const section = SETTINGS.slice(
      SETTINGS.indexOf('id="settings-services"'),
      SETTINGS.indexOf('id="settings-categories"'),
    );
    expect(section).toContain('NotForThisAccount');
  });

  it('an empty catalogue says so rather than showing a sample service', () => {
    expect(MANAGER).toContain('svc.empty');
    expect(MANAGER).toContain('services.data.length === 0');
  });

  it('the public profile omits the whole section when nothing is published', () => {
    // An empty "Services offered" heading reads as a broken page.
    expect(PROFILE).toContain('offeredServices.length > 0 &&');
  });

  it('the public read goes through the two-clause procedure', () => {
    expect(PROFILE).toContain('trpc.services.forProvider.useQuery');
  });

  it('distinguishes "could not load" from "nothing listed"', () => {
    expect(MANAGER).toContain('LoadFailed');
    expect(MANAGER).toContain('services.isError');
    expect(MANAGER).toContain('service-catalogue-loading');
  });
});

describe('only the declared transitions are offered as buttons', () => {
  it('publish is offered from draft and inactive, never from archived', () => {
    const publish = MANAGER.slice(MANAGER.indexOf('service-publish-'), MANAGER.indexOf('service-publish-') + 1);
    expect(MANAGER).toContain("(row.status === 'draft' || row.status === 'inactive') && (");
    expect(publish).toBeTruthy();
  });

  it('an archived service is offered restore, and restore goes to inactive', () => {
    // Straight back to the marketplace would republish a year-old price. The
    // shared transition table says archived -> inactive only, and the button
    // has to agree or it is a dead control.
    expect(SERVICE_TRANSITIONS.archived).toEqual(['inactive']);
    expect(MANAGER).toContain("row.status === 'archived' && (");
    const restore = MANAGER.slice(MANAGER.indexOf("row.status === 'archived' && ("));
    expect(restore.slice(0, 400)).toContain("status: 'inactive'");
  });

  it('every status has a label in both languages', () => {
    for (const status of SERVICE_STATUSES) {
      const key = `serviceStatus.${status}`;
      expect(EN.get(key), `${key} EN`).toBeTruthy();
      expect(AR.get(key), `${key} AR`).toBeTruthy();
      expect(AR.get(key)).not.toBe(EN.get(key));
    }
  });

  it('every string the catalogue screen uses exists in both languages', () => {
    const keys = [...MANAGER.matchAll(/t\('(svc\.[a-zA-Z.]+)'\)/g)].map(match => match[1]);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of new Set(keys)) {
      expect(EN.get(key), `${key} EN`).toBeTruthy();
      expect(AR.get(key), `${key} AR`).toBeTruthy();
      expect(AR.get(key), `${key} untranslated`).not.toBe(EN.get(key));
    }
  });

  it('no English sentence bypasses t() on the catalogue screen', () => {
    const jsxText = [...MANAGER.matchAll(/>\s*([A-Za-z][A-Za-z ,.'-]{12,})\s*</g)].map(m => m[1]);
    expect(jsxText).toEqual([]);
  });
});
