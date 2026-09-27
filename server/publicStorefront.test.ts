/**
 * ── THE STOREFRONT IS PUBLIC, AND NOTHING PRIVATE MOVED ─────────────────
 *
 * `profile.getPublic` was a `protectedProcedure`, so a signed-out reader - and
 * every crawler - got "Please sign in to view this vendor profile" on the
 * marketplace's most important destination, while §21 and §37 both described it
 * as a public page. The owner has resolved it.
 *
 * ── WHAT COULD GO WRONG IN OPENING IT, AND WHAT HOLDS ───────────────────
 *
 * Two things, and neither is the procedure keyword.
 *
 * THE VISIBILITY GATE. The only check was the account's ROLE. Behind a session
 * that was tolerable; in public it is not, because a stranger walking ids would
 * reach the page of an applicant BuildHub has not approved, or an account that
 * is frozen or deactivated - precisely the accounts the directory refuses to
 * list. So a stranger sees what the DIRECTORY would show, through
 * `directoryVisibilityFilter()`, the same predicate the listing and the
 * placement readers use. Self and admin are exempt, and both could already see
 * the page.
 *
 * THE CONTACT TIER. The named contact, their email, phone, mobile and street
 * address are released only once the provider has ENGAGED - they quoted on this
 * reader's RFQ, or are a live member of their project. That rule lives in
 * `vendorContactAccess`, which already answered 'none' for a null viewer, so
 * opening the page could not widen it. This file proves that rather than
 * assuming it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSourceForAssertions } from './_testing/sourceText';
import { unlocksContact, vendorContactAccess } from './vendorProfile';

const raw = (relative: string) => readFileSync(join(import.meta.dirname, relative), 'utf8');
const code = (relative: string) => readSourceForAssertions(raw(relative));

/** The `getPublic` procedure body, so an assertion cannot pass on another one. */
function getPublicBody(): string {
  const routers = code('routers.ts');
  const start = routers.indexOf('getPublic: publicProcedure');
  expect(start, 'getPublic is not a publicProcedure').toBeGreaterThan(-1);
  /*
   * ENDS AT THE NEXT PROCEDURE. A slice that ran to `saveMyCompanyProfile`
   * swallowed `getOwn` as well - a protectedProcedure that legitimately reads
   * `ctx.user.id` - so the check below reported the neighbour's correct code as
   * this procedure's bug.
   */
  const end = routers.indexOf('  getOwn:', start);
  expect(end, 'getPublic is no longer followed by getOwn').toBeGreaterThan(start);
  return routers.slice(start, end);
}

describe('the procedure is public', () => {
  it('reads the real file', () => {
    expect(code('routers.ts').length).toBeGreaterThan(100_000);
  });

  it('getPublic is a publicProcedure, not a protectedProcedure', () => {
    const routers = code('routers.ts');
    expect(routers).toContain('getPublic: publicProcedure');
    expect(routers).not.toContain('getPublic: protectedProcedure');
  });

  it('and tolerates an absent viewer everywhere it reads one', () => {
    const body = getPublicBody();
    // `ctx.user` is optional now. A bare `ctx.user.id` would throw for exactly
    // the reader this change is for.
    expect(body).toContain('ctx.user?.id');
    expect(body).toContain('readVendorProfile(db, target.id, ctx.user ?? null)');
    expect(body).not.toMatch(/ctx\.user\.id/);
  });
});

describe('a stranger sees only what the directory publishes', () => {
  it('the gate is the CANONICAL directory predicate, not a second rule', () => {
    const body = getPublicBody();
    expect(body).toContain('directoryVisibilityFilter()');
  });

  it('it refuses with NOT FOUND, so ids cannot be enumerated', () => {
    /*
     * §9: not-yours and not-found must not become an enumeration oracle. A
     * FORBIDDEN here would tell a stranger that an account exists and is
     * unapproved, frozen or deactivated.
     */
    const body = getPublicBody();
    const gate = body.slice(body.indexOf('directoryVisibilityFilter()'));
    expect(gate).toContain("code: 'NOT_FOUND'");
    expect(gate.slice(0, 400)).not.toContain('FORBIDDEN');
  });

  it('self and admin are exempt, and only those two', () => {
    const body = getPublicBody();
    expect(body).toContain('const viewerIsSelf = ctx.user?.id === target.id');
    expect(body).toContain("ctx.user?.role === 'admin'");
    // An admin must hold an admin role, not merely the role column.
    expect(body).toContain('Boolean(ctx.user?.adminRole)');
    expect(body).toContain('if (!viewerIsSelf && !viewerIsAdmin)');
  });
});

describe('the contact tier did not widen', () => {
  const nobody = null;

  it('a null viewer earns nothing', async () => {
    // `vendorContactAccess` short-circuits before any query for a null viewer,
    // so this needs no database and is the exact path a stranger takes.
    expect(await vendorContactAccess({} as never, 464, nobody)).toBe('none');
    expect(unlocksContact('none')).toBe(false);
  });

  it('and every tier that DOES unlock requires a viewer', () => {
    for (const tier of ['self', 'admin', 'quoted', 'project'] as const) {
      expect(unlocksContact(tier), tier).toBe(true);
    }
  });

  it('the private columns are still not in the public tier', () => {
    const profile = code('vendorProfile.ts');
    const publicBlock = profile.slice(
      profile.indexOf('VENDOR_PROFILE_PUBLIC_COLUMNS = {'),
      profile.indexOf('VENDOR_PROFILE_CONTACT_COLUMNS = {'));
    for (const column of ['contactEmail', 'contactPhone', 'contactMobile', 'addressLine', 'registrationNumber']) {
      expect(publicBlock, `${column} is in the public tier`).not.toContain(column);
    }
  });

  it('and the users table\'s own private columns are not returned either', () => {
    const routers = code('routers.ts');
    const columns = routers.slice(
      routers.indexOf('const PUBLIC_PROFILE_COLUMNS = {'),
      routers.indexOf('const MAX_AVATAR_SIZE'));
    for (const column of ['users.email', 'users.phone', 'users.passwordHash', 'users.openId']) {
      expect(columns, `${column} is returned publicly`).not.toContain(column);
    }
  });
});

