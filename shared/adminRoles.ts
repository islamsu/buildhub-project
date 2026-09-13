// ── Administrator roles and permissions ────────────────────────────────────
//
// THE single source of truth for what each kind of administrator may do.
// Imported by the server to enforce, and by the admin UI to decide what to
// render. The server never trusts the client's copy - the UI uses this to avoid
// showing a control the server will refuse, which is a usability concern, not a
// security one.
//
// WHY THIS IS CODE AND NOT THREE DATABASE TABLES
//
// The obvious shape is adminRoles + adminPermissions + adminRolePermissions.
// It was not built, deliberately:
//
//   - A permission model in code is reviewed like code. Granting
//     MARKETPLACE_ADMIN the ability to create administrators becomes a diff
//     someone has to approve, not an UPDATE somebody can run at 2am.
//   - There is then NO runtime path that can grant a permission. Privilege
//     escalation needs a deploy, not a row.
//   - The set of permissions is small, closed, and changes with the product,
//     not with the data. Nothing here is per-tenant or user-authored.
//
// The cost is that changing the map needs a release. That is the point.
//
// If per-administrator overrides beyond their role are ever wanted, THAT needs
// a table - it is genuinely per-row data - and it should be additive to this,
// not a replacement for it.

export const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'USER_ADMIN',
  'MARKETPLACE_ADMIN',
  'SUPPORT_ADMIN',
  'BILLING_ADMIN',
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && (ADMIN_ROLES as readonly string[]).includes(value);
}

/**
 * Every capability the admin surface can gate on.
 *
 * Deliberately coarse. A permission per endpoint would be 37 permissions
 * nobody can reason about; these are the groupings an actual job description
 * would use, which is what "least privilege" has to mean in practice to be
 * applied correctly rather than just extensively.
 */
export const ADMIN_PERMISSIONS = [
  /** Create, edit, deactivate administrators and change their roles. */
  'admins.manage',
  /** Read the user directory and a user's account audit trail. */
  'users.read',
  /** Verify, freeze, invite and otherwise act on normal user accounts. */
  'users.manage',
  /** Vendor directory, products, compliance review, marketplace content. */
  'marketplace.manage',
  /** Disputes and user assistance. */
  'support.manage',
  /** Read subscription and billing state. */
  'billing.read',
  /** Change subscription state, record payments, run reconciliation. */
  'billing.manage',
  /** Read the platform-wide audit log and analytics. */
  'audit.read',
  /** Create QA/dummy personas and issue staging sign-in links. */
  'qa.manage',
  /** Platform settings. */
  'settings.manage',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/**
 * Role → permissions.
 *
 * SUPER_ADMIN is the only role holding `admins.manage`, so it is the only role
 * that can create or re-role an administrator. That is what makes every other
 * role incapable of privilege escalation: there is no permission they hold that
 * can reach the authority model at all.
 *
 * `qa.manage` is likewise SUPER_ADMIN only for now. QA personas can sign into
 * staging as any business role, so issuing one is closer to account creation
 * than to support work.
 */
export const ADMIN_ROLE_PERMISSIONS: Readonly<Record<AdminRole, readonly AdminPermission[]>> = {
  SUPER_ADMIN: [...ADMIN_PERMISSIONS],
  USER_ADMIN: ['users.read', 'users.manage', 'audit.read'],
  MARKETPLACE_ADMIN: ['users.read', 'marketplace.manage'],
  SUPPORT_ADMIN: ['users.read', 'support.manage'],
  BILLING_ADMIN: ['users.read', 'billing.read', 'billing.manage'],
};

/**
 * Does this administrator hold this permission?
 *
 * Fails closed on every unexpected input: null (an admin row with no role yet),
 * an unrecognised string (a role removed in a later release but still on a row),
 * or anything that is not a string at all. An administrator whose role cannot
 * be resolved has NO permissions rather than default ones.
 */
export function hasAdminPermission(role: unknown, permission: AdminPermission): boolean {
  if (!isAdminRole(role)) return false;
  return ADMIN_ROLE_PERMISSIONS[role].includes(permission);
}

/** Every permission this role holds, for the UI and for `admin.me`. */
export function permissionsForAdminRole(role: unknown): AdminPermission[] {
  return isAdminRole(role) ? [...ADMIN_ROLE_PERMISSIONS[role]] : [];
}

/** Display labels. English is canonical; Arabic is display-only, never stored. */
export const ADMIN_ROLE_LABELS: Readonly<Record<AdminRole, { en: string; ar: string }>> = {
  SUPER_ADMIN: { en: 'Super Admin', ar: 'مدير عام' },
  USER_ADMIN: { en: 'User Admin', ar: 'مدير المستخدمين' },
  MARKETPLACE_ADMIN: { en: 'Marketplace Admin', ar: 'مدير السوق' },
  SUPPORT_ADMIN: { en: 'Support Admin', ar: 'مدير الدعم' },
  BILLING_ADMIN: { en: 'Billing Admin', ar: 'مدير الفوترة' },
};

/**
 * THE MINIMUM LENGTH OF AN ADMINISTRATOR'S PASSWORD, IN ONE PLACE.
 *
 * It lived as a server-local const in routers.ts while the invitation screen
 * carried its own copy under the comment "Matches ADMIN_PASSWORD_MIN_LENGTH on
 * the server" - which is a comment doing a compiler's job, and which drifts
 * silently the moment one side changes. A third copy was about to be written
 * for the change-your-own-password form, so the number moved here instead.
 *
 * Deliberately longer than the ordinary account minimum: an administrator
 * password is worth more, so it has to cost more to guess.
 */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;
