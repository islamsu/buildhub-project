/**
 * ── A CAPACITY ON A PROJECT CAN BE CHANGED WITHOUT PRETENDING SOMEBODY LEFT ─
 *
 * Three defects, each reproduced against the running product before anything
 * was written:
 *
 *   THERE WAS NO ROLE CHANGE AT ALL. `addMember` refuses a live member with
 *   CONFLICT, so promoting the site engineer to manager meant REMOVING them and
 *   ADDING them back - which resets `assignedAt`, erases the `removedAt` and
 *   `removedBy` recording that they were ever taken off, and sends them a "You
 *   were added to a project" notification for a project they never left. The
 *   project role decides what they can do, so this is not a cosmetic field.
 *
 *   `removeMember` REPORTED A REMOVAL THAT HAPPENED AS `removed: false`. It
 *   read `result.rowsAffected`; mysql2 answers `[ResultSetHeader]` and the
 *   count is at `result[0].affectedRows`. The flag exists precisely to tell "I
 *   took somebody off" from "that person was not on it", and both answered
 *   false. Three spellings of that read existed in the codebase; there is one
 *   now, in `_core/writeResult.ts`.
 *
 *   AND NONE OF IT WAS AUDITED. Adding somebody to a project, changing their
 *   capacity on it or taking them off it decides WHO CAN READ the customer's
 *   documents, RFQs and quotations. "Who let the other contractor see our
 *   drawings, and when" had no answer anywhere.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';
import { affectedRows, changedSomething } from './_core/writeResult';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ROUTERS = readSourceForAssertions(read('./routers.ts'));
const DETAIL = readSourceForAssertions(read('../client/src/pages/ProjectDetail.tsx'));
const LANG = read('../client/src/contexts/LanguageContext.tsx');

/** A slice whose boundaries are proven - an unproven one passes everything. */
function between(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  expect(start, `start marker is gone: ${startMarker}`).toBeGreaterThan(-1);
  const end = text.indexOf(endMarker, start);
  expect(end, `end marker is gone or above the start: ${endMarker}`).toBeGreaterThan(start);
  return text.slice(start, end);
}
const changeRole = () => between(ROUTERS, 'changeMemberRole: protectedProcedure', 'removeMember: protectedProcedure');
const removeMember = () => between(ROUTERS, 'removeMember: protectedProcedure', 'update: protectedProcedure');

describe('how many rows did that write touch', () => {
  it('reads mysql2s ACTUAL shape - the header inside the array', () => {
    expect(affectedRows([{ affectedRows: 3 }, []])).toBe(3);
    expect(changedSomething([{ affectedRows: 1 }])).toBe(true);
  });

  it('and a write that changed nothing is nothing, not a truthy object', () => {
    expect(affectedRows([{ affectedRows: 0 }])).toBe(0);
    expect(changedSomething([{ affectedRows: 0 }])).toBe(false);
  });

  it('THE SPELLING THAT CAUSED THE DEFECT returns zero, not undefined', () => {
    // `{ rowsAffected }` is not what mysql2 returns. Reading it gave undefined,
    // `undefined > 0` is false, and a real removal reported `removed: false`.
    // Both spellings are understood now, so neither can be silently wrong.
    expect(affectedRows({ rowsAffected: 2 })).toBe(2);
    expect(affectedRows({ nothingUseful: 2 })).toBe(0);
  });

  it('an unrecognised answer is 0 rather than NaN', () => {
    // NaN > 0 is false, so a NaN would read as "nothing happened" at every
    // call site - the same silent wrongness in a different disguise.
    for (const value of [null, undefined, 'yes', 42, [], {}, [null]]) {
      expect(Number.isFinite(affectedRows(value)), String(value)).toBe(true);
      expect(affectedRows(value)).toBe(0);
    }
  });
});

