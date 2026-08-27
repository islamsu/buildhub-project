// ── The PROJECT half of "role + project + question" ────────────────────────
//
// Before this, ai.chat knew who was asking and what role they held and nothing
// about what they were building. A homeowner asking "am I over budget?" got a
// general essay about construction budgets.
//
// Three properties matter more than the feature, and each is a NO:
//
//   AUTHORIZATION BEFORE RETRIEVAL. A projectId in the request is a SELECTOR
//   among rows the caller may already see - never a claim that widens what
//   they may see. Naming someone else's project must yield "not yours", not
//   their project.
//
//   RELEVANT, NOT EVERYTHING. A question with no project bearing must cost no
//   query and add no block. The brief is explicit about not dumping user data
//   into every request.
//
//   ASK, DO NOT GUESS. Three projects and an ambiguous question is a question
//   to the user, not a coin flip weighted by updatedAt.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  formatProjectContext, questionMentionsAProject, resolveProjectContext,
  type ProjectContext,
} from './_core/projectContext';

const ROUTERS = readFileSync(new URL('./routers.ts', import.meta.url), 'utf8');

/**
 * Column names reachable from a Drizzle value, without JSON.stringify.
 *
 * Drizzle's predicate and column objects are CIRCULAR - every column points
 * back at its table, which points back at its columns - so stringifying one
 * throws. Walking with a seen-set is what actually lets a test assert "this
 * query mentions ownerId" rather than trusting the stub it was handed.
 */
function columnNamesIn(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  const found: string[] = [];
  const record = value as Record<string, unknown>;
  if (typeof record.name === 'string' && typeof record.columnType === 'string') found.push(record.name);
  for (const child of Object.values(record)) found.push(...columnNamesIn(child, seen));
  return found;
}

/**
 * A db double that records the WHERE it was handed, because "was ownership in
 * the query" is the claim, not "did the right row come back from a stub".
 */
function stubDb(rows: unknown[]) {
  const where = vi.fn().mockReturnValue({
    orderBy: () => ({ limit: () => Promise.resolve(rows) }),
    then: (resolve: (value: unknown) => unknown) => resolve(rows),
  });
  const select = vi.fn(() => ({ from: () => ({ where }) }));
  return { db: { select } as never, where, select };
}

const OWNED = {
  id: 7, title: 'Villa slab', type: 'residential', status: 'active',
  location: 'New Cairo', progress: 40, budget: '1500000.00', spent: '600000.00',
  startDate: new Date('2026-01-10'), endDate: new Date('2026-09-30'),
};

describe('a question with no project bearing costs nothing', () => {
  it('returns none WITHOUT touching the database', async () => {
    const { db, select } = stubDb([OWNED]);
    const context = await resolveProjectContext({
      db, userId: 5, userRole: 'homeowner',
      question: 'What is a reasonable price for ceramic tiles?',
    });
    expect(context).toEqual({ kind: 'none' });
    expect(select, 'a general question must not query projects').not.toHaveBeenCalled();
  });

  it('and contributes no block at all', () => {
    expect(formatProjectContext({ kind: 'none' }, 'en')).toBe('');
    expect(formatProjectContext({ kind: 'none' }, 'ar')).toBe('');
  });

  it('the cue detector recognises project questions in BOTH languages', () => {
    for (const question of [
      'Am I over budget?', 'How is progress on my project?', 'When does my site finish?',
      'هل تجاوزت الميزانية؟', 'ما هو التقدم في مشروعي؟',
    ]) {
      expect(questionMentionsAProject(question), question).toBe(true);
    }
    for (const question of [
      'What is the best cement brand?', 'ما هو أفضل نوع أسمنت؟', 'How do I waterproof a roof?',
    ]) {
      expect(questionMentionsAProject(question), question).toBe(false);
    }
  });
});

