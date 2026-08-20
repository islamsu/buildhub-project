import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

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
    const procedureMatch = /^ {2}(\w+):\s*(publicProcedure|protectedProcedure|adminProcedure|approvedProviderProcedure|complianceProcedure)/.exec(line);
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
  const rest = block.slice(start + 3);
  const nextMatch = /\n {2}(?:\/\/[^\n]*\n {2})*\w+:\s*(?:public|protected|admin|approvedProvider|compliance)Procedure/.exec(rest);
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
      'auth.capabilities',
      'auth.checkSignupAvailability',
      'auth.logout',
      'auth.me',
      'auth.requestPasswordReset',
      'auth.resetPassword',
      'auth.signIn',
      'auth.signInDummy',
      'auth.signUp',
      // The plan catalogue: prices a signed-out visitor must be able to read.
      'billing.plans',
      // The public marketplace: product catalogue and vendor directory.
      'marketplace.categories',
      'marketplace.featuredVendors',
      'marketplace.get',
      'marketplace.list',
      'marketplace.questions',
      'marketplace.vendorCategories',
      'marketplace.vendors',
      // A vendor's public reputation, shown on their profile.
      'reviews.forUser',
      'reviews.statsForUser',
    ]);
  });

  it('every admin procedure uses adminProcedure', () => {
    const adminProcedures = Array.from(TIERS.entries()).filter(([name]) => name.startsWith('admin.'));
    const notAdmin = adminProcedures.filter(([, tier]) => tier !== 'adminProcedure');
    // completeInvitation is the sole exception: it is how an invited user sets
    // their first password, so it cannot require a session.
    expect(notAdmin.map(([name]) => name)).toEqual(['admin.completeInvitation']);
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
    // uses it (project documents, RFQ attachments, message attachments).
    expect((ROUTERS_CODE.match(/\[\^\\w\.-\]\+/g) ?? []).length).toBe(3);
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

  it('ALL FIVE upload endpoints verify their bytes, not just the risky-looking one', () => {
    // Minus one for the helper's own definition.
    const calls = ROUTERS.match(/assertUploadedFileMatches\(/g) ?? [];
    expect(calls.length - 1).toBe(5);
    // And every storagePut is preceded by one.
    const puts = ROUTERS.match(/await storagePut\(/g) ?? [];
    expect(puts.length).toBe(5);
  });

  it('the avatar endpoint accepts images only, never PDFs', () => {
    const body = procedureBody('profile.uploadAvatar');
    expect(body).toContain('IMAGE_TYPES');
  });
});
