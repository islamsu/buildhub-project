/**
 * A NAME IN THE ADMIN CONSOLE IS A WAY INTO THE RECORD.
 *
 * Nineteen admin surfaces render a person or a business by name. Six of them
 * made that name a link to the account; thirteen printed it as text, so an
 * administrator reading a support ticket, a sponsorship or a compliance
 * application had the name in front of them and no way to act on it - they
 * went back to User Management and searched for it again, or worse, worked
 * from the row id.
 *
 * The six that DID link had each written the link themselves, in four
 * different spellings, one of them a `<button onClick={navigate}>` rather than
 * an anchor - so the same idea behaved differently depending on which screen
 * you were on, and only some of them could be opened in a new tab.
 *
 * This is that link, once. It is deliberately small: the destination is the
 * canonical user record, not a second read-only profile rendered inside
 * whatever screen you happen to be on.
 *
 * WOUTER'S <Link> RENDERS ITS OWN <a>. Nesting one inside produces invalid
 * HTML and an element with no href, which is how a link becomes decorative
 * without anybody noticing. className and data-testid go on the Link itself.
 */
import type { ReactNode } from 'react';
import { Link } from 'wouter';

/** The name to show, falling back to the id only when there is no name. */
function label(name: string | null | undefined, id: number): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : `#${id}`;
}

export function AdminUserLink({
  id,
  name,
  testId,
  className = '',
  children,
}: {
  id: number | null | undefined;
  name?: string | null;
  testId?: string;
  className?: string;
  /**
   * Richer content than a name - an avatar, an icon, a two-line row.
   *
   * Some of these destinations were whole clickable ROWS built as
   * `<button onClick={navigate}>`, which cannot be middle-clicked, opened in a
   * new tab or copied as a link. Taking children lets them be anchors without
   * flattening them to text.
   */
  children?: ReactNode;
}) {
  /*
   * NO ID, NO LINK. A row whose actor has been deleted, or a system action
   * with no actor at all, must not render a control that goes nowhere - a
   * dead link reads as a broken product rather than as an absent record.
   */
  if (id === null || id === undefined || !Number.isFinite(id) || id <= 0) {
    return (
      <span className={`text-muted-foreground ${className}`.trim()}>
        {children ?? ((name ?? '').trim() || '—')}
      </span>
    );
  }

  return (
    <Link
      href={`/admin/users/${id}`}
      data-testid={testId ?? `admin-user-link-${id}`}
      className={`underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm ${className}`.trim()}
    >
      {children ?? label(name, id)}
    </Link>
  );
}

export default AdminUserLink;