describe('authorization happens in the query, not after it', () => {
  it('an owner question is constrained by ownerId', async () => {
    const { db, where } = stubDb([OWNED]);
    await resolveProjectContext({ db, userId: 5, userRole: 'homeowner', question: 'Am I over budget?' });
    expect(where).toHaveBeenCalled();
    expect(columnNamesIn(where.mock.calls[0][0]), 'the query does not constrain by ownerId')
      .toContain('ownerId');
  });

  it("NEGATIVE CONTROL: naming another user's project returns unauthorized, not the project", async () => {
    // The stub returns nothing, which is exactly what the real ownerId
    // predicate returns for somebody else's id.
    const { db } = stubDb([]);
    const context = await resolveProjectContext({
      db, userId: 5, userRole: 'homeowner', question: 'How is it going?', selectedProjectId: 999,
    });
    expect(context).toEqual({ kind: 'unauthorized' });
  });

  it('and the unauthorized block tells the model NOT to substitute another project', () => {
    const block = formatProjectContext({ kind: 'unauthorized' }, 'en');
    expect(block).toMatch(/not among the ones this user may see/i);
    expect(block).toMatch(/do not substitute another project/i);
    expect(formatProjectContext({ kind: 'unauthorized' }, 'ar')).toMatch(/[؀-ۿ]/);
  });

  it('a PROVIDER never receives budget or spend', async () => {
    // The directory allowlist exists because budget and spent are owner-private.
    // A provider reading a project through the AI must not get what
    // projects.directory refuses them.
    const { db, select } = stubDb([{ id: 7, title: 'Villa slab', type: 'residential', status: 'active', location: 'New Cairo', progress: 40 }]);
    const context = await resolveProjectContext({
      db, userId: 20, userRole: 'contractor', question: 'How is it going?', selectedProjectId: 7,
    });
    expect(context.kind).toBe('resolved');
    // The select projection is a plain alias->column map, so its KEYS are the
    // allowlist. Asserting on the keys is stronger than a substring search.
    const requested = Object.keys(select.mock.calls[0][0] as Record<string, unknown>);
    expect(requested).not.toContain('budget');
    expect(requested).not.toContain('spent');
    expect(requested).toEqual(['id', 'title', 'type', 'status', 'location', 'progress']);

    const block = formatProjectContext(context, 'en');
    expect(block).not.toMatch(/Budget:/);
    expect(block).not.toMatch(/Spent:/);
    expect(block).toMatch(/Budget and spend are NOT available/i);
  });

  it('a provider who names NO project gets no project context', async () => {
    // A provider owns nothing, so "my project" has no referent. Guessing from
    // a fifty-row lead directory would be worse than saying nothing.
    const { db, select } = stubDb([]);
    const context = await resolveProjectContext({
      db, userId: 20, userRole: 'supplier', question: 'How is progress on my project?',
    });
    expect(context).toEqual({ kind: 'none' });
    expect(select).not.toHaveBeenCalled();
  });
});

describe('ambiguity is a question, not a guess', () => {
  it('two projects and a vague question asks WHICH', async () => {
    const { db } = stubDb([
      { ...OWNED, id: 7, title: 'Villa slab' },
      { ...OWNED, id: 8, title: 'Roof waterproofing' },
    ]);
    const context = await resolveProjectContext({
      db, userId: 5, userRole: 'homeowner', question: 'Am I over budget?',
    });
    expect(context.kind).toBe('ambiguous');
    expect((context as Extract<ProjectContext, { kind: 'ambiguous' }>).choices).toHaveLength(2);
  });

  it('the block instructs the model to ask, and forbids picking the newest', () => {
    const block = formatProjectContext({
      kind: 'ambiguous', choices: [{ id: 7, title: 'Villa slab' }, { id: 8, title: 'Roof waterproofing' }],
    }, 'en');
    expect(block).toMatch(/ASK which project/);
    expect(block).toMatch(/do not assume the most recent one/i);
    expect(block).toContain('Villa slab');
    expect(block).toContain('Roof waterproofing');
  });

  it('naming the project resolves it - ambiguity is about the QUESTION, not the account', async () => {
    const { db } = stubDb([OWNED]);
    const context = await resolveProjectContext({
      db, userId: 5, userRole: 'homeowner', question: 'Am I over budget?', selectedProjectId: 7,
    });
    expect(context.kind).toBe('resolved');
  });

  it('ONE project is not ambiguous', async () => {
    const { db } = stubDb([OWNED]);
    const context = await resolveProjectContext({
      db, userId: 5, userRole: 'homeowner', question: 'Am I over budget?',
    });
    expect(context.kind).toBe('resolved');
  });
});

