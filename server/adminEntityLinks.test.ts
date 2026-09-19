// ── A NAME IN THE ADMIN CONSOLE IS A WAY INTO THE RECORD ───────────────────
//
// Nineteen admin surfaces render a person or a business by name. Six made that
// name a link to the account; thirteen printed it as text, so an administrator
// reading a support ticket, a sponsorship, an audit line or a product listing
// had the name in front of them and no way to act on it - they went back to
// User Management and searched for it again, or worked from the row id.
//
// The six that DID link had each written the link themselves, in four
// different spellings, two of them `<button onClick={navigate}>` rather than
// anchors - so the same idea behaved differently screen to screen and only
// some of them could be middle-clicked or opened in a new tab.
//
// This file holds two rules:
//
//   ONE PRIMITIVE. Nothing outside AdminEntityLink.tsx builds an
//   /admin/users/<id> destination by hand.
//
//   NO IDENTITY IS A DEAD END. Every surface that shows who somebody is
//   offers the way to their record, or appears below with a reason.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const CLIENT = new URL('../client/src/', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, CLIENT), 'utf8');

function clientFiles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: URL, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) { walk(child, `${prefix}${entry.name}/`); continue; }
      if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) continue;
      out.push({ path: `${prefix}${entry.name}`, text: readFileSync(child, 'utf8') });
    }
  };
  walk(CLIENT, '');
  return out;
}

/** Admin surfaces: the console's own screens. */
const adminSurfaces = () => clientFiles()
  .filter(f => /^(components|pages)\/Admin\w+\.tsx$/.test(f.path));

