/**
 * ── Giving an existing db double a transaction ─────────────────────────────
 *
 * Several suites drive procedures through a hand-rolled db double: an object
 * with `select` and `insert` that returns fixed rows. That was enough while
 * rfq.create and rfq.submitQuotation wrote directly.
 *
 * Both now run inside db.transaction() and take a `SELECT ... FOR UPDATE` on
 * the actor's users row first, because without that lock two concurrent
 * submissions each read "no recent duplicate" and both insert - measured at two
 * rows, three runs out of three, against the real server.
 *
 * That change broke six suites with `db.transaction is not a function` and
 * `tx.select is not a function`. THOSE ARE DOUBLE LIMITATIONS, NOT BEHAVIOUR
 * REGRESSIONS: the procedures do the right thing, and the stand-ins simply
 * cannot express it. The fix belongs here rather than in six copies, and
 * emphatically not in reverting the lock.
 *
 * WHAT THIS DOES NOT DO. It does not simulate isolation, locking, rollback or
 * concurrency - a JavaScript object cannot, and pretending otherwise would be
 * worse than not trying. It makes the transactional shape callable so these
 * suites keep testing what they were written to test: which rows are written
 * and who gets notified. The concurrency behaviour is proven where it is real,
 * against MariaDB, by the parallel-request probe.
 */

import { quotations, rfqs, users } from '../../drizzle/schema';

type AnyFn = (...args: unknown[]) => unknown;
type Chainable = Record<string, unknown>;

/**
 * A query chain that tolerates the builder calls the real code makes -
 * .where(), .orderBy(), .limit(), .for('update'), .leftJoin() - in any order,
 * and resolves to whatever the underlying double returned for .where().
 *
 * Thenable rather than a Promise so `await tx.select().from(x).where(y)` and
 * `await tx.select().from(x).where(y).limit(1)` both work against doubles that
 * only ever implemented .where().
 */
function chainFrom(pending: unknown, fixed?: unknown[]): Chainable {
  let settled: unknown = fixed ?? pending;
  const chain: Chainable = {
    where: (...args: unknown[]) => {
      if (fixed) return chain;
      const inner = (pending as { where?: AnyFn })?.where;
      if (typeof inner === 'function') settled = inner.apply(pending, args);
      return chain;
    },
    leftJoin: () => chain,
    innerJoin: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    offset: () => chain,
    groupBy: () => chain,
    for: () => chain,
    then: (resolve: AnyFn, reject: AnyFn) =>
      Promise.resolve(settled ?? []).then(resolve as never, reject as never),
  };
  return chain;
}

/**
 * WHAT A SELECT INSIDE THESE TRANSACTIONS IS ACTUALLY ASKING.
 *
 * rfq.create and rfq.submitQuotation each make exactly two queries inside their
 * transaction, and nothing else:
 *
 *   FROM users  - the `SELECT ... FOR UPDATE` that serialises this actor
 *   FROM rfqs / FROM quotations  - "did this same person submit this same thing
 *                                  seconds ago?"
 *
 * The second one must answer NO for a first submission, which is what every
 * suite using these doubles is testing. Delegating it to the underlying double
 * answers YES, because those doubles return one fixed row for every table -
 * so the procedure concluded the caller had already submitted, returned early,
 * and notified nobody. Six suites failed that way, and they were right to: they
 * were pointing at a double that cannot tell `quotations` from `rfqs`.
 *
 * The default here is therefore "the actor exists, and there is no recent
 * identical submission", which is the state a first submission is made in. Pass
 * `recentDuplicate` to test the other branch.
 */
