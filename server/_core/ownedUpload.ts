/**
 * ── "IS THIS FILE YOURS TO CLAIM?" — ONE RULE, ONE PLACE ──────────────────
 *
 * Reading an image and CLAIMING one are different acts with different rules.
 * The storage proxy decides who may read a key; this decides who may point a
 * database row at it.
 *
 * That distinction is the whole reason the rule exists. `product-images/` and
 * `portfolio-images/` are both readable by any authenticated user, because a
 * catalogue nobody can see is not a catalogue. So the protection cannot live
 * on the read side: it lives here, on the write, and stops a supplier pointing
 * their listing - or a provider pointing their portfolio - at somebody else's
 * photograph and passing the work off as their own.
 *
 * It was written once for `setProductImages` and then needed a second time for
 * the portfolio, which is exactly the moment a security rule normally gets
 * copied and starts to drift. Extracted instead, with the traversal defence
 * intact, so both callers refuse the same things for the same reasons.
 */
import { TRPCError } from '@trpc/server';

/** The public path prefix a given user's uploads of a given family live under. */
export function ownedUploadPrefix(family: string, userId: number): string {
  return `/manus-storage/${family}/user-${userId}/`;
}

/**
 * Every reference must sit inside the caller's own prefix, and must still be
 * inside it after the remainder is read.
 *
 * STARTSWITH ALONE IS NOT ENOUGH. `.../user-5/../../secret.png` begins with the
 * caller's own prefix and then climbs out of it. The storage proxy would refuse
 * such a key on READ, but without this the row would still store a path that
 * means something other than it appears to, and the next reader of that column
 * has no reason to expect one.
 */
export function assertOwnedUploads(
  references: readonly string[],
  family: string,
  userId: number,
  message = 'You may only use images you uploaded.',
): void {
  const prefix = ownedUploadPrefix(family, userId);
  for (const reference of references) {
    const refuse = () => { throw new TRPCError({ code: 'FORBIDDEN', message }); };
    if (!reference.startsWith(prefix)) refuse();
    const remainder = reference.slice(prefix.length);
    const traverses = remainder.length === 0
      || remainder.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..');
    if (traverses) refuse();
  }
}
