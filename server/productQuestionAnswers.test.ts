import { describe, expect, it, vi } from 'vitest';
import { readSourceForAssertions } from './_testing/sourceText';

vi.mock('./db', () => ({ getDb: vi.fn() }));

import { appRouter } from './routers';
import { getDb } from './db';
import type { TrpcContext } from './_core/context';

/**
 * ANSWERING A QUESTION ABOUT YOUR OWN PRODUCT.
 *
 * The audit found half a workflow: productQuestions carried `answer` and
 * `answeredAt`, marketplace.questions returned both, and ProductDetail rendered
 * the answer when present - but no procedure could ever write one. Every thread
 * was permanently one-sided while the buyer-facing UI implied a reply was
 * coming.
 *
 * The interesting tests here are the refusals, because "the supplier can
 * answer" is the easy half and "nobody else can" is the half that matters.
 */

function ctxFor(id: number): TrpcContext {
  return {
    user: {
      id, openId: `u-${id}`, email: `u${id}@t.com`, name: `User ${id}`, username: `u${id}`,
      loginMethod: 'password', role: 'user', userRole: 'supplier',
      accountStatus: 'active', onboardingStatus: 'approved', isDummy: false,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext['user'],
    req: { protocol: 'https', headers: {} } as TrpcContext['req'],
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext['res'],
  };
}

/**
 * The stub returns whatever row the test declares for the JOIN, and records
 * updates. It deliberately does NOT filter by the predicate: the procedure's
 * own ownership check is the thing under test, so a stub that pre-filtered
 * would do the procedure's job and every refusal would pass for free.
 */
function stubDb(row: Record<string, unknown> | null) {
  const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const update = vi.fn(() => ({ set }));
  (getDb as ReturnType<typeof vi.fn>).mockResolvedValue({
    select: vi.fn(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(row ? [row] : []),
          orderBy: () => Promise.resolve(row ? [row] : []),
        }),
        where: () => Promise.resolve(row ? [row] : []),
      }),
    })),
    update,
  });
  return { update, set };
}

const OWNER = 5;
const answerable = { questionId: 1, answer: null, supplierId: OWNER, active: true };

describe('only the product owner may answer', () => {
  it('the owning supplier CAN answer - the positive control', async () => {
    const { update, set } = stubDb(answerable);
    const result = await appRouter.createCaller(ctxFor(OWNER)).marketplace
      .answerQuestion({ questionId: 1, answer: 'Yes, it is in stock.' });
    expect(result).toEqual({ id: 1 });
    expect(update).toHaveBeenCalledTimes(1);
    // The answer and its timestamp both land, or the thread shows a reply with
    // no date.
    const written = set.mock.calls[0][0] as { answer: string; answeredAt: Date };
    expect(written.answer).toBe('Yes, it is in stock.');
    expect(written.answeredAt).toBeInstanceOf(Date);
  });

  it('a DIFFERENT supplier cannot answer, and nothing is written', async () => {
    const { update } = stubDb({ ...answerable, supplierId: 999 });
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace
        .answerQuestion({ questionId: 1, answer: 'hijacked' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(update).not.toHaveBeenCalled();
  });

  it('the ASKER cannot answer their own question', async () => {
    // A buyer answering their own public question would be a trust problem, not
    // merely a permissions one.
    const { update } = stubDb({ ...answerable, supplierId: 999 });
    await expect(
      appRouter.createCaller(ctxFor(42)).marketplace
        .answerQuestion({ questionId: 1, answer: 'self-answer' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(update).not.toHaveBeenCalled();
  });

  it('a question that does not exist is NOT_FOUND, not a crash', async () => {
    const { update } = stubDb(null);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace
        .answerQuestion({ questionId: 4242, answer: 'ok' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(update).not.toHaveBeenCalled();
  });

  it('a question on a DELISTED product cannot be answered', async () => {
    // Matches askQuestion: a withdrawn product and an absent one are the same
    // answer to a buyer, so an answer must not appear on nothing.
    const { update } = stubDb({ ...answerable, active: false });
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace
        .answerQuestion({ questionId: 1, answer: 'ok' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(update).not.toHaveBeenCalled();
  });

  it('gives the SAME refusal for absent, not-mine and delisted', async () => {
    // Otherwise the endpoint is an oracle for which question ids exist and
    // which products belong to whom.
    const seen: string[] = [];
    for (const row of [null, { ...answerable, supplierId: 999 }, { ...answerable, active: false }]) {
      stubDb(row);
      await appRouter.createCaller(ctxFor(OWNER)).marketplace
        .answerQuestion({ questionId: 1, answer: 'ok' })
        .catch((error: { code: string; message: string }) => seen.push(`${error.code}:${error.message}`));
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(1);
  });

  it('an already-answered question is not silently overwritten', async () => {
    const { update } = stubDb({ ...answerable, answer: 'Already said this.' });
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace
        .answerQuestion({ questionId: 1, answer: 'changed my mind' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('input bounds match the column', () => {
  it('refuses an empty answer', async () => {
    stubDb(answerable);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace
        .answerQuestion({ questionId: 1, answer: '' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses an answer longer than the field allows', async () => {
    stubDb(answerable);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace
        .answerQuestion({ questionId: 1, answer: 'x'.repeat(2001) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses a non-positive question id', async () => {
    stubDb(answerable);
    await expect(
      appRouter.createCaller(ctxFor(OWNER)).marketplace
        .answerQuestion({ questionId: 0, answer: 'ok' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('a supplier can find the questions waiting on them', () => {
  it('myProductQuestions is scoped to the caller\'s own products', async () => {
    // Asserted on the SOURCE, because the stub cannot prove a predicate it
    // does not apply - and a stub that applied it would be testing itself.
    const { readFileSync } = await import('node:fs');
    const source = readSourceForAssertions(readFileSync(new URL('./routers.ts', import.meta.url), 'utf8'))
      ;
    const body = source.slice(
      source.indexOf('myProductQuestions: protectedProcedure'),
      source.indexOf('myProductQuestions: protectedProcedure') + 900,
    );
    expect(body).toContain('eq(products.supplierId, ctx.user.id)');
    // ...and it must not be reachable by naming somebody else's id.
    expect(body).not.toMatch(/input\./);
  });
});