function makeTx(db: Record<string, unknown>, options: TxOptions): Record<string, unknown> {
  const select = (...args: unknown[]) => {
    // LAZY on purpose. Calling the underlying double for a query this helper
    // answers itself makes the double's spy see calls the procedure never
    // delegated - which broke "creating an RFQ without a projectId does no
    // project lookup", a test that was still exactly right.
    let innerCached: { from?: AnyFn } | undefined;
    let innerResolved = false;
    const inner = () => {
      if (!innerResolved) {
        innerCached = (db.select as AnyFn | undefined)?.(...args) as { from?: AnyFn } | undefined;
        innerResolved = true;
      }
      return innerCached;
    };
    // THE COLUMN LIST IS WHAT DISTINGUISHES THESE QUERIES, not the table.
    //
    // Keying on the table alone was wrong and the suite said so:
    // acceptQuotationSecure, rejectQuotationSecure and closeRfqSecure all read
    // `tx.select().from(rfqs)` - the whole row - inside their own transactions,
    // and hijacking that handed them a stub without a requesterId, so four
    // tests failed with "You do not own this RFQ".
    //
    // The lock and the duplicate probe both select exactly one column, `id`.
    // The business reads select either everything or named business columns.
    // That is a real distinction in the code, not a convenient one.
    const columns = args[0];
    const isIdProbe = typeof columns === 'object' && columns !== null
      && Object.keys(columns as object).length === 1
      && Object.prototype.hasOwnProperty.call(columns, 'id');
    return {
      from: (table: unknown) => {
        if (isIdProbe && table === users) return chainFrom(undefined, [{ id: options.actorId ?? 1 }]);
        if (isIdProbe && (table === rfqs || table === quotations)) {
          return chainFrom(undefined, options.recentDuplicate ? [options.recentDuplicate] : []);
        }
        return chainFrom(inner()?.from?.(table));
      },
    };
  };
  return {
    ...db,
    select,
    // insert/update/delete pass straight through, so a suite's existing spies
    // still see exactly the calls they assert on.
    insert: db.insert,
    update: db.update,
    delete: db.delete,
  };
}

export type TxOptions = {
  /** The id the locked users row reports. Rarely matters; the lock is a lock. */
  actorId?: number;
  /** Present -> the duplicate check finds a recent identical submission. */
  recentDuplicate?: { id: number };
};

/**
 * Wraps a db double so `db.transaction(fn)` runs `fn` immediately with a `tx`
 * that delegates to the same double. The callback's return value is returned,
 * matching drizzle.
 */
export function withTransaction<T extends object>(db: T, options: TxOptions = {}): T {
  const record = db as unknown as Record<string, unknown>;
  // AUGMENT, DO NOT REPLACE.
  //
  // Two shapes of existing double turned up, and they need opposite treatment:
  //
  //   notificationDestinations already hands its tx a TABLE-AWARE select
  //   carrying the RFQ's real requesterId. Replacing that produced "You do not
  //   own this RFQ" on four tests with nothing wrong with them.
  //
  //   rfqBasket and reviewsAuthorization have a transaction whose tx only ever
  //   implemented `insert`, because rfq.create only ever inserted inside it.
  //   Leaving those alone produced "tx.select is not a function".
  //
  // So: keep whatever the double provides, and fill in only what is missing.
  const existing = record.transaction;
  if (typeof existing === 'function') {
    return Object.assign({}, db, {
      transaction: async (fn: (t: unknown) => unknown) =>
        (existing as AnyFn).call(record, (innerTx: Record<string, unknown>) => {
          const augmented = typeof innerTx?.select === 'function'
            ? innerTx
            : { ...innerTx, select: makeTx(record, options).select };
          return fn(augmented);
        }),
    }) as T;
  }
  const tx = makeTx(record, options);
  return Object.assign({}, db, {
    transaction: async (fn: (t: unknown) => unknown) => fn(tx),
  }) as T;
}

/**
 * A `select` that answers by WHICH TABLE was queried.
 *
 * The doubles these suites were built with answer every select with the same
 * fixed row. That was harmless while a procedure made one query. It stopped
 * being harmless the moment rfq.submitQuotation made three - lock the user,
 * look for a recent identical bid, read the RFQ - because the "recent identical
 * bid" lookup was handed the RFQ row and concluded the supplier had already
 * bid, so the procedure returned early and notified nobody.
 *
 * The test was right to fail. It was pointing at a double that could not tell
 * `quotations` from `rfqs`, which is the same class of blind spot that once let
 * "exactly one message stored" pass while the wrong table was written.
 *
 * Pass the drizzle table objects themselves; identity comparison, no names.
 */
export function selectByTable(rowsByTable: Map<unknown, unknown[]>, fallback: unknown[] = []) {
  return (..._columns: unknown[]) => ({
    from: (table: unknown) => {
      const rows = rowsByTable.get(table) ?? fallback;
      const chain: Chainable = {
        where: () => chain,
        leftJoin: () => chain,
        innerJoin: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        offset: () => chain,
        groupBy: () => chain,
        for: () => chain,
        then: (resolve: AnyFn, reject: AnyFn) => Promise.resolve(rows).then(resolve as never, reject as never),
      };
      return chain;
    },
  });
}
