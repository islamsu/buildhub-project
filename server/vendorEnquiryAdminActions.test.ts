/**
 * THE CATALOGUE MUST BE TRUE, NOT MERELY WRITTEN.
 *
 * A file that claims "this action maps to inviteSupplier" and "the enum has no
 * withdrawn value" is documentation, and documentation rots silently. Every
 * claim in vendorEnquiryAdminActions.ts is checked here against the real
 * codebase, so a claim that stops being true fails a test instead of misleading
 * whoever reads it next.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ADMIN_COMPLIMENTARY_RULES,
  ENQUIRY_ADMIN_ACTIONS,
  implementableActions,
} from './vendorEnquiryAdminActions';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const SCHEMA = read('../drizzle/schema.ts');
const ROUTERS = read('./routers.ts');

describe('every action claiming a real domain operation has one', () => {
  const real = Object.entries(ENQUIRY_ADMIN_ACTIONS)
    .filter(([, s]) => s.kind === 'REAL_DOMAIN_OPERATION');

  it('there is at least one, or the screen has nothing to offer', () => {
    expect(real.length).toBeGreaterThan(0);
    expect(implementableActions().sort()).toEqual(real.map(([n]) => n).sort());
  });

  it('the table each one writes to actually exists', () => {
    for (const [name, s] of real) {
      if (s.kind !== 'REAL_DOMAIN_OPERATION') continue;
      // ADJUST_ALLOWANCE names the architecture in prose; the table is the
      // first word of it.
      const table = s.writes.split(' ')[0];
      expect(SCHEMA, `${name} claims to write ${table}`).toContain(`mysqlTable('${table}'`);
    }
  });

  it('the function each one reuses actually exists and is not re-implemented here', () => {
    for (const [name, s] of real) {
      if (s.kind !== 'REAL_DOMAIN_OPERATION') continue;
      const fn = s.operation.split(' ')[0];
      if (!/^[a-z]\w+$/.test(fn)) continue;   // prose entries are checked above
      expect(ROUTERS, `${name} claims to reuse ${fn}`).toContain(fn);
      const module = read('./vendorEnquiryAdminActions.ts');
      expect(module, `${fn} must be REUSED, never redefined in the catalogue`)
        .not.toContain(`function ${fn}`);
    }
  });
});

describe('every refusal is refused for a reason that is still true', () => {
  it('OPEN_ON_BEHALF is refused because an invitation already gives free access', () => {
    const action = ENQUIRY_ADMIN_ACTIONS.OPEN_ON_BEHALF;
    expect(action.kind).toBe('NOT_IMPLEMENTED');
    // THE CLAIM THIS REFUSAL RESTS ON: openQualifiedEnquiry already gives an
    // invited supplier free access. If that stops being true, the refusal loses
    // its justification and complimentary access becomes a real gap again.
    //
    // The invited branch is asserted where it lives - it must return early with
    // NO qualifiedEnquiries row, which is the whole reason an invitation can
    // stand in for a complimentary open.
    const engine = read('./billing/enquiries.ts');
    const branch = engine.slice(
      engine.indexOf('if (await hasOpenInvitation(db, rfqId, userId)) {'),
      engine.indexOf('// Eligibility, decided server-side'),
    );
    expect(branch, 'the invited branch must be findable').toContain('byInvitation: true');
    expect(branch, 'an invited open must consume nothing').toContain('enquiryId: null');
    expect(branch).not.toContain('insert(qualifiedEnquiries)');
    // And the behaviour itself is proven against the real engine elsewhere;
    // that proof must not quietly disappear.
    expect(read('./enquiryInvitationExemption.test.ts'))
      .toContain('AN INVITED OPEN SAYS IT WAS EXEMPT');
  });

  it('and NOTHING anywhere sets an enquiry status directly', () => {
    // The invariant the whole model rests on: the state is derived. A
    // setEnquiryStatus of any shape means two sources of truth.
    for (const source of [ROUTERS, SCHEMA]) {
      expect(source).not.toMatch(/setEnquiryStatus|enquiryStatus\s*:/);
    }
  });

  it('WITHDRAW_INVITATION is honest that the enum cannot express it yet', () => {
    const action = ENQUIRY_ADMIN_ACTIONS.WITHDRAW_INVITATION;
    expect(action.kind).toBe('REQUIRES_DOMAIN_CHANGE');
    const block = SCHEMA.slice(
      SCHEMA.indexOf("export const rfqSuppliers = mysqlTable"),
      SCHEMA.indexOf('}));', SCHEMA.indexOf("export const rfqSuppliers = mysqlTable")),
    );
    // If somebody adds it, this test fails and the catalogue must be promoted
    // from REQUIRES_DOMAIN_CHANGE to a real operation.
    expect(block).not.toContain("'withdrawn'");
  });
});

describe('the complimentary-access constraints are recorded, not lost', () => {
  it('names the four things such a grant must never do, plus attribution', () => {
    expect(ADMIN_COMPLIMENTARY_RULES.length).toBe(5);
    const text = ADMIN_COMPLIMENTARY_RULES.join(' | ');
    for (const must of ['decrement', 'VENDOR_OPEN', 'qualifiedEnquiries', 'billing event', 'reason']) {
      expect(text, `the ${must} constraint must survive`).toContain(must);
    }
  });
});

// ── The notes boundary (§12) ───────────────────────────────────────────────

describe('notes on a PERSON keep the permission they have always needed', () => {
  const ROUTERS_SOURCE = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');
  const bodyOf = (name: string) => {
    const start = ROUTERS_SOURCE.indexOf(`  ${name}: adminWith(`);
    expect(start, `${name} must be findable`).toBeGreaterThan(-1);
    const rest = ROUTERS_SOURCE.slice(start + 1);
    const next = rest.search(/^ {2}\w+: (adminWith|superAdminProcedure|adminProcedure|publicProcedure|protectedProcedure)/m);
    return next === -1 ? rest : rest.slice(0, next);
  };

  it('THE RULE IS CALLED, NOT SPELLED - a source-text assertion is not a test of a guard', async () => {
    // Found by mutation: the first version of this test asserted the router
    // SOURCE contained the permission check. Wrapping the condition in
    // `if (false && ...)` left the string intact, so the test passed while the
    // guard did nothing. The rule now lives in a function that can be called,
    // and this exercises it.
    const { mayReadPersonNotes, mayWritePersonNotes } = await import('./vendorEnquiryAdminActions');

    // MARKETPLACE_ADMIN may READ a person's notes - it holds users.read - but
    // may not WRITE one. That asymmetry is the whole boundary.
    expect(mayReadPersonNotes('MARKETPLACE_ADMIN')).toBe(true);
    expect(mayWritePersonNotes('MARKETPLACE_ADMIN')).toBe(false);
    expect(mayWritePersonNotes('USER_ADMIN')).toBe(true);
    expect(mayWritePersonNotes('SUPER_ADMIN')).toBe(true);

    // Fails closed on everything that is not a role.
    for (const notARole of [null, undefined, '', 'ADMIN', 'FUTURE_ROLE']) {
      expect(mayReadPersonNotes(notARole as never), String(notARole)).toBe(false);
      expect(mayWritePersonNotes(notARole as never), String(notARole)).toBe(false);
    }
  });

  it('and the endpoints call it rather than re-deriving the rule', () => {
    expect(bodyOf('enquiryNotes')).toContain('mayReadPersonNotes(ctx.user.adminRole)');
    expect(bodyOf('addEnquiryNote')).toContain('mayWritePersonNotes(ctx.user.adminRole)');
  });

  it('THE FALSE BRANCH IS UNREACHABLE FOR EVERY ROLE THAT EXISTS TODAY, and is kept anyway', async () => {
    // Every non-super role in shared/adminRoles.ts carries users.read, so no
    // real administrator sees vendorNotesVisible=false. That is why the live
    // probe cannot exercise it - and why it is asserted here instead, against a
    // role string the product does not define. Deleting the guard because
    // nothing reaches it would mean a future role added without users.read
    // silently receives a person's notes.
    const { ADMIN_ROLES, hasAdminPermission } = await import('@shared/adminRoles');
    for (const role of ADMIN_ROLES) {
      expect(hasAdminPermission(role, 'users.read'),
        `${role} is expected to hold users.read; if that changed, the live probe expectation must change with it`)
        .toBe(true);
    }
    expect(hasAdminPermission('FUTURE_ROLE_WITHOUT_USER_READ', 'users.read')).toBe(false);
  });

  it('a vendor note is filed as subjectType user, so one person has one note list', () => {
    const write = bodyOf('addEnquiryNote');
    expect(write).toContain("subjectType: input.scope === 'rfq' ? 'rfq' : 'user'");
  });

  it('and the subject must exist before a note is filed against it', () => {
    const write = bodyOf('addEnquiryNote');
    expect(write).toMatch(/if \(!subject\) throw new TRPCError\(\{ code: 'NOT_FOUND'/);
  });
});

// ── The entitlement boundary (§15/§16) ─────────────────────────────────────

describe('there is exactly ONE way to change an allowance, and this screen is not it', () => {
  const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

  it('the adjustment stays a Super Admin action', () => {
    // Rebuilding it at marketplace.manage would hand every marketplace
    // administrator an authority the platform reserved - the same mistake as
    // putting a bid price in the enquiry detail.
    expect(ROUTERS).toContain('setVendorEnquiryLimit: superAdminProcedure');
  });

  it('NO ENQUIRY ENDPOINT WRITES AN ENTITLEMENT', () => {
    // The enquiry endpoints may READ the allowance through the centralized
    // engine; none of them may change it.
    for (const name of ['enquiryOverview', 'enquiryList', 'enquiryDetail', 'enquiryNotes', 'addEnquiryNote', 'assignEnquiry']) {
      const start = ROUTERS.indexOf(`  ${name}: adminWith(`);
      expect(start, `${name} must be findable`).toBeGreaterThan(-1);
      const rest = ROUTERS.slice(start + 1);
      const next = rest.search(/^ {2}\w+: (adminWith|superAdminProcedure|adminProcedure)/m);
      const body = next === -1 ? rest : rest.slice(0, next);
      expect(body, `${name} must not write an entitlement`).not.toContain('setEnquiryAllowance');
      expect(body, `${name} must not write an override row`).not.toContain('vendorEntitlementOverrides');
    }
  });

  it('and nothing anywhere sets a remaining count directly', () => {
    // The shape §16 forbids: a written "remaining", which destroys the
    // relationship between the allowance, the usage and the history.
    expect(ROUTERS).not.toMatch(/setRemaining|remaining:\s*input\./);
  });
});
