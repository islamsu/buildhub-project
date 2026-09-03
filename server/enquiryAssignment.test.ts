/**
 * ASSIGNMENT: THE ONE PIECE OF ENQUIRY STATE THAT IS NOT DERIVED.
 *
 * The interesting question this file answers is not "does an insert work". It
 * is whether the two modelling decisions are consistent: the enquiry's STATUS
 * was refused a table because it is derivable, and the ASSIGNMENT was given one
 * because it is not. If that reasoning ever stops holding, these tests are
 * where it shows.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ASSIGNEE_ELIGIBILITY,
  ASSIGNEE_INELIGIBLE_MESSAGE,
  assignEnquiry,
} from './enquiryAssignment';
import { ADMIN_SIGN_IN_ELIGIBILITY } from './adminAuthority';

const SOURCE = readFileSync(new URL('./enquiryAssignment.ts', import.meta.url), 'utf8');
const SCHEMA = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');

/**
 * A driver that answers reads BY TABLE, not by call order.
 *
 * The first version dispatched on the order the selects arrived, and broke the
 * moment a code path skipped one: unassigning does not look up the assignable
 * admins, so the current-assignment read became "call 0" and got the admin
 * list. A fake keyed to a call sequence is a fake that encodes an assumption
 * about the code under test.
 */
/**
 * A drizzle table's name lives under Symbol(drizzle:Name), NOT under `_.name`.
 * Read off a real table object rather than assumed - the `_.name` guess returns
 * undefined, which would have silently sent every read down the same branch.
 */
function tableName(table: unknown): string {
  const symbol = Object.getOwnPropertySymbols(table as object)
    .find(candidate => String(candidate) === 'Symbol(drizzle:Name)');
  return symbol ? String((table as Record<symbol, unknown>)[symbol]) : '';
}

function makeDb({ admins = [{ id: 9 }] as unknown[], current = [] as unknown[] } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const chain = () => {
    let rows: unknown[] = [];
    const self: any = {
      from: (table: unknown) => {
        rows = tableName(table) === 'enquiryAssignments' ? current : admins;
        return self;
      },
      leftJoin: () => self, where: () => self, orderBy: () => self,
      limit: () => Promise.resolve(rows),
      then: (resolve: (value: unknown) => void) => Promise.resolve(rows).then(resolve),
    };
    return self;
  };
  return {
    db: {
      select: () => chain(),
      insert: () => ({ values: (row: Record<string, unknown>) => { inserted.push(row); return Promise.resolve([{ insertId: 77 }]); } }),
    },
    inserted: () => inserted,
  };
}

describe('the two modelling decisions are consistent, and say why', () => {
  it('THERE IS STILL NO vendorEnquiries TABLE - the state stays derived', () => {
    expect(SCHEMA).not.toContain("mysqlTable('vendorEnquiries'");
  });

  it('but there IS an assignments table, because nothing else records an assignee', () => {
    expect(SCHEMA).toContain("mysqlTable('enquiryAssignments'");
  });

  it('the assignments table has no enquiry STATUS column smuggled into it', () => {
    // The failure this prevents: "while we have a table, let us also store the
    // state here" - which is exactly the second source of truth the derivation
    // exists to avoid.
    const start = SCHEMA.indexOf("export const enquiryAssignments = mysqlTable");
    const block = SCHEMA.slice(start, SCHEMA.indexOf('}));', start));
    expect(block).not.toMatch(/\bstatus:/);
    expect(block).not.toMatch(/\bstate:/);
  });

  it('it is APPEND-ONLY, so an unassignment is an event and not a deletion', () => {
    expect(SOURCE).not.toMatch(/\.delete\(/);
    expect(SOURCE).not.toMatch(/\.update\(/);
  });
});

describe('an enquiry can only be handed to someone who could act on it', () => {
  it('the eligibility rules are the SAME ones sign-in applies', () => {
    // A queue assigned to an account that cannot sign in is a queue nobody is
    // working, and the screen would show it as handled.
    expect(ASSIGNEE_ELIGIBILITY).toBe(ADMIN_SIGN_IN_ELIGIBILITY);
    for (const column of ADMIN_SIGN_IN_ELIGIBILITY) {
      expect(SOURCE, `assignableAdmins must apply ${column}`).toContain(`users.${column}`);
    }
  });

  it('refuses an assignee who is not on the assignable list', async () => {
    const { db } = makeDb({ admins: [{ id: 9 }] });
    await expect(assignEnquiry({ db, rfqId: 1, vendorId: 2, assigneeId: 4242, actorId: 1 }))
      .rejects.toThrow(ASSIGNEE_INELIGIBLE_MESSAGE);
  });

  it('accepts one who is, and records the actor with them', async () => {
    const driver = makeDb({ admins: [{ id: 9 }] });
    const result = await assignEnquiry({ db: driver.db, rfqId: 1, vendorId: 2, assigneeId: 9, actorId: 5 });
    expect(result.assignmentId).toBe(77);
    expect(driver.inserted()[0]).toMatchObject({ rfqId: 1, vendorId: 2, assigneeId: 9, actorId: 5 });
  });
});

describe('what happens is recorded honestly', () => {
  it('UNASSIGNING WRITES A ROW rather than deleting one', async () => {
    // "Who took this off Rana, and when?" is a question a support lead asks,
    // and a deleted row cannot answer it.
    const driver = makeDb({ current: [{ rfqId: 1, vendorId: 2, assigneeId: 9 }] });
    const result = await assignEnquiry({ db: driver.db, rfqId: 1, vendorId: 2, assigneeId: null, actorId: 5 });
    expect(driver.inserted()).toHaveLength(1);
    expect(driver.inserted()[0]).toMatchObject({ assigneeId: null, actorId: 5 });
    // Nobody is notified: there is no new assignee to tell.
    expect(result.notify).toBeNull();
  });

  it('assigning to whoever already holds it writes NOTHING', async () => {
    // An audit line that says something happened when nothing did is worse than
    // no line at all.
    const driver = makeDb({ admins: [{ id: 9 }], current: [{ rfqId: 1, vendorId: 2, assigneeId: 9 }] });
    const result = await assignEnquiry({ db: driver.db, rfqId: 1, vendorId: 2, assigneeId: 9, actorId: 5 });
    expect(driver.inserted()).toHaveLength(0);
    expect(result.notify).toBeNull();
  });

  it('a real new assignee is the only one notified, and by reference', async () => {
    const driver = makeDb({ admins: [{ id: 9 }] });
    const result = await assignEnquiry({ db: driver.db, rfqId: 501, vendorId: 10, assigneeId: 9, actorId: 5 });
    expect(result.notify).toEqual({ userId: 9, reference: 'ENQ-501-10' });
  });
});
