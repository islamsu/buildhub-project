/**
 * ── NOTIFICATION PREFERENCES ──────────────────────────────────────────────
 *
 * WHAT ALREADY WORKED: `notifyUser` (server/notifications.ts) is a single seam
 * that every one of BuildHub's notification sites already goes through, and
 * every message already carries a `messageKey` naming what it is. Both of
 * those are preconditions for this feature, and both were already true.
 *
 * WHAT WAS MISSING: there was no way to turn anything off. A supplier who
 * lists forty products and is asked a question about each of them received
 * forty notifications and had no recourse but to stop reading the bell, which
 * is the worst possible outcome — it silences the compliance decision sitting
 * two rows below.
 *
 * ── ONE CHANNEL, STATED PLAINLY ───────────────────────────────────────────
 *
 * BuildHub delivers exactly one notification channel today: the in-app row.
 * `server/_core/mailer.ts` is a seam with no configured provider and no
 * notification routed through it, and there is no SMS or push sender at all.
 *
 * So these preferences are per CATEGORY, not per channel. A settings screen
 * offering "Email: on/off" would be a switch wired to nothing — the precise
 * kind of decoration this codebase refuses. When a mail provider is
 * configured and notifications are routed to it, the gate below is the place
 * that decision is already enforced, and a channel axis can be added to the
 * same table without revisiting a single call site.
 *
 * ── MANDATORY IS NARROW, AND DEFINED ──────────────────────────────────────
 *
 * A category is MANDATORY when the message tells you that BuildHub decided
 * something about your account, your money, your legal standing, or a formal
 * proceeding you are party to — or that something you held has been taken
 * away. Those are the messages a user must not be able to switch off, because
 * not receiving one has consequences that outlast the annoyance it saves.
 *
 * Everything else — opportunity, activity, social, good news — is optional and
 * defaults to ON. Nothing here defaults to off: an unasked-for silence is
 * still a silence.
 */

export const NOTIFICATION_CATEGORIES = [
  // ── Mandatory ────────────────────────────────────────────────────────────
  'account',
  'compliance',
  'billing',
  'disputes',
  'moderation',
  // ── Optional ─────────────────────────────────────────────────────────────
  'rfq',
  'quotations',
  'messages',
  'product_qa',
  'reviews',
  'projects',
  'referrals',
  'support',
  'admin_workload',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * The categories a user may not switch off, each with the reason it is on this
 * list. The reason is not decoration: it is what the settings screen shows
 * beside the locked control, so a user is told WHY rather than simply denied.
 */
export const MANDATORY_NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  /** Admin decisions about the identity on the account — a name correction, a review of a requested change. */
  'account',
  /** Registration and document decisions. These carry a legal consequence: an unapproved provider may not trade. */
  'compliance',
  /** Plan changes and the removal of a benefit already granted. Money, and what you are entitled to. */
  'billing',
  /** A formal proceeding you are a party to. Missing a status change can forfeit a response window. */
  'disputes',
  /** Moderation outcomes on content attached to your reputation, including the resolution of a report you filed. */
  'moderation',
] as const;

export const isMandatoryCategory = (category: NotificationCategory): boolean =>
  MANDATORY_NOTIFICATION_CATEGORIES.includes(category);

export const OPTIONAL_NOTIFICATION_CATEGORIES: readonly NotificationCategory[] =
  NOTIFICATION_CATEGORIES.filter(category => !isMandatoryCategory(category));

/**
 * MESSAGE KEY → CATEGORY, resolved by LONGEST MATCHING PREFIX.
 *
 * Prefixes rather than whole keys, because several call sites build their key
 * at runtime — `notif.compliance.document.${input.status}`,
 * `notif.referral.reversed.${outcome.effect}`, `notif.dispute.${change.to}`.
 * A table of literal keys would have to enumerate every status value of every
 * one of those unions and would fall silently out of date the first time a
 * union gained a member.
 *
 * Longest-prefix is what lets two messages in the same namespace land in
 * different categories where they genuinely differ:
 *
 *   notif.review.received        → reviews    (optional: somebody rated you)
 *   notif.review.reportResolved  → moderation (mandatory: a decision was taken)
 *
 *   notif.referral.reward        → referrals  (optional: you gained something)
 *   notif.referral.reversed.*    → billing    (mandatory: it was taken back)
 *
 * That asymmetry is deliberate and is the rule stated above: gaining a benefit
 * is good news you may mute; losing one is an account fact you may not.
 */
export const NOTIFICATION_CATEGORY_PREFIXES: Readonly<Record<string, NotificationCategory>> = {
  // Mandatory
  'notif.vendorName':             'account',
  'notif.compliance':             'compliance',
  'notif.billing':                'billing',
  'notif.referral.reversed':      'billing',
  'notif.dispute':                'disputes',
  'notif.review.reportResolved':  'moderation',
  // Optional
  'notif.rfq':                    'rfq',
  'notif.quotation':              'quotations',
  'notif.message':                'messages',
  'notif.product':                'product_qa',
  'notif.review':                 'reviews',
  'notif.project':                'projects',
  'notif.referral':               'referrals',
  'notif.support':                'support',
  'notif.enquiry':                'admin_workload',
};

/**
 * Resolve a message key to its category, or null when nothing matches.
 *
 * NULL MEANS DELIVER. The gate in server/notificationPreferences.ts fails
 * OPEN on null, and that direction is chosen rather than inherited: an
 * unrecognised key is a gap in this table, and the cost of guessing wrong in
 * the other direction is a message nobody ever sees and nobody knows was
 * suppressed. Over-delivery is visible and complainable; silent suppression is
 * neither.
 *
 * The gap does not get to persist, either — `notificationPreferences.test.ts`
 * reads every messageKey out of the server source and fails if any of them
 * resolves to null, so an unmapped key breaks the build rather than quietly
 * bypassing a preference.
 */
export function categoryForMessageKey(messageKey: string | null | undefined): NotificationCategory | null {
  return resolveCategoryWith(NOTIFICATION_CATEGORY_PREFIXES, messageKey);
}

/**
 * The resolution itself, over a table passed in.
 *
 * Taking the table as an argument is not generality for its own sake - it is
 * what lets a test run THIS function, rather than a copy of it, over a
 * reordered table. The distinction turned out to matter: the prefixes happen
 * to be written specific-before-general, so an implementation that took the
 * FIRST match instead of the LONGEST returned the right answer for every key
 * BuildHub sends today and passed the whole suite. It would have started
 * lying the first time somebody added a prefix in the other order.
 */
export function resolveCategoryWith(
  table: Readonly<Record<string, NotificationCategory>>,
  messageKey: string | null | undefined,
): NotificationCategory | null {
  if (!messageKey) return null;
  let best: { prefix: string; category: NotificationCategory } | null = null;
  for (const [prefix, category] of Object.entries(table)) {
    if (messageKey !== prefix && !messageKey.startsWith(`${prefix}.`)) continue;
    if (!best || prefix.length > best.prefix.length) best = { prefix, category };
  }
  return best?.category ?? null;
}

/** i18n keys. The screen renders these through the same t() as everything else. */
export const notificationCategoryLabel = (category: NotificationCategory) => `notifCategory.${category}`;
export const notificationCategoryHelp = (category: NotificationCategory) => `notifCategory.${category}.help`;
