/**
 * THE ACCOUNT AUDIT TRAIL HAS ONE WRITER.
 *
 * `db.insert(userAccountAuditEvents).values({...})` appeared FORTY-SIX times,
 * hand-rolled at each site, while its sibling `commercialAuditEvents` had a
 * single helper. That asymmetry is the defect: with no shared entry point,
 * every new privileged action has to remember to write its own audit row, in
 * the right shape, with an action name nothing checks - and nothing
 * structurally notices when one forgets.
 *
 * Two things follow from centralising it.
 *
 * A NAMED VOCABULARY. `action` is a varchar, so `admin_role_change` and
 * `admin_role_changed` are equally acceptable to the database and only one of
 * them is findable by whoever later asks "who changed that role". The union
 * below is the whole vocabulary; adding an action is a deliberate edit here,
 * not a string typed at a call site.
 *
 * IT THROWS, AND THAT IS DELIBERATE - it is the one place this differs from
 * recordCommercialEvent, which logs and swallows. These rows record who
 * created an administrator, who changed a role, who revoked whose sessions.
 * For a privileged action, "the action happened but we failed to record who
 * did it" is not a degraded success, it is the outcome an attacker wants. The
 * existing 46 call sites already awaited the insert and so already failed the
 * mutation if the write failed; preserving that is both the safer posture and
 * the smaller change.
 */
import { userAccountAuditEvents } from '../../drizzle/schema';

/**
 * Every action the trail records.
 *
 * Grouped by what they are about, and deliberately exhaustive: a call site
 * cannot invent a forty-seventh without adding it here, which is the point.
 */
export const ACCOUNT_AUDIT_ACTIONS = [
  // Account lifecycle
  'account_created',
  'oauth_identity_linked',
  'password_account_created',
  'profile_role_completed',

  // Authentication
  'admin_signed_in',
  'password_signed_in',
  'dummy_user_signed_in',
  'password_reset_requested',
  'password_reset_completed',
  'password_set_via_invitation',

  // Administrator authority
  'super_admin_bootstrapped',
  'admin_created',
  'admin_role_changed',
  'admin_activated',
  'admin_reactivated',
  'admin_deactivated',
  'admin_sessions_revoked',
  'admin_password_changed',
  'admin_password_reset_requested',
  'admin_invitation_redeemed',
  'admin_invitation_revoked',

  // Administrator acting on a user account
  'admin_created_account',
  'admin_created_account_with_invite',
  'admin_user_updated',
  'invitation_resent',
  'account_frozen',
  'account_unfrozen',

  // QA personas
  'dummy_user_created',
  'dummy_user_deleted',
  'dummy_user_activated',
  'dummy_user_deactivated',
  'dummy_user_password_changed',
  'test_login_link_issued',
  'test_login_link_redeemed',
  'test_login_link_revoked',

  // Entitlements and commercial placement
  'plan_changed_manually',
  'enquiry_allowance_changed',
  'enquiries_exported',
  'placement_booked',
  'featured_granted',
  'featured_removed',
  'sponsorship_granted',
  'sponsorship_revoked',

  // Referral
  'referral_campaign_created',
  'referral_campaign_updated',
  'referral_qualified',
  'referral_reward_granted',
  'referral_reward_reversed',
  /**
   * A referral code at signup that matched no account, or matched the signer
   * themselves. Recorded because the branch that dropped it did so in silence:
   * somebody walking the code space left no trace, and a real user who mistyped
   * a friend's code had no record of why they were never credited.
   */
  'referral_code_unusable',

  // ── Disputes ─────────────────────────────────────────────────────────────
  // A dispute is a record two parties are entitled to see the shape of, so
  // every transition on it is an account event as well as a status-history row.
  'dispute_opened',
  'dispute_status_changed',
  'dispute_withdrawn',
  'dispute_reopened',
  'dispute_assigned',
  'dispute_resolved',
  'dispute_evidence_added',
  'dispute_evidence_removed',

  // Vendor identity
  'vendor_name_change_requested',
  'vendor_name_change_under_review',
  'vendor_name_change_needs_information',
  'vendor_name_change_approved',
  'vendor_name_change_rejected',
  'vendor_name_direct_correction',
] as const;

export type AccountAuditAction = (typeof ACCOUNT_AUDIT_ACTIONS)[number];

/** Where the action came from. Context for a reader, not a second copy of `action`. */
export const ACCOUNT_AUDIT_SOURCES = [
  'admin', 'admin_created', 'admin_export', 'admin_invite', 'admin_login',
  'admin_management', 'bootstrap', 'dummy', 'password', 'referral',
  'self_registered', 'vendor_name_change',
] as const;

export type AccountAuditSource = (typeof ACCOUNT_AUDIT_SOURCES)[number];

export type AccountAuditEvent = {
  /** The account the event is ABOUT. Null only where the subject is already gone. */
  userId: number | null;
  /** Who did it. Null means the platform itself, never "unknown". */
  actorId: number | null;
  action: AccountAuditAction;
  source?: AccountAuditSource | string | null;
  /**
   * Short human context - which field changed, which identity, which reason.
   *
   * NEVER a credential, never a token, never a password. An audit trail is
   * read by more people than the record it describes.
   */
  note?: string | null;
};

/** Context is context, not a payload. Long notes are truncated, not stored whole. */
export const MAX_ACCOUNT_AUDIT_NOTE = 1000;

/**
 * Write one row. Throws if it cannot - see the header for why.
 */
export async function recordAccountEvent(db: any, event: AccountAuditEvent): Promise<void> {
  await db.insert(userAccountAuditEvents).values({
    userId: event.userId,
    actorId: event.actorId,
    action: event.action,
    source: event.source ?? null,
    note: event.note == null ? null : String(event.note).slice(0, MAX_ACCOUNT_AUDIT_NOTE),
  });
}
