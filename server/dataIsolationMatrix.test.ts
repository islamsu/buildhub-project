// ── The ownership matrix: every id-taking procedure, every resource ────────
//
// PHASE 1B asks for data isolation across resources, roles and verbs, and for
// explicit IDOR testing. The obvious reading - 16 resources x 6 roles x 9 verbs
// as 864 hand-written cases - would be mostly vacuous: most cells do not exist
// as endpoints, and the ones that do would be asserted by a list somebody has
// to remember to extend.
//
// So this file inverts it. It ENUMERATES every procedure in the router that
// accepts an id, and requires each one to fall into exactly one of three
// buckets:
//
//   OWNER-SCOPED   the id is constrained by ctx.user.id somewhere in the body,
//                  so naming someone else's row returns nothing or FORBIDDEN;
//   ADMIN-GATED    reaching it at all requires an administrator permission,
//                  which is a different control and is tested in
//                  adminAuthorization.test.ts;
//   DELIBERATELY SHARED  a marketplace surface that is supposed to serve rows
//                  the caller does not own - listed below BY NAME, each with
//                  the reason, so adding one is a deliberate act.
//
// A new endpoint that takes an id and belongs to none of the three fails here.
// That is the property worth having: not that today's 62 are right, but that
// tomorrow's 63rd cannot be quietly wrong.
//
// Behavioural IDOR probes live in the suites that own each router
// (projectsAuthorization, reviewsAuthorization, quotationWorkflow,
// rfqTargetingAuthorization, aiAttachments). This file is the census that says
// none of them was forgotten.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

