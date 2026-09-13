import { TRPCError } from '@trpc/server';
import { getDb } from '../db';

/**
 * THE DATABASE, OR AN HONEST FAILURE. NEVER AN EMPTY LIST.
 *
 * `const db = await getDb(); if (!db) return [];` appeared FORTY-FIVE times in
 * server/routers.ts. Every one of them turns an outage into a statement about
 * the user's data:
 *
 *   "No disputes have been filed"
 *   "You have no RFQs"
 *   "0 products"
 *
 * None of those is true when the database is unreachable, and each is acted on.
 * A supplier seeing an empty catalogue re-uploads it. An administrator seeing
 * no disputes stops looking. The empty state is the ONE thing a read must never
 * fabricate, and it is the easiest to fabricate by accident, because returning
 * `[]` looks like graceful degradation right up to the moment somebody believes
 * it.
 *
 * This is the same reasoning `isSessionRevoked` already applies a few lines
 * below - it fails closed rather than answering "not revoked" it cannot prove -
 * and the same reasoning `recordAccountEvent` applies to the audit trail.
 *
 * WHAT STILL DEGRADES QUIETLY, deliberately:
 *
 *   Fire-and-forget recorders - analytics, commercial audit. They are
 *   side-channels; failing the user's mutation because a metric could not be
 *   written would be the worse outcome, and each says so at its own definition.
 *
 * The message is deliberately about BuildHub rather than about MySQL: a caller
 * needs to know their data could not be loaded, not what the storage engine is.
 *
 * WHY IT LIVES HERE AND NOT IN server/db.ts. Two reasons, and both matter.
 * db.ts is the CONNECTION module - it should not import the transport layer to
 * describe a failure. And every test that drives a procedure mocks './db' with
 * a factory listing the exports it needs; a helper added there would have
 * broken all of them at once and had to be hand-added to each mock, which is a
 * lot of edits for no benefit. Importing `getDb` from here means those mocks
 * keep working untouched and still control what this returns.
 */
export async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'BuildHub could not reach its database. This is not an empty result - please try again.',
    });
  }
  return db;
}