describe('the resolved block is facts, with the discipline attached', () => {
  const owned: ProjectContext = { kind: 'resolved', scope: 'owner', project: OWNED };

  it('carries the figures the question needs', () => {
    const block = formatProjectContext(owned, 'en');
    expect(block).toContain('Villa slab');
    expect(block).toContain('1500000.00');
    expect(block).toContain('600000.00');
    expect(block).toContain('40%');
    expect(block).toContain('2026-09-30');
  });

  it('forbids inventing a field that is not there', () => {
    // The failure mode of giving a model five fields is a confident sixth.
    expect(formatProjectContext(owned, 'en')).toMatch(/Do NOT invent any field not listed above/);
    expect(formatProjectContext(owned, 'en')).toMatch(/not recorded in BuildHub rather than estimating/);
  });

  it('omits empty fields instead of printing null', () => {
    const sparse: ProjectContext = {
      kind: 'resolved', scope: 'owner',
      project: { ...OWNED, budget: null, spent: null, location: null, endDate: null },
    };
    const block = formatProjectContext(sparse, 'en');
    expect(block).not.toMatch(/null|undefined/);
    expect(block).not.toContain('Budget:');
  });

  it('renders in Arabic for an Arabic reader', () => {
    const block = formatProjectContext(owned, 'ar');
    expect(block).toMatch(/[؀-ۿ]/);
    expect(block).toContain('Villa slab');   // the title is the user's own text
    expect(block).not.toContain('PROJECT CONTEXT');
  });
});

describe('the router wires it the way the brief requires', () => {
  it('projectId is an optional SELECTOR on ai.chat', () => {
    const start = ROUTERS.indexOf('  chat: aiChatProcedure');
    const schema = ROUTERS.slice(start, ROUTERS.indexOf('.mutation(', start));
    expect(schema).toContain('projectId: z.number().int().positive().optional()');
  });

  it('the resolver is given the SESSION user and role, never the request', () => {
    const start = ROUTERS.indexOf('resolveProjectContext({');
    expect(start).toBeGreaterThan(-1);
    const call = ROUTERS.slice(start, start + 400);
    expect(call).toContain('userId: ctx.user.id');
    expect(call).toContain('userRole: ctx.user.userRole');
    expect(call).not.toMatch(/userId: input\./);
    expect(call).not.toMatch(/userRole: input\./);
  });

  it('the project block reaches the system prompt', () => {
    expect(ROUTERS).toContain('systemPrompt + attachmentBlock + projectBlock');
  });
});

describe('the client offers the selector honestly', () => {
  const PAGE = readFileSync(new URL('../client/src/pages/AIAssistantPage.tsx', import.meta.url), 'utf8');
  const CONTEXT = readFileSync(new URL('../client/src/contexts/LanguageContext.tsx', import.meta.url), 'utf8');

  it('sends projectId only when one was chosen', () => {
    expect(PAGE).toContain("projectId !== 'none' ? { projectId: Number(projectId) } : {}");
  });

  it('an owner picks from their OWN projects; a provider from the directory', () => {
    // Two different authorized queries, matching the two scopes the server
    // resolves. Neither is a general project list.
    expect(PAGE).toContain('trpc.projects.list.useQuery');
    expect(PAGE).toContain('trpc.projects.directory.useQuery');
    expect(PAGE).toContain('enabled: Boolean(me) && !isProvider');
    expect(PAGE).toContain('enabled: Boolean(me) && isProvider');
  });

  it('the role behind that split comes from the SESSION', () => {
    expect(PAGE).toContain('me?.userRole');
    expect(PAGE).not.toMatch(/userRole.*localStorage|localStorage.*userRole/);
  });

  it('no selector is rendered when there is nothing to select', () => {
    // A control with one empty option is a control that does nothing.
    expect(PAGE).toContain('selectableProjects.length > 0 &&');
  });

  it('its copy is translated in both languages', () => {
    for (const key of ['ai.project.label', 'ai.project.none']) {
      expect(CONTEXT.split(`'${key}':`).length - 1, key).toBe(2);
    }
    const arabic = CONTEXT.split("'ai.project.none': '")[2] ?? '';
    expect(arabic.slice(0, arabic.indexOf("'"))).toMatch(/[؀-ۿ]/);
  });
});
