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
