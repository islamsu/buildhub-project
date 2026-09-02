import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ADMIN_ROLES, ADMIN_ROLE_PERMISSIONS } from '@shared/adminRoles';

import { checkUploadedFile, sniffContentType, DOCUMENT_TYPES, IMAGE_TYPES } from './_core/fileType';

/**
 * Slice 9 — authorization sweep.
 *
 * Six routers had no dedicated authorization test: messages, notifications,
 * marketplace, profile, registration and analytics. This file is the sweep's
 * standing record. It does two things:
 *
 *   PINS THE TIER OF ALL 113 PROCEDURES, so silently downgrading one from
 *   protected to public fails here rather than in production. That is exactly
 *   the mistake `rfq.list` was: a procedure that never got hardened when its
 *   neighbour `rfq.get` did.
 *
 *   HOLDS EACH DEFECT THE SWEEP FOUND, as a named regression, with the reason
 *   it mattered written next to it.
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ROUTERS = read('./routers.ts');

/** Every `name: someProcedure` declaration, paired with its router. */
function procedureTiers(): Map<string, string> {
  const tiers = new Map<string, string>();
  let router: string | null = null;
  for (const line of ROUTERS.split('\n')) {
    const routerMatch = /^const (\w+Router) = router\(\{/.exec(line);
    if (routerMatch) { router = routerMatch[1].replace(/Router$/, ''); continue; }
    // `adminWith('users.manage')` is recorded as that exact string, not
    // flattened to "adminProcedure": the permission IS the tier now, and a test
    // that could not tell them apart would pass while an endpoint sat behind
    // the wrong one.
    const procedureMatch = /^ {2}(\w+):\s*(publicProcedure|protectedProcedure|adminProcedure|superAdminProcedure|approvedProviderProcedure|complianceProcedure|adminWith\('[a-z.]+'\))/.exec(line);
    if (procedureMatch && router) tiers.set(`${router}.${procedureMatch[1]}`, procedureMatch[2]);
  }
  return tiers;
}

const TIERS = procedureTiers();

/**
 * The body of one procedure, scoped to its OWN router.
 *
 * Searching the whole file for `\n  get: ` finds projects.get, not
 * marketplace.get - several routers share procedure names, and a helper that
 * silently returns the wrong one turns every assertion below into a test of
 * something else entirely.
 */
function procedureBody(qualified: string): string {
  const [routerName, procedure] = qualified.split('.');
  const routerStart = ROUTERS.indexOf(`const ${routerName}Router = router({`);
  expect(routerStart, `router ${routerName} not found`).toBeGreaterThan(-1);
  const routerEnd = ROUTERS.indexOf('\n});', routerStart);
  const block = ROUTERS.slice(routerStart, routerEnd);

  const start = block.indexOf(`\n  ${procedure}: `);
  expect(start, `${qualified} not found in ${routerName}Router`).toBeGreaterThan(-1);
  // Ends at the next top-level procedure declaration, or the router's close.
  //
  // THE MATCH DELIBERATELY STARTS AT THAT PROCEDURE'S OWN COMMENT, not at its
  // name, so a doc comment belonging to the NEXT procedure is not counted as
  // part of THIS one's body. That mattered the moment a JSDoc block appeared
  // between two procedures: `profile.update` was reported as containing
  // "userId" because the following procedure's comment - which says it takes
  // no userId - had been swept into update's body. The rule was right and the
  // extractor was wrong.
  //
  // Both comment forms, because the file uses both.
  const rest = block.slice(start + 3);
  const nextMatch = /\n {2}(?:\/\*\*[\s\S]*?\*\/\n {2}|\/\/[^\n]*\n {2})*\w+:\s*(?:(?:public|protected|admin|superAdmin|approvedProvider|compliance)Procedure|adminWith\()/.exec(rest);
  return block.slice(start, nextMatch ? start + 3 + nextMatch.index : routerEnd - routerStart);
}


/**
 * Source with comment lines removed.
 *
 * Several assertions below scan for a pattern that the code also NAMES in a
 * comment while explaining why it was wrong - "the bare select returned
 * askerId", "the class here read [^\\w.-]". Matching those comments is a false
 * positive that has bitten this codebase repeatedly, so the scan runs against
 * code only.
 */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

const ROUTERS_CODE = codeOnly(ROUTERS);

// ── §1 The tier map ────────────────────────────────────────────────────────

describe('§1 every procedure is pinned to a tier', () => {
  it('found the whole surface', () => {
    expect(TIERS.size).toBeGreaterThanOrEqual(113);
  });

  it('THE PUBLIC SURFACE IS EXACTLY THIS LIST — adding to it must be deliberate', () => {
    // Anything unauthenticated is reachable by the entire internet. A new entry
    // appearing here without a matching decision is the failure this catches.
    const publicProcedures = Array.from(TIERS.entries())
      .filter(([, tier]) => tier === 'publicProcedure')
      .map(([name]) => name)
      .sort();
    expect(publicProcedures).toEqual([
      // Sign-in, sign-up and recovery must work before you have a session.
      'admin.completeInvitation',
      // Administrator sign-in. Public for the same reason auth.signIn is: you
      // cannot hold a session before you authenticate. It is strictly NARROWER
      // than auth.signIn - it refuses anyone who is not an administrator with a
      // resolvable role - and returns one identical message for every rejection,
      // so it cannot be used to discover which accounts are administrators.
      'auth.adminSignIn',
      'auth.capabilities',
      'auth.checkSignupAvailability',
      // Redeeming an administrator invitation or reset link. Public because the
      // holder has no session yet. Guarded by a 32-byte CSPRNG token matched by
      // sha256, single-use via a conditional UPDATE, expiring and revocable, and
      // the role granted comes from the stored row rather than from the request.
      'auth.completeAdminInvitation',
      'auth.logout',
      'auth.me',
      // Phases 7-9. Public because the holder of a QA sign-in link has no
      // session yet - that is what they are redeeming. It is not unguarded:
      // ENV.testLoginEnabled gates it before any work, so it answers NOT_FOUND
      // anywhere the flag is not exactly "true"; the token is 32 CSPRNG bytes
      // matched by hash; and it is single-use, expiring and revocable.
      // Added to this list deliberately, which is the point of the list.
      'auth.redeemTestLoginLink',
      'auth.requestPasswordReset',
      'auth.resetPassword',
      'auth.signIn',
      'auth.signInDummy',
      'auth.signUp',
      // The plan catalogue: prices a signed-out visitor must be able to read.
      'billing.plans',
      // The public marketplace: product catalogue and vendor directory.
      'marketplace.categories',
      // ADMIN-CURATED FEATURED PROVIDERS, the editorial counterpart to the
      // paid strip below. Public for the same reason and on the same terms:
      // it returns the directory's own column allowlist plus the category the
      // pick was made in, resolved through the directory's own visibility
      // filter. It carries no granter, no period, no reason and no billing
      // state - those stay behind marketplace.manage. It reached the public
      // surface without being written down here, which is exactly the drift
      // this list exists to catch.
      'marketplace.featuredProviders',
      'marketplace.featuredVendors',
      'marketplace.get',
      'marketplace.importTemplate',
      'marketplace.list',
      // Real platform counts for the landing and sign-up pages, which are
      // both seen while logged out. It returns four aggregate numbers and no
      // row, no id and nothing about any individual - see
      // server/platformStats.ts. It replaced four hardcoded marketing figures.
      'marketplace.platformStats',
      'marketplace.questions',
      // The sponsored strip above the vendors directory. Public because the
      // directory it sits above is public, and because it exposes strictly
      // LESS than that directory already does: the same vendor cards, from the
      // same visibility filter, plus a label saying the placement is sponsored.
      // It carries no sponsorship reason, no granter, no period and no
      // subscription state - those live behind marketplace.manage.
      'marketplace.sponsoredVendors',
      'marketplace.vendorCategories',
      // One vendor's published catalogue, for the vendor detail page. Public
      // for the same reason marketplace.list is: it is the shop window.
      'marketplace.vendorProducts',
      'marketplace.vendors',
      // A vendor's public reputation, shown on their profile.
      'reviews.forUser',
      'reviews.statsForUser',
    ]);
  });

  it('every admin procedure is behind an administrator tier', () => {
    // Was "every admin procedure uses adminProcedure", which described a world
    // where admin was one all-or-nothing flag. Each endpoint now sits behind the
    // PERMISSION it needs, so the assertion is that every one of them is behind
    // an administrator tier of some kind - and, below, that the right one.
    const adminProcedures = Array.from(TIERS.entries()).filter(([name]) => name.startsWith('admin.'));
    expect(adminProcedures.length).toBeGreaterThan(30);
    const ungated = adminProcedures.filter(([, tier]) =>
      tier !== 'adminProcedure' && tier !== 'superAdminProcedure' && !tier.startsWith('adminWith('));
    // completeInvitation is the sole exception: it is how an invited user sets
    // their first password, so it cannot require a session.
    expect(ungated.map(([name]) => name)).toEqual(['admin.completeInvitation']);
  });

  it('the endpoints that shape administrator authority are SUPER ADMIN only', () => {
    // The whole least-privilege claim rests on this list. If any of these ever
    // drops to a lesser tier, a sub-admin can grant themselves authority and
    // every other guarantee in this file becomes decorative.
    for (const name of [
      'admin.admins', 'admin.createAdmin', 'admin.setAdminRole', 'admin.setAdminActive',
      'admin.revokeAdminSessions', 'admin.resetAdminPassword',
      'admin.adminInvitations', 'admin.revokeAdminInvitation',
    ]) {
      expect(TIERS.get(name), name).toBe('superAdminProcedure');
    }
  });

  it('superAdminProcedure is exactly the admins.manage permission, held by one role', () => {
    // Guards the indirection: superAdminProcedure is only meaningful because
    // `admins.manage` belongs to SUPER_ADMIN alone. Both halves are asserted so
    // neither can drift without this failing.
    expect(ROUTERS).toContain("const superAdminProcedure = adminWith('admins.manage')");
    const holders = ADMIN_ROLES.filter(role => ADMIN_ROLE_PERMISSIONS[role].includes('admins.manage'));
    expect(holders).toEqual(['SUPER_ADMIN']);
  });

  it('an administrator may change only their OWN password, and takes no target id', () => {
    // changeOwnPassword is adminProcedure rather than superAdminProcedure on
    // purpose - everyone may do it for themselves. What stops it becoming a way
    // to seize another account is that it accepts no userId at all.
    expect(TIERS.get('admin.changeOwnPassword')).toBe('adminProcedure');
    const body = procedureBody('admin.changeOwnPassword');
    expect(body).toContain('eq(users.id, ctx.user.id)');
    expect(body, 'changeOwnPassword must not accept a target').not.toMatch(/userId:\s*z\.number/);
  });

  it('every compliance procedure is gated on complianceProcedure', () => {
    const compliance = Array.from(TIERS).filter(([name]) => name.startsWith('registration.'));
    expect(compliance.length).toBeGreaterThan(0);
    for (const [name, tier] of compliance) expect(tier, name).toBe('complianceProcedure');
  });

  it('registrationRouter is MOUNTED at compliance.* — the reachable path', () => {
    // The export is registrationRouter but appRouter mounts it as `compliance`,
    // so `registration.uploadDocument` is a 404. Worth pinning: a verification
    // harness that probes the export name tests nothing and reports a pass.
    expect(ROUTERS).toContain('compliance: registrationRouter,');
  });

  it('the vendor-only surfaces require an APPROVED provider', () => {
    expect(TIERS.get('analytics.myStats')).toBe('approvedProviderProcedure');
    expect(TIERS.get('profile.myCategories')).toBe('approvedProviderProcedure');
    expect(TIERS.get('profile.setMyCategories')).toBe('approvedProviderProcedure');
  });

  it('self-scoped read-only surfaces need only a session', () => {
    // billing.myEnquiryUsage and profile.uploadAvatar are protectedProcedure
    // rather than approvedProvider, and that is correct: both are keyed
    // entirely on ctx.user.id, so a non-provider calling them reads their own
    // empty usage or replaces their own avatar. Requiring approval would gate
    // nothing and would break avatars for homeowners.
    expect(TIERS.get('billing.myEnquiryUsage')).toBe('protectedProcedure');
    expect(procedureBody('billing.myEnquiryUsage')).toContain('getEnquiryUsage(ctx.user.id)');
    expect(TIERS.get('profile.uploadAvatar')).toBe('protectedProcedure');
  });
});

// ── §2 The defects this sweep found ────────────────────────────────────────

describe('§2 rfq.list — the one that mattered', () => {
  it('REGRESSION: is protected, not public', () => {
    // It returned select().from(rfqs) - EVERY column of the 50 most recent RFQs
    // including the homeowner's `budget` - to anyone with no account at all,
    // while rfq.get beside it had always been protected.
    expect(TIERS.get('rfq.list')).toBe('protectedProcedure');
  });

  it('rfq.get and rfq.myList remain protected', () => {
    expect(TIERS.get('rfq.get')).toBe('protectedProcedure');
    expect(TIERS.get('rfq.myList')).toBe('protectedProcedure');
  });

  it('REGRESSION: being protected was never enough - the feed drops `attachments`', () => {
    // "Protected" only means "has an account", and an account costs one sign-up.
    // Proven against a live server with a brand-new unapproved contractor:
    //   rfq.eligible     FORBIDDEN
    //   rfq.openEnquiry  FORBIDDEN
    //   rfq.list         ALLOWED - 50 rows, every column
    //
    // `attachments` holds the URLs of the requester's own uploads - drawings,
    // BOQs, site photos - and RFQPage renders them inline for every RFQ in the
    // feed, so every signed-in account held direct links to every requester's
    // files. Owners still receive their own through myList, which is scoped by
    // requesterId.
    const body = procedureBody('rfq.list');
    expect(body, 'rfq.list must not select whole rows').not.toMatch(/select\(\)\s*\.from\(rfqs\)/);
    expect(body, 'the feed is back to leaking attachment URLs').not.toContain('attachments');
    // Guard: if this stops looking like an allowlist the assertions above go vacuous.
    expect(body, 'rfq.list no longer uses a column allowlist').toContain('title: rfqs.title');
  });

  it('REGRESSION: rfq.get is scoped to the requester, not merely to "logged in"', () => {
    // It had no ownership check at all - any authenticated caller could read any
    // RFQ's entire row by id, attachments included. That is the same detail
    // openQualifiedEnquiry gates behind approval, declared categories, a billing
    // entitlement and one credit per lead enforced by a unique index, so this
    // single procedure made the whole mechanism optional for anyone willing to
    // guess an integer. It had no callers in the client.
    const body = procedureBody('rfq.get');
    expect(body).toContain('eq(rfqs.requesterId, ctx.user.id)');
    expect(body).toContain('NOT_FOUND');
  });

  it('the paid enquiry path is still the only way to full detail', () => {
    // If a future change re-widens rfq.get or rfq.list, the credit stops meaning
    // anything. openEnquiry must remain approval-gated.
    expect(TIERS.get('rfq.openEnquiry')).toBe('approvedProviderProcedure');
    expect(TIERS.get('rfq.eligible')).toBe('approvedProviderProcedure');
  });

  it('the client gates the query so signed-out visitors are not bounced to /auth', () => {
    // The lesson from the Slice 2 pricing page: an UNAUTHORIZED anywhere in the
    // app triggers a global redirect, so a protected query on a page a
    // signed-out visitor can reach must be gated, not merely allowed to fail.
    for (const page of ['../client/src/pages/RFQPage.tsx', '../client/src/pages/RolePlatform.tsx']) {
      const source = read(page);
      const call = source.slice(source.indexOf('trpc.rfq.list.useQuery'));
      expect(call.slice(0, 120), page).toContain('enabled: isAuthenticated');
    }
  });
});

describe('§2b marketplace', () => {
  it('REGRESSION: marketplace.get does not serve a deactivated product', () => {
    // `list` filtered active=true; `get` did not, so a product the supplier had
    // withdrawn stayed fully readable by id.
    const body = procedureBody('marketplace.get');
    expect(body).toContain('eq(products.active, true)');
  });

  it('REGRESSION: marketplace.questions does not expose askerId', () => {
    // A PUBLIC endpoint returning a bare select, so anyone could walk the
    // catalogue and collect the user id of every buyer who asked anything.
    const body = codeOnly(procedureBody('marketplace.questions'));
    expect(body).not.toContain('select().from(productQuestions)');
    expect(body).toContain('question: productQuestions.question');
    expect(body).not.toMatch(/askerId/);
  });

  it('a supplier only ever sees their own products', () => {
    expect(procedureBody('marketplace.myProducts')).toContain('eq(products.supplierId, ctx.user.id)');
  });

  it('creating a product takes the seller from the session, never from input', () => {
    const body = procedureBody('marketplace.create');
    expect(body).toContain('supplierId: ctx.user.id');
    expect(body).not.toContain('supplierId: input');
  });

  it('REGRESSION: askQuestion applies the SAME predicate as marketplace.get', () => {
    // Found by walking the 62 id-taking procedures against their siblings.
    // askQuestion read `if (!product && input.productId > 10) throw NOT_FOUND`.
    //
    // Two defects on one line. The `> 10` was a leftover accommodation for the
    // static mock catalogue, and left ids 1-10 unvalidated - which the RESTRICT
    // foreign key on productQuestions.productId then turns into a 500 rather
    // than a 404. And `active` was never checked at all, so a question could be
    // attached to a product the supplier had withdrawn, contradicting the Slice
    // 9 decision above that withdrawn and absent are the same answer.
    // codeOnly, because the comment that replaced the defect quotes it.
    const body = codeOnly(procedureBody('marketplace.askQuestion'));
    expect(body).not.toMatch(/productId > \d/);
    expect(body).toContain('eq(products.active, true)');
    expect(body).toContain("code: 'NOT_FOUND'");
  });

  it('no id-taking marketplace procedure keeps a numeric escape hatch', () => {
    // The general form of the defect: a threshold on an id that decides whether
    // validation applies at all. Nothing in this router should have one.
    for (const name of ['marketplace.get', 'marketplace.questions', 'marketplace.askQuestion']) {
      expect(codeOnly(procedureBody(name)), name).not.toMatch(/input\.\w*[Ii]d [<>]=? \d/);
    }
  });
});

describe('§2c messages', () => {
  it('REGRESSION: sharing a quotation requires being a party to it', () => {
    // The old check confirmed only that the id EXISTED, which turned the
    // "Quote ID" box into an oracle for enumerating the marketplace's bids.
    const body = procedureBody('messages.send');
    expect(body).toContain('quotations.providerId');
    expect(body).toContain('rfqs.requesterId');
    expect(body).toContain('ctx.user.id');
  });

  it('a stranger and a non-existent quotation get the SAME answer', () => {
    // Otherwise the oracle just moves one step along: FORBIDDEN would still
    // confirm the id is real.
    const body = procedureBody('messages.send');
    const guard = body.slice(body.indexOf('if (!quotation'));
    expect(guard.slice(0, 200)).toContain("code: 'NOT_FOUND'");
    expect(guard.slice(0, 200)).not.toContain('FORBIDDEN');
  });

  it('the sender is taken from the session', () => {
    expect(procedureBody('messages.send')).toContain('senderId: ctx.user.id');
  });

  it('conversations and list are scoped to the caller on both sides', () => {
    for (const name of ['messages.conversations', 'messages.list']) {
      expect(procedureBody(name), name).toContain('ctx.user.id');
    }
  });

  it('REGRESSION: the attachment filename regex no longer mangles every name', () => {
    // It read [^\\w.-] - a double backslash inside a regex literal - so the
    // negated set was {backslash, w, dot, hyphen} and every ordinary letter was
    // replaced. "site-plan.pdf" became "_-_._".
    // In the SOURCE text the broken form is the four characters [^\\w — a
    // literal backslash-backslash inside a regex literal.
    expect(ROUTERS_CODE.includes('[^' + String.fromCharCode(92, 92) + 'w.-]')).toBe(false);
    // And the correct single-backslash form is there, once per endpoint that
    // uses it: project documents, RFQ attachments, message attachments,
    // product images (the supplier catalogue), and QUOTATION attachments -
    // the fifth, added when a supplier gained the ability to send a proposal
    // or certificate with a bid.
    // SIX since provider portfolio images gained their own upload endpoint,
    // which sanitises its filename with the same corrected pattern.
    expect((ROUTERS_CODE.match(/\[\^\\w\.-\]\+/g) ?? []).length).toBe(6);
  });
});

describe('§2d self-scoped procedures take no target id', () => {
  it('notifications are read and marked only for the caller', () => {
    for (const name of ['notifications.list', 'notifications.unreadCount', 'notifications.markAllRead']) {
      const body = procedureBody(name);
      expect(body, name).toContain('eq(notifications.userId, ctx.user.id)');
      expect(body, name).not.toContain('input.userId');
    }
  });

  it('profile.update and profile.getOwn have no userId field to populate', () => {
    for (const name of ['profile.update', 'profile.getOwn']) {
      expect(procedureBody(name), name).not.toContain('userId');
    }
  });

  it('registration reads and writes only the caller\'s own application', () => {
    for (const name of ['registration.requirements', 'registration.uploadDocument']) {
      const body = procedureBody(name);
      expect(body, name).toContain('ctx.user.id');
      expect(body, name).not.toContain('input.userId');
    }
  });

  it('analytics.myStats is scoped to the caller as the provider', () => {
    expect(procedureBody('analytics.myStats')).toContain('eq(quotations.providerId, ctx.user.id)');
  });
});

// ── §3 Upload content-type verification (audit item A10) ───────────────────

describe('§3 uploads are checked against their bytes', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const pdf = Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1');
  const gif = Buffer.from('GIF89a________', 'latin1');
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const html = Buffer.from('<!doctype html><script>alert(1)</script>');

  it('recognises the formats BuildHub stores', () => {
    expect(sniffContentType(png)).toBe('image/png');
    expect(sniffContentType(jpeg)).toBe('image/jpeg');
    expect(sniffContentType(pdf)).toBe('application/pdf');
    expect(sniffContentType(gif)).toBe('image/gif');
    expect(sniffContentType(webp)).toBe('image/webp');
  });

  it('accepts a file whose bytes match its declaration', () => {
    expect(checkUploadedFile('image/png', png, DOCUMENT_TYPES)).toBeNull();
    expect(checkUploadedFile('application/pdf', pdf, DOCUMENT_TYPES)).toBeNull();
  });

  it('THE ONE THAT MATTERS: refuses SVG however it is labelled', () => {
    // image/svg+xml satisfies every startsWith('image/') check in the codebase,
    // and SVG is a scriptable XML document, not a picture.
    expect(checkUploadedFile('image/svg+xml', svg, DOCUMENT_TYPES)?.reason).toBe('refused');
    // And relabelling it as PNG does not get it through either - the bytes are
    // not a PNG.
    expect(checkUploadedFile('image/png', svg, DOCUMENT_TYPES)?.reason).toBe('unrecognised');
  });

  it('refuses HTML, relabelled or not', () => {
    expect(checkUploadedFile('text/html', html, DOCUMENT_TYPES)?.reason).toBe('refused');
    expect(checkUploadedFile('image/jpeg', html, DOCUMENT_TYPES)?.reason).toBe('unrecognised');
  });

  it('refuses a real file whose declared type is simply wrong', () => {
    // The boring case, which breaks rendering rather than security: a PDF
    // uploaded as an image is stored with a Content-Type that will not display.
    const problem = checkUploadedFile('image/png', pdf, DOCUMENT_TYPES);
    expect(problem?.reason).toBe('mismatch');
    expect(problem?.message).toContain('application/pdf');
  });

  it('an image-only endpoint refuses a genuine PDF', () => {
    expect(checkUploadedFile('application/pdf', pdf, IMAGE_TYPES)?.reason).toBe('mismatch');
    expect(checkUploadedFile('image/png', png, IMAGE_TYPES)).toBeNull();
  });

  it('refuses empty and truncated files rather than storing them', () => {
    expect(checkUploadedFile('image/png', Buffer.alloc(0), DOCUMENT_TYPES)?.reason).toBe('unrecognised');
    expect(checkUploadedFile('image/png', Buffer.from([0x89, 0x50]), DOCUMENT_TYPES)?.reason).toBe('unrecognised');
  });

  it('tolerates a charset parameter and odd casing in the declaration', () => {
    expect(checkUploadedFile('IMAGE/PNG', png, DOCUMENT_TYPES)).toBeNull();
    expect(checkUploadedFile('application/pdf; charset=binary', pdf, DOCUMENT_TYPES)).toBeNull();
  });

  it('EVERY upload endpoint verifies its bytes, not just the risky-looking one', () => {
    // The invariant is "no storagePut without byte verification first", not a
    // particular count - so this counts BOTH verified paths and requires them
    // to cover every put. AI attachments went through validateAiAttachment
    // rather than assertUploadedFileMatches (it returns a typed rejection
    // instead of throwing), and a test that counted only the latter would have
    // read a genuinely-verified sixth endpoint as an unverified one.
    // COUNTS THE WRAPPER NOW. Every upload site moved to
    // `storagePutOrUnavailable`, so that an unconfigured deployment answers
    // 503 with a readable reason instead of a generic 500 - the invariant this
    // test protects is unchanged, only the name of the call it counts.
    const puts = (ROUTERS.match(/await storagePutOrUnavailable\(/g) ?? []).length;
    // Minus one for the helper's own definition.
    const asserted = (ROUTERS.match(/assertUploadedFileMatches\(/g) ?? []).length - 1;
    const validated = (ROUTERS.match(/validateAiAttachment\(/g) ?? []).length;

    // SEVEN, not six: uploadProductImage joined the set when the supplier
    // catalogue gained image management. The number is asserted rather than
    // ranged so that adding an eighth upload path is a deliberate edit here
    // and not something that slips in unvalidated.
    // EIGHT since a supplier gained the ability to attach a proposal, a
    // specification, a certificate or a photograph to their quotation - the
    // eighth upload path, and the first that flows provider -> customer.
    // NINE since provider portfolio images became an upload path of their own.
    // Verified before the number was moved: `asserted + validated` is 9 too, so
    // the ninth site is genuinely byte-checked and this is a stale counter
    // rather than an unguarded endpoint. The equality below is the real
    // invariant; the count exists so a NEW path cannot arrive unnoticed.
    expect(puts).toBe(9);
    expect(asserted + validated).toBe(puts);
  });

  it('the AI attachment validator is a NARROWING of the shared gate, not a second one', () => {
    // If validateAiAttachment ever stopped delegating to checkUploadedFile it
    // would become a parallel security system with its own bugs - which is the
    // exact thing the sweep above exists to prevent.
    const source = read('./_core/aiAttachments.ts');
    expect(source).toContain('checkUploadedFile');
    expect(source).toContain('AI_ATTACHMENT_TYPES');
  });

  it('the avatar endpoint accepts images only, never PDFs', () => {
    const body = procedureBody('profile.uploadAvatar');
    expect(body).toContain('IMAGE_TYPES');
  });
});