function codeOnly(source: string): string {
  return source.split('\n')
    .filter(line => {
      const trimmed = line.trim();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

type Procedure = { qualified: string; tier: string; ids: string[]; body: string };

const NEXT_PROCEDURE = /\n {2}(?:\/\/[^\n]*\n {2})*\w+:\s*(?:(?:public|protected|admin|superAdmin|approvedProvider|compliance|aiChat)Procedure|adminWith\()/;

/** Every `name: someProcedure` in every router, with its body and any id inputs. */
function allProcedures(): Procedure[] {
  const found: Procedure[] = [];
  const lines = ROUTERS.split('\n');
  let router: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const routerMatch = /^const (\w+)Router = router\(\{/.exec(lines[i]);
    if (routerMatch) { router = routerMatch[1]; continue; }
    if (!router) continue;
    const declaration = /^ {2}(\w+): ((?:public|protected|admin|superAdmin|approvedProvider|compliance|aiChat)Procedure|adminWith\([^)]*\))/.exec(lines[i]);
    if (!declaration) continue;

    const start = ROUTERS.indexOf(`\n  ${declaration[1]}: ${declaration[2]}`);
    const rest = ROUTERS.slice(start + 3);
    const next = NEXT_PROCEDURE.exec(rest);
    const body = next ? ROUTERS.slice(start, start + 3 + next.index) : ROUTERS.slice(start);

    // The input schema is the first 12 lines; ids declared deeper belong to a
    // nested object and are still inputs, so scan the whole body's z. types.
    const ids = [...new Set([...body.matchAll(/(\w*[Ii]d): z\.(?:number|string|coerce)/g)].map(m => m[1]))];
    found.push({ qualified: `${router}.${declaration[1]}`, tier: declaration[2], ids, body });
  }
  return found;
}

/**
 * Surfaces that serve rows the caller does not own, ON PURPOSE.
 *
 * Every entry is a product decision that predates this file, and the reason is
 * recorded so that removing an entry is possible and adding one is visible.
 */
const DELIBERATELY_SHARED: Record<string, string> = {
  'marketplace.get':
    'The product catalogue is the shop window. Scoped instead by `active`: a withdrawn product is NOT_FOUND, same as an absent one.',
  'marketplace.vendorProducts':
    'One vendor\'s shop window, addressed by vendorId. Scoped by the same `active` predicate as marketplace.list, so it shows exactly the rows the catalogue already shows anyone - and a delisted product no more than the catalogue does.',
  'marketplace.questions':
    'Public Q&A on a public listing. Returns a column allowlist that omits askerId, so the thread cannot be walked back to the buyers.',
  'marketplace.askQuestion':
    'Anyone signed in may ask about any listed product. Scoped by the same `active` predicate as marketplace.get.',
  'reviews.forUser':
    'A vendor reputation nobody but the vendor could read would not be a reputation.',
  'reviews.statsForUser':
    'The aggregate behind the same public reputation - rating average and count, the numbers a buyer chooses a vendor on.',
  'profile.getPublic':
    'The public vendor profile. The name says it; the column list is what keeps it honest.',
  'rfq.openEnquiry':
    'Consuming a lead credit against an RFQ the vendor does not own is the point of the endpoint. Gated on approvedProvider and on category eligibility.',
  'rfq.submitQuotation':
    'Same: quoting on somebody else\'s RFQ is the marketplace working.',
  'rfq.summary':
    'One row from the OPEN FEED, addressed by id. Returns exactly the column allowlist rfq.list already gives every authenticated caller - and deliberately not `attachments`, which openQualifiedEnquiry charges a credit to reveal. An RFQ is addressed to providers; owner-scoping it would make a detail page impossible for the very people meant to respond.',
  'reviews.eligibleReviewees':
    'Answers "who on this project may I review", which is by definition about other people. Scoped by the project the caller is party to.',
};

/**
 * THE ONLY LEGITIMATE REASON TO FILTER BY SOMEONE ELSE'S OWNER COLUMN.
 *
 * "Show me everything vendor X sells" is a question about another account's
 * owner column by definition, and a vendor detail page cannot be written any
 * other way. It is safe ONLY when every row it can return is already public,
 * so an entry here is not a waiver: the test below re-reads the procedure and
 * fails unless it also constrains on the public predicate. Listing something
 * here that quietly returns private rows does not get it past this file.
 */
const PUBLIC_BY_OWNER: Record<string, { reason: string; mustAlsoConstrain: RegExp }> = {
  'marketplace.vendorProducts': {
    reason: 'One vendor\'s shop window. Every row it returns is already returned by marketplace.list to anyone at all; withholding it would only mean a vendor page that cannot show what the vendor sells.',
    mustAlsoConstrain: /eq\(products\.active,\s*true\)/,
  },
};

// Every procedure in every router...
const ALL_PROCEDURES = allProcedures();
// ...and the subset that accepts an id, which is what the ownership rule is about.
const PROCEDURES = ALL_PROCEDURES.filter(p => p.ids.length > 0);

describe('the census found the surface it is meant to police', () => {
  it('enumerates the id-taking procedures across every router', () => {
    // A scanner that matches nothing would pass every rule below.
    expect(ALL_PROCEDURES.length).toBeGreaterThanOrEqual(110);
    expect(PROCEDURES.length).toBeGreaterThanOrEqual(55);
    const names = PROCEDURES.map(p => p.qualified);
    for (const expected of [
      'projects.get', 'projects.updateTask', 'rfq.acceptQuotation', 'messages.send',
      'reviews.submit', 'ai.deleteAttachment', 'admin.setAdminRole', 'marketplace.get',
    ]) {
      expect(names, `${expected} missing from the census`).toContain(expected);
    }
  });

  it('every deliberately-shared entry still exists as a procedure', () => {
    // Otherwise the allowlist rots into a set of excuses for endpoints that
    // were renamed or deleted, and stops describing the real surface.
    const names = new Set(PROCEDURES.map(p => p.qualified));
    for (const entry of Object.keys(DELIBERATELY_SHARED)) {
      expect(names, `${entry} is allowlisted but no longer exists`).toContain(entry);
    }
  });

  it('an owner-column exception only holds if the procedure re-filters to the public rows', () => {
    // The exception is earned, not declared. If marketplace.vendorProducts
    // ever stops filtering on `active`, this fails and the procedure goes back
    // to being an offender.
    for (const [name, entry] of Object.entries(PUBLIC_BY_OWNER)) {
      const procedure = ALL_PROCEDURES.find(p => p.qualified === name);
      expect(procedure, `${name} is excepted but no longer exists`).toBeDefined();
      expect(entry.reason.length, `${name} needs a reason`).toBeGreaterThan(40);
      expect(
        entry.mustAlsoConstrain.test(codeOnly(procedure!.body)),
        `${name} filters by an owner id from the request but no longer restricts itself to publicly visible rows`,
      ).toBe(true);
    }
  });

  it('every allowlist entry carries a real reason, not a placeholder', () => {
    for (const [name, reason] of Object.entries(DELIBERATELY_SHARED)) {
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(40);
      expect(reason, name).not.toMatch(/^(todo|tbd|n\/a|see above)/i);
    }
  });
});

describe('every id-taking procedure is owner-scoped, admin-gated, or named', () => {
  const ADMIN_TIERS = /^(adminWith\(|superAdminProcedure|adminProcedure)/;

  for (const procedure of PROCEDURES) {
    it(`${procedure.qualified} (${procedure.ids.join(', ')})`, () => {
      if (ADMIN_TIERS.test(procedure.tier)) return;               // a different control
      if (procedure.qualified in DELIBERATELY_SHARED) return;      // named, with a reason

      const code = codeOnly(procedure.body);
      // Owner-scoping shows up one of three ways in this codebase: a predicate
      // on ctx.user.id, an insert that stamps ctx.user.id, or a delegation to
      // a helper that takes ctx.user.id as an argument.
      // Mentioning ctx.user.id is not enough - it could be an audit-log field
      // sitting next to an unscoped query. It has to appear where it decides
      // what the caller may touch. This codebase does that four ways, and the
      // first draft of this rule knew only two, which flagged three procedures
      // that are in fact correctly scoped. The rule was widened to match the
      // code rather than the code narrowed to match the rule:
      //
      //   1. inside a Drizzle predicate                 eq(projects.ownerId, ctx.user.id)
      //   2. as the value of a column being written     authorId: ctx.user.id
      //   3. FETCH THEN COMPARE                         if (row.ownerId !== ctx.user.id) throw
      //      - projects.updateTask and rfq.quotations use this because the
      //        owner lives one join away, and it makes not-found and
      //        not-yours fail identically, which is the point.
      //   4. passed to a helper that enforces it        rejectQuotationSecure(rfqId, id, ctx.user.id)
      const inPredicate = /(?:eq|and|or|inArray|ne)\([^;]*ctx\.user\.id/.test(code);
      const asColumnValue = /\w+:\s*ctx\.user\.id/.test(code);
      const comparedAgainst = /[!=]==?\s*ctx\.user\.id|ctx\.user\.id\s*[!=]==?/.test(code);
      const passedAsArgument = /[(,]\s*ctx\.user\.id\s*[,)]/.test(code);
      const inRawSql = /\$\{ctx\.user\.id\}/.test(code);
      const ownerScoped = inPredicate || asColumnValue || comparedAgainst || passedAsArgument || inRawSql;
      expect(
        ownerScoped,
        `${procedure.qualified} takes ${procedure.ids.join('/')} but never CONSTRAINS by ctx.user.id. `
        + 'Either scope it to the caller, or add it to DELIBERATELY_SHARED with the reason.',
      ).toBe(true);
    });
  }
});

/**
 * Procedures that legitimately take ANOTHER user's id from the request,
 * mapped to the caller-authorization each one must perform.
 *
 * Acting on somebody else is the whole feature here: a project owner or
 * manager puts a contractor on a job. The request names WHO to act on; the
 * session names who is ALLOWED to. Both halves are required, and the regex is
 * the second half made checkable.
 */
const TARGETS_ANOTHER_USER: Record<string, RegExp> = {
  'projects.addMember':    /requireProjectAccess\(db, input\.projectId, ctx\.user\.id, 'manage'\)/,
  'projects.removeMember': /requireProjectAccess\(db, input\.projectId, ctx\.user\.id, 'manage'\)/,
};

describe('an id is never trusted as a substitute for the session', () => {
  it('no non-admin procedure reads an owner id FROM THE REQUEST', () => {
    // The classic shape: `where(eq(projects.ownerId, input.userId))`. The
    // caller then names whose data to return, which is the whole defect.
    // Scanned over the WHOLE surface, not just the id-taking subset. The
    // first version of this test scanned only id-takers and a mutation walked
    // straight through it: `eq(projects.ownerId, input.ownerId ?? ctx.user.id)`
    // planted in projects.list, which takes no id, was never examined.
    const offenders: string[] = [];
    for (const procedure of ALL_PROCEDURES) {
      if (/^(adminWith\(|superAdminProcedure|adminProcedure)/.test(procedure.tier)) continue;
      const code = codeOnly(procedure.body);
      if (/eq\(\w+\.(ownerId|userId|senderId|authorId|supplierId|askerId|reviewerId|requesterId|providerId),[^)]*input\./.test(code)) {
        if (procedure.qualified in PUBLIC_BY_OWNER) continue;
        // A procedure whose PURPOSE is acting on somebody else - putting a
        // person on a project, taking them off it - necessarily names that
        // person in the request. That is a TARGET, not an identity, and the
        // difference is whether the CALLER is authorized from the session.
        //
        // This is not an exemption: the rule below is strictly stronger than
        // the one it replaces for these procedures. Remove the authorization
        // call and this test fails, which a bare allowlist entry would not do.
        const requiredCallerCheck = TARGETS_ANOTHER_USER[procedure.qualified];
        if (requiredCallerCheck) {
          expect(
            requiredCallerCheck.test(code),
            `${procedure.qualified} names another user in its input and MUST authorize the CALLER `
            + 'from the session in the same body. The session check is missing or was changed.',
          ).toBe(true);
          continue;
        }
        offenders.push(procedure.qualified);
      }
    }
    expect(offenders, 'ownership taken from the request instead of the session').toEqual([]);
  });

  it('no procedure writes an owner column from the request', () => {
    // Same defect on the write side: creating a row that claims to belong to
    // somebody else. `revieweeId` is excluded - a review names its SUBJECT,
    // and reviews.submit checks separately that the caller may review them.
    const offenders: string[] = [];
    for (const procedure of ALL_PROCEDURES) {
      if (/^(adminWith\(|superAdminProcedure|adminProcedure)/.test(procedure.tier)) continue;
      const code = codeOnly(procedure.body);
      if (/(ownerId|authorId|supplierId|askerId|reviewerId|senderId|requesterId|providerId):\s*input\./.test(code)) {
        offenders.push(procedure.qualified);
      }
    }
    expect(offenders, 'owner column written from the request').toEqual([]);
  });
});