describe('changing a capacity', () => {
  it('is authorized by the SESSION, with the same capability as adding', () => {
    expect(changeRole()).toContain("requireProjectAccess(db, input.projectId, ctx.user.id, 'manage')");
  });

  it('refuses to hand out ownership, like addMember', () => {
    // Ownership is derived from projects.ownerId. Granting it here would make a
    // project with two owners, one of whom the ownership column knows nothing
    // about.
    const body = changeRole();
    expect(body).toContain("input.projectRole === 'owner'");
    expect(body).toContain('BAD_REQUEST');
  });

  it('and refuses to change the OWNER own capacity on their own project', () => {
    expect(changeRole()).toContain('input.userId === access.ownerId');
  });

  it('A REMOVED MEMBER IS NOT PROMOTED BACK IN', () => {
    // Changing the role of somebody who is off the project would quietly
    // restore their access, which is the opposite of what removing them meant.
    const body = changeRole();
    expect(body).toContain('existing.removedAt');
    expect(body).toContain('NOT_FOUND');
  });

  it('a change to the role they already hold is reported as no change', () => {
    const body = changeRole();
    expect(body).toContain("previous === input.projectRole");
    expect(body).toContain('changed: false');
    expect(body).toContain('changed: true');
  });

  it('does NOT touch the columns that record removal or first assignment', () => {
    // The whole point: the person never left, so `removedAt`, `removedBy` and
    // `assignedAt` are not the role change's business. Writing them is how a
    // promotion starts looking like a departure and a return.
    const write = between(changeRole(), 'db.update(projectMembers)', 'const [project]');
    expect(write).toContain('projectRole: input.projectRole');
    expect(write).not.toContain('removedAt');
    expect(write).not.toContain('removedBy');
    expect(write).not.toContain('assignedAt');
  });

  it('tells the person, in both languages, and says what it changed FROM', () => {
    const body = changeRole();
    expect(body).toContain("messageKey: 'notif.project.member.roleChanged'");
    expect(body).toContain('from: previous');
    for (const key of ['notif.project.member.roleChanged.title', 'notif.project.member.roleChanged.body']) {
      expect((LANG.match(new RegExp(`'${key.replace(/\./g, '\\.')}':`, 'g')) ?? []).length, key).toBe(2);
    }
    const both = [...LANG.matchAll(/'notif\.project\.member\.roleChanged\.body': '([^']+)'/g)].map(m => m[1]);
    expect(both).toHaveLength(2);
    expect(both[1], 'the Arabic string is an English fallback pasted twice').toMatch(/[؀-ۿ]/);
    // The previous role is in the copy, not only in the parameters.
    expect(both[0]).toContain('{from}');
    expect(both[1]).toContain('{from}');
  });
});

describe('the trail that says who could see what', () => {
  it('records all three membership acts against the PROJECT', () => {
    for (const action of ['project_member_added', 'project_member_role_changed', 'project_member_removed']) {
      expect(ROUTERS, action).toContain(`action: '${action}'`);
    }
    expect(ROUTERS).toContain("subjectType: 'project'");
  });

  it('and a removal that did not happen is not recorded as one', () => {
    // Writing a removal event for a no-op puts a removal in the trail that did
    // not occur, which is worse than not recording it.
    const body = removeMember();
    const guard = body.indexOf('if (removed)');
    const event = body.indexOf("action: 'project_member_removed'");
    expect(guard, 'the removal event is written unconditionally').toBeGreaterThan(-1);
    expect(event).toBeGreaterThan(guard);
  });

  it('the role change records what it changed FROM, not just to', () => {
    expect(changeRole()).toMatch(/detail: `user \$\{input\.userId\}: \$\{previous\} -> \$\{input\.projectRole\}`/);
  });
});

describe('the screen says what actually happened', () => {
  it('a removal that removed nobody does not claim it removed somebody', () => {
    // Scoped to the removal handler itself, so the copy cannot be satisfied by
    // a sentence that happens to live somewhere else on the page.
    const handler = between(DETAIL, 'projects.removeMember.useMutation', 'const [disputeOpen');
    expect(handler).toContain('result.removed');
    expect(handler, 'the honest branch is gone').toMatch(/already off this project/);
    expect(handler, 'it still claims a removal unconditionally')
      .not.toMatch(/onSuccess: \(\) =>/);
  });

  it('and "changed" is told apart from "that is already their role"', () => {
    expect(DETAIL).toContain('result.changed');
    expect(DETAIL).toMatch(/already their role/);
    expect(DETAIL).toMatch(/Role changed from/);
  });

  it('the control is offered only to somebody who may use it', () => {
    const team = between(DETAIL, 'data-testid={`member-role-', 'data-testid={`member-remove-');
    expect(DETAIL).toContain("team?.myCapabilities?.includes('manage')");
    expect(team).toContain('changeMemberRole.mutate');
    // And never for the owner, whose capacity the server refuses to change -
    // an offered control that is certain to fail is the ELIG defect again.
    expect(DETAIL).toContain("member.projectRole !== 'owner'");
  });

  it('and it offers no role the server would refuse', () => {
    const options = between(DETAIL, 'data-testid={`member-role-', '</select>');
    expect(options).not.toContain("'owner'");
    for (const role of ['manager', 'contractor', 'architect', 'engineer', 'supplier', 'viewer']) {
      expect(options, role).toContain(`'${role}'`);
    }
  });
});