describe('the contact channel tells a stranger the truth', () => {
  it('three states, because two would say contact is impossible', () => {
    /*
     * `active ? 'message' : 'none'` was complete while every reader held a
     * session. To a signed-out reader 'none' would claim the provider cannot be
     * contacted - and they can be, by anyone with an account. §10: UNKNOWN AUTH
     * is not the same as unavailable.
     */
    const body = getPublicBody();
    expect(body).toContain("? 'none' as const");
    expect(body).toContain("? 'message' as const");
    expect(body).toContain(": 'sign_in' as const");
  });

  it('a frozen provider is `none` even for a signed-in reader', () => {
    // messages.send refuses them, so the page must not offer a button that
    // fails - the state is decided by the account, then by the session.
    const body = getPublicBody();
    const channel = body.slice(body.indexOf('contactChannel:'));
    expect(channel.indexOf("accountStatus !== 'active'")).toBeLessThan(channel.indexOf('ctx.user'));
  });
});

describe('the page renders for a reader with no session', () => {
  const page = code('../client/src/pages/VendorProfile.tsx');

  it('the sign-in wall is gone', () => {
    expect(page).not.toContain('Please sign in to view this vendor profile');
    expect(page).not.toContain('يرجى تسجيل الدخول لعرض الملف الشخصي للمزود');
  });

  it('and the query no longer waits for a session', () => {
    expect(page).toContain('enabled: Number.isFinite(userId) && userId > 0');
    expect(page).not.toContain('enabled: isAuthenticated && Number.isFinite(userId)');
  });

  it('but the three session-bound actions are not offered to a stranger', () => {
    /*
     * Messaging, the RFQ invitation and the shortlist are all protected
     * procedures. Rendering their buttons to a signed-out reader would offer
     * three controls that answer 401 - §58 and §77.
     */
    expect(page).toContain('data-testid="vendor-signedout-actions"');
    expect(page).toContain('data-testid="vendor-signin-cta"');
    expect(page).toContain("vendor.signedout.body");
  });

  it('and the copy explaining why exists in both languages', () => {
    const context = raw('../client/src/contexts/LanguageContext.tsx');
    for (const key of ['vendor.signedout.title', 'vendor.signedout.body', 'vendor.signedout.cta']) {
      // Twice: once per language dictionary.
      expect(context.split(`'${key}'`).length - 1, key).toBe(2);
    }
    // And the Arabic really is Arabic.
    const arabic = context.slice(context.indexOf("'vendor.signedout.title': 'سجّل"));
    expect(/[؀-ۿ]/.test(arabic.slice(0, 200))).toBe(true);
  });
});

describe('the portfolio moved with the storefront', () => {
  it('portfolio.list is public, so the section is not silently empty', () => {
    /*
     * While this stayed protected, the page rendered its Portfolio section to a
     * signed-out buyer and filled it with nothing - which reads as a claim
     * about the PROVIDER ("no work shown") rather than about the reader.
     */
    const routers = code('routers.ts');
    expect(routers).toContain('list: publicProcedure\n    .input(z.object({ userId: z.number().int().positive() }))');
    expect(routers).not.toContain('list: protectedProcedure\n    .input(z.object({ userId: z.number().int().positive() }))');
  });

  it('and it gained the visibility rule it never had', () => {
    /*
     * It took any userId and returned every row, without checking the account
     * was even a provider. Behind a session that was loose; in public it is the
     * same exposure the storefront had to close.
     */
    const routers = code('routers.ts');
    const list = routers.slice(routers.indexOf('const portfolioRouter = router({'));
    const body = list.slice(0, list.indexOf('  myItems:'));
    expect(body).toContain('directoryVisibilityFilter()');
    expect(body).toContain("code: 'NOT_FOUND'");
    expect(body).toContain('const viewerIsSelf = ctx.user?.id === input.userId');
    expect(body).toContain('Boolean(ctx.user?.adminRole)');
  });
});

describe('the rest of the product agrees that it is public now', () => {
  it('the SEO table calls it public, so it is indexable and in the sitemap', () => {
    const seo = code('../shared/seo.ts');
    const entry = seo.slice(seo.indexOf("path: '/vendor/:id'"), seo.indexOf("path: '/service-categories'"));
    expect(entry).toContain("access: 'public'");
    expect(entry).not.toContain('session-required');
  });

  it('the sitemap publishes storefronts through the SAME predicate the page gates on', () => {
    /*
     * If these two rules ever differed, the sitemap would advertise a URL the
     * page refuses - a crawl spent on a 404, and a published claim the product
     * does not honour.
     */
    const sitemap = code('sitemap.ts');
    expect(sitemap).toContain('directoryVisibilityFilter()');
    expect(sitemap).toContain('`/vendor/${row.id}`');
    expect(sitemap).toContain('withheldStorefronts: 0');
  });

  it('and the shell titles a storefront from the same predicate too', () => {
    const entity = code('seoEntityName.ts');
    expect(entity).toContain("'/vendor/:id'");
    expect(entity).toContain('directoryVisibilityFilter()');
  });
});