describe('the destination is built in ONE place', () => {
  it('the primitive exists and is an anchor, not a navigate() call', () => {
    const source = read('components/AdminEntityLink.tsx');
    expect(source).toContain('export function AdminUserLink(');
    expect(source).toContain("href={`/admin/users/${id}`}");
    // A button that navigates cannot be middle-clicked, opened in a new tab or
    // copied as a link. Two of the surfaces this replaced were exactly that.
    expect(source, 'the primitive navigates imperatively').not.toContain('navigate(');
  });

  it('WOUTER RENDERS ITS OWN <a>, so nothing nests another inside', () => {
    // Nesting produces invalid HTML and an element with no href - a link that
    // is decorative without anybody noticing. This codebase has shipped that
    // defect before.
    //
    // MEASURED ON THE JSX, NOT THE FILE. The first version matched the
    // component's own doc comment, which explains this rule in prose and
    // therefore contains the two tags in order - the test failed on the
    // sentence describing the thing it was checking for.
    const source = read('components/AdminEntityLink.tsx');
    const jsx = source.slice(source.indexOf('export function AdminUserLink'));
    expect(jsx).not.toMatch(/<Link[^>]*>[\s\S]*?<a\b/);
  });

  it('NOBODY BUILDS THE DESTINATION BY HAND ANY MORE', () => {
    const offenders = clientFiles()
      .filter(f => f.path !== 'components/AdminEntityLink.tsx')
      // The search destination map is the other legitimate holder of routes,
      // and adminSearchDestinations.test.ts governs it.
      .filter(f => f.path !== 'lib/adminSearchDestinations.ts')
      .filter(f => /\/admin\/users\/\$\{/.test(f.text))
      .map(f => f.path);
    expect(offenders, `these construct the destination themselves:\n  ${offenders.join('\n  ')}`)
      .toEqual([]);
  });

  it('and the census can still SEE such a construction - otherwise it is vacuous', () => {
    // POSITIVE CONTROL for the rule above.
    const planted = 'href={`/admin/users/${somebody.id}`}';
    expect(/\/admin\/users\/\$\{/.test(planted)).toBe(true);
  });
});

/**
 * SURFACES THAT SHOW AN IDENTITY AND DELIBERATELY DO NOT LINK IT.
 *
 * Each with its reason, so the omission is a decision somebody wrote down
 * rather than one nobody noticed.
 */
const IDENTITY_NOT_LINKED: Readonly<Record<string, string>> = {
  'pages/AdminUserDetail.tsx':
    'THIS IS the record. The name and company it shows belong to the account whose '
    + 'page you are already on, and a link from a page to itself is not a way in.',
  'components/AdminRegistrations.tsx':
    'the applicant name sits inside a <label> whose click toggles a bulk-select checkbox; '
    + 'a link there would fight the control. The applicant opens through openApplicant, '
    + 'which is the registration review surface and the right destination for this screen.',
  'components/AdminPlacements.tsx':
    'the placed entity links to its PUBLIC page on purpose - an administrator judging a '
    + 'placement wants what a customer sees. The account is not what this row is about.',
  'components/AdminRfqInvestigation.tsx':
    'a read-only reconstruction of one request, Super Admin only. Every party is listed '
    + 'with its id as technical evidence for the investigation, not as a workflow.',
  'components/AdminEnquiryAllowance.tsx':
    'the vendor is CHOSEN here by a typeahead and then acted on in place; the name is the '
    + 'search result being picked, not a record to navigate away to.',
};

describe('no identity is a dead end', () => {
  it('every admin surface that shows a person links them, or is listed with a reason', () => {
    const offenders = adminSurfaces()
      .filter(f => !(f.path in IDENTITY_NOT_LINKED))
      // Shows an identity: a name field that belongs to a person or a business.
      .filter(f => /\b(userName|ownerName|vendorName|supplierName|requesterName|reporterName|actorName|referrerName|referredName|recipientName|assigneeName|companyName)\b/.test(f.text))
      // USED AS AN ELEMENT, not merely imported. Replacing the one call with
      // a <span> left the import line behind, and a census looking for the
      // NAME passed on that - the same "observed but not acted on" shape this
      // codebase keeps finding.
      .filter(f => !/<AdminUserLink\b/.test(f.text))
      .map(f => f.path);
    expect(offenders, `these show who somebody is and offer no way to them:\n  ${offenders.join('\n  ')}`)
      .toEqual([]);
  });

  it('the exemption list is live - an entry that no longer shows an identity must go', () => {
    // Otherwise the list becomes a place to put things, and the next real gap
    // hides behind a stale name.
    const stale = Object.keys(IDENTITY_NOT_LINKED).filter(rel => {
      const text = read(rel);
      return !/\b(userName|ownerName|vendorName|supplierName|requesterName|name)\b/.test(text);
    });
    expect(stale, `no longer relevant:\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('the sweep reads real admin surfaces', () => {
    // POSITIVE CONTROL. A broken walk makes every assertion above pass.
    const paths = adminSurfaces().map(f => f.path);
    expect(paths.length).toBeGreaterThan(12);
    expect(paths).toContain('components/AdminSupportTickets.tsx');
    expect(paths).toContain('components/AdminAuditTrail.tsx');
  });
});

describe('an identity with no id is not rendered as a control', () => {
  it('the primitive refuses to link what it cannot address', () => {
    const source = read('components/AdminEntityLink.tsx');
    // A system action has no actor; a deleted subject has no row. Rendering a
    // link there is a dead control, which reads as a broken product.
    expect(source).toContain('id === null || id === undefined');
    expect(source).toContain('id <= 0');
  });
});

describe('the referred party is a person, not a number', () => {
  const VIEW = readFileSync(new URL('../server/referralRewardView.ts', import.meta.url), 'utf8');

  it('the ledger reads the referred user, not only the referrer', () => {
    // The admin ledger could only print `#4127` for the person who was
    // referred, because the query joined `users` for the referrer alone -
    // in a file whose own comment states the human-first rule for campaigns.
    expect(VIEW).toContain("const referredUser = alias(users, 'referredUser')");
    expect(VIEW).toContain('referredName: referredUser.name');
    expect(VIEW).toContain('.leftJoin(referredUser, eq(referredUser.id, referrals.referredId))');
  });

  it('LEFT joined, so a referral row cannot vanish because of a name lookup', () => {
    expect(VIEW, 'an inner join would drop rows this read must return')
      .not.toContain('.innerJoin(referredUser');
  });

  it('and the screen shows the name rather than the id', () => {
    const referrals = read('components/AdminReferrals.tsx');
    expect(referrals).toContain('name={row.referredName}');
    expect(referrals, 'the raw id is back as the whole identity')
      .not.toMatch(/>\s*#\{row\.referredId\}\s*</);
  });
});

// ── AND THE ACT THAT LEFT NO TRACE ────────────────────────────────────────
//
// Found by a probe, not by reading code: the probe performed a real
// administrative action so the audit trail would have a row to render, and the
// row never arrived. `admin.verifyUser` changed `users.verified` and recorded
// nothing, while its nine neighbours over the same table all record.
//
// It is the worst one to have missed. The flag decides whether a provider is
// listed in the marketplace at all, and setting it qualifies a referral, which
// can grant a reward - so the platform could hand out a benefit with no record
// of the decision that triggered it.

describe('every administrative change to an account is recorded', () => {
  const ROUTERS = readFileSync(new URL('../server/routers.ts', import.meta.url), 'utf8');
  const AUDIT = readFileSync(new URL('../server/_core/accountAudit.ts', import.meta.url), 'utf8');

  /** Each privileged mutation over `users`, paired with its body. */
  function userMutations(): { name: string; body: string }[] {
    const out: { name: string; body: string }[] = [];
    const header = /^ {2}(\w+): (adminWith\('users\.manage'\)|superAdminProcedure)/gm;
    for (const match of ROUTERS.matchAll(header)) {
      const start = match.index ?? 0;
      const rest = ROUTERS.slice(start + 10);
      const next = /^ {2}\w+: (publicProcedure|protectedProcedure|adminProcedure|superAdminProcedure|approvedProviderProcedure|complianceProcedure|adminWith\()/m.exec(rest);
      const body = ROUTERS.slice(start, start + 10 + (next ? next.index : 4000));
      if (!body.includes('.mutation(')) continue;
      if (!/db\.update\(users\)|db\.insert\(users\)|db\.delete\(users\)/.test(body)) continue;
      out.push({ name: match[1], body });
    }
    return out;
  }

  it('the sweep finds the real mutations', () => {
    // POSITIVE CONTROL - without it a broken regex passes everything below.
    const names = userMutations().map(m => m.name);
    expect(names.length).toBeGreaterThan(6);
    expect(names).toContain('verifyUser');
    expect(names).toContain('setUserFrozen');
  });

  it('NONE OF THEM CHANGES AN ACCOUNT SILENTLY', () => {
    const silent = userMutations()
      .filter(m => !m.body.includes('recordAccountEvent'))
      .map(m => m.name);
    expect(silent, `these write to users and record nothing:\n  ${silent.join('\n  ')}`)
      .toEqual([]);
  });

  it('verification has its own vocabulary, both directions', () => {
    // Removing verification is as consequential as granting it - a provider
    // disappears from the marketplace - so it is its own recorded act rather
    // than an absence of one.
    expect(AUDIT).toContain("'account_verified'");
    expect(AUDIT).toContain("'account_unverified'");
    const verify = userMutations().find(m => m.name === 'verifyUser');
    expect(verify?.body).toContain("action: input.verified ? 'account_verified' : 'account_unverified'");
    // The subject and the actor are different people and both are recorded.
    expect(verify?.body).toContain('userId: input.userId');
    expect(verify?.body).toContain('actorId: ctx.user.id');
  });
});

// ── AN IDENTITY LINK INSIDE ANOTHER LINK IS A DEAD CONTROL ────────────────
//
// The rollout above replaced thirteen printed names with AdminUserLink. Three
// of those names were ALREADY links - to the public vendor page - and the
// replacement went INSIDE the existing anchor rather than instead of it:
//
//   <Link href={`/vendor/${id}`}>      <- kept, and now wraps
//     <AdminUserLink id={id} ... />    <- which renders its own <a>
//   </Link>
//
// Wouter's <Link> renders an <a>, so this is an anchor nested in an anchor:
// invalid HTML, two tab stops where a reader expects one, and two different
// destinations behind the same pixels. Proved in a browser rather than argued
// about: on /admin/placements the two anchors measured 34x36 with IDENTICAL
// centres, elementFromPoint over the name returned the INNER anchor, and the
// click landed on /admin/users/174. The outer /vendor/174 link was covered in
// every pixel - dead, and silently so, which is exactly what the primitive's
// own header warns about.
//
// Resolved toward the canonical record, which is what the rollout was for.
// Nothing is lost: the record page carries its own way out to the vendor page.
//
// A rendered sweep found ONE of the three, because the other two surfaces had
// no rows to draw that day. This one reads the source, so it does not depend
// on which fixtures happen to exist.
describe('no identity link is nested inside another control', () => {
  const NESTED = /<(?:Link|a|button)\b[^>]*>\s*<AdminUserLink\b/g;

  it('the sweep can see a nesting when there is one', () => {
    // POSITIVE CONTROL. Without it, a regex that matches nothing passes.
    const sample = '<Link href={`/vendor/${id}`} className="x">\n  <AdminUserLink id={id} />\n</Link>';
    expect(sample.replace(/\n\s*/g, ' ').match(NESTED)).not.toBeNull();
  });

  it('no admin surface wraps one', () => {
    const nested = clientFiles()
      .map(f => ({ path: f.path, hits: f.text.replace(/\n\s*/g, ' ').match(NESTED) ?? [] }))
      .filter(f => f.hits.length > 0)
      .map(f => `${f.path} (${f.hits.length})`);
    expect(nested, `an identity link inside another control is a dead control:\n  ${nested.join('\n  ')}`)
      .toEqual([]);
  });
});
