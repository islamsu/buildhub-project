/**
 * ── THE PRODUCT LIFECYCLE MOVE, FOR A PROBE ───────────────────────────────
 *
 * A probe cannot `update products set status=...` to set up its negative
 * cases. `server/productLifecycle.ts` owns the transition table, writes the
 * derived `active` boolean, refuses archiving a product with a live placement
 * and records both audit trails - so a raw UPDATE produces a row the
 * application would never have written, and any test built on it is testing
 * an impossible state. That is how the previous DELISTED finding came to be
 * reported: `update products set active=0` left `status` publicly eligible.
 *
 * So this is a thin argv wrapper around the real function. A FILE rather than
 * `tsx -e` because -e compiles to CJS (no top-level await) and because a
 * multi-line script passed through shell quoting failed in a way that printed
 * a 2kB Buffer dump instead of a reason.
 *
 * Prints exactly one line: `OK <json>` or `REFUSED <code> <message>`.
 */
import 'dotenv/config';
import { getDb } from '../../server/db';
import { transitionProduct, ProductLifecycleError } from '../../server/productLifecycle';
import type { ProductStatus } from '../../shared/productLifecycle';

const [productId, supplierId, to] = process.argv.slice(2);

const db = await getDb();
if (!db) {
  console.log('REFUSED NO_DB the probe could not reach the database');
  process.exit(0);
}

try {
  const result = await transitionProduct(db, {
    productId: Number(productId),
    supplierId: Number(supplierId),
    to: to as ProductStatus,
  });
  console.log(`OK ${JSON.stringify(result)}`);
} catch (error) {
  const code = error instanceof ProductLifecycleError ? error.code : 'UNEXPECTED';
  console.log(`REFUSED ${code} ${error instanceof Error ? error.message : String(error)}`);
}
process.exit(0);
