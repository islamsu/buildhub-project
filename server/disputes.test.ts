import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSourceForAssertions } from './_testing/sourceText';

/**
 * USER-FACING DISPUTES.
 *
 * The admin could already list and resolve disputes, but no user could open
 * one. This pins the now-present creation path and its relationship checks.
 */

const ROUTERS = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'));

function disputesRouter(): string {
  const start = ROUTERS.indexOf('const disputesRouter = router({');
  const end = ROUTERS.indexOf('\nconst profileRouter', start);
  return ROUTERS.slice(start, end === -1 ? undefined : end);
}

describe('disputes.create', () => {
  const body = disputesRouter();

  it('requires the reporter to be a project participant', () => {
    expect(body).toContain("requireProjectAccess(db, input.projectId, ctx.user.id, 'read')");
  });

  it('refuses a self-dispute', () => {
    expect(body).toContain('respondentId === ctx.user.id');
    expect(body).toContain('You cannot open a dispute against yourself');
  });

  it('refuses a respondent who is not a project participant', () => {
    expect(body).toContain("isNull(projectMembers.removedAt)");
    expect(body).toContain('The respondent must be a participant on this project');
  });

  it('myDisputes is scoped to reporter or respondent', () => {
    expect(body).toContain("or(eq(disputes.reporterId, ctx.user.id), eq(disputes.respondentId, ctx.user.id))");
  });
});
