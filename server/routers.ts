import { z } from 'zod';
import { COOKIE_NAME, NOT_ADMIN_ERR_MSG } from '@shared/const';
import {
  ADMIN_ROLES, ADMIN_PASSWORD_MIN_LENGTH, isAdminRole, hasAdminPermission, permissionsForAdminRole,
  type AdminPermission, type AdminRole,
} from '@shared/adminRoles';
import { getSessionCookieOptions } from './_core/cookies';
import { systemRouter } from './_core/systemRouter';
import { publicProcedure, protectedProcedure, router } from './_core/trpc';
import type { TrpcContext } from './_core/context';
import { TRPCError } from '@trpc/server';
import { getDb, getUserByEmail, getUserByUsername, normalizeEmail, normalizeUsername, revokeSession } from './db';
import { requireDb } from './_core/requireDb';
import { hashPassword, verifyPassword, NO_SUCH_ACCOUNT_HASH } from './passwords';
import { generateAIResponse, isAiConfigured, AiError, type AiFailureCategory } from './_core/ai';
import { buildSystemPrompt, type KnowledgeLanguage } from './_core/buildhubKnowledge';
import { detectIntent } from './_core/aiIntent';
import { recommendProviders, formatCandidatesForModel } from './recommendation';
import { formatRetrievalForModel } from './_core/knowledgeRetrieval';
import { retrieveSemantic, semanticRankingAvailable } from './_core/semanticRetrieval';
import { findRegulatory, formatRegulatoryForModel } from './knowledge/jurisdictions';
import { storagePut } from './storage';
import { getObjectStorage, ObjectStorageNotConfiguredError } from './_core/objectStorage';
import { validateAiAttachment, attachmentInstruction } from './_core/aiAttachments';
import { MAX_AI_ATTACHMENTS_PER_MESSAGE } from '@shared/aiAttachments';
import { DOCUMENT_TYPES, IMAGE_TYPES, checkUploadedFile } from './_core/fileType';
import { isAllowedRfqAttachmentType, MAX_RFQ_ATTACHMENT_SIZE } from './rfqAttachments';
import { acceptQuotationSecure, closeRfqSecure, rejectQuotationSecure } from './quotationWorkflow';
import { aiChatLimiters, authLimiters, contentLimiters, getClientIp } from './_core/rateLimit';
import { recordEventAsync } from './analytics/events';
import { ANALYTICS_EVENTS } from '@shared/analyticsEvents';
import { getEventCounts, getMedianDaysToMilestone, getVendorFunnel } from './analytics/events';
import { getChurn, getCommercialKpis } from './analytics/kpis';
import { ENV, isTestLoginEnabled } from './_core/env';
import { getMailer, isMailerConfigured } from './_core/mailer';
import { notifyUser, notifyUsers } from './notifications';
import { containsTerm, MAX_SEARCH_LENGTH } from './_core/searchTerms';
import { recordAccountEvent } from './_core/accountAudit';
import { listAdminUsers, type AdminDirectoryPage } from './adminUserDirectory';
import { runDataQualityChecks } from './admin/dataQuality';
import { readOperationalHealth } from './admin/operationalHealth';
import { runPlatformSearch } from './admin/platformSearch';
import { qualifyReferralEvent } from './referralEngine';
import {
  assertSuperAdminSurvives, assertUserDirectoryMutationAllowed,
} from './adminAuthority';
import { bookPlacement } from './placementBooking';
import {
  applyBoost, boostCandidates, masterProduct, masterProvider,
  spotlightProducts, spotlightProviders,
} from './publicPlacement';
import { placementPerformance, recordPlacementEvent } from './placementAnalytics';
import { ENQUIRY_STATES, RFQ_STATUSES, enquiryReference, parseEnquiryReference } from './vendorEnquiry';
import { PERSON_NOTE_FORBIDDEN_MESSAGE, mayReadPersonNotes, mayWritePersonNotes } from './vendorEnquiryAdminActions';
import { ASSIGNEE_INELIGIBLE_MESSAGE, assignEnquiry, assignableAdmins, currentAssignment, isAssignable } from './enquiryAssignment';
import { BULK_ASSIGN_LIMIT, ENQUIRY_EXPORT_LIMIT, ENQUIRY_LIST_MAX_LIMIT, enquiryDetail, enquiryList, enquiryOverview, iso, toCsvRow } from './vendorEnquiryQuery';
import { PLACEMENT_CLIENT_EVENTS, PLACEMENT_METRIC_FORMULAS } from '@shared/placementAnalytics';
import { formatProjectContext, resolveProjectContext } from './_core/projectContext';
import { isAllowedProjectDocumentType, clampProjectProgress } from '../shared/projectFeatures';
import {
  projects, milestones, tasks, documents, products,
  rfqs, quotations, messages, notifications, reviews,
  dailyLogs, expenses, users, disputes, adminSettings, progressReports, productQuestions,
  commercialAuditEvents,
  registrationDocuments, registrationDocumentSubmissions, registrationReviewEvents, testLoginTokens, adminInvitations, userAccountAuditEvents,
  aiAttachments, rfqItems, qualifiedEnquiries,
  projectMembers, rfqSuppliers, portfolioItems, vendorProfiles, vendorNameChangeRequests, adminNotes, referrals, referralCampaigns, referralRewards,
} from '../drizzle/schema';
import { and, desc, eq, gte, inArray, isNull, like, notInArray, or, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getComplianceRequirements, isComplianceRole, type ComplianceStatus, type ComplianceDocumentStatus } from '../shared/compliance';
import { sdk, type AuthenticatedUser } from './_core/sdk';
import {
  BILLING_CURRENCY, ENTITLEMENT_ENFORCEMENT, FOUNDER_OFFER_ENDS_AT_SETTING_KEY, FOUNDER_OFFER_MONTHS,
  GRACE_PERIOD_DAYS, PLAN_IDS, PLANS, TRIAL_DAYS, annualSavings, isEntitlementEnforced,
  type PlanEntitlements,
} from '@shared/billing';
import {
  ADMIN_SUBSCRIPTION_COLUMNS, checkFounderEligibility, getBillingState, getBillingEvents, getSubscription,
} from './billing/service';
import { deriveBillingState } from './billing/domain';
import { MAX_PRODUCT_IMAGE_SIZE, MAX_PRODUCT_IMAGES } from '@shared/productImages';
import { recordCommercialEvent } from './_core/commercialAudit';
import {
  changeVendorPlan,
  getLifecycleSnapshot,
  recordPaymentFailure,
  recordPaymentRecovery,
  recordPaymentSucceeded,
  reconcileDueSubscriptions,
  reconcileSubscription,
  requestCancellation,
  resumeSubscription,
  setVendorPlanManually,
  startPaidTrial,
  type LifecycleOutcome,
} from './billing/lifecycle';
import { resolveVendorEntitlements, toVendorEntitlementResponse } from './billing/entitlements';
import { readOwnVendorProfile, readVendorProfile, saveOwnVendorProfile } from './vendorProfile';
import { featureVendor, grantSponsorship, listFeaturedPlacements, listSponsorships, revokeSponsorship } from './vendorSponsorship';
import {
  declineInvitation, inviteSupplier, listInvitations, markInvitationResponded, requireInviteRights,
} from './rfqInvitations';
import {
  MAX_ENQUIRY_ALLOWANCE, readEnquiryAllowance, setEnquiryAllowance,
} from './billing/overrides';
import {
  HISTORY_FIELDS, readFieldHistory, recordChangedFields, recordFieldChange, recordFieldChanges,
} from './audit/fieldHistory';
import { isPaymentProviderConfigured } from './billing/provider';
import {
  getEnquiryUsage, getRfqResponseAccess, getVendorCategories, listEligibleRfqs, openQualifiedEnquiry,
} from './billing/enquiries';
import {
  FEATURED_PLACEMENT_SLOTS, getVendorTargetingDiagnostics, listDirectoryCategories,
  listDirectoryVendors, listFeaturedProviders, listFeaturedVendors, listSponsoredVendors,
} from './vendorDirectory';
import { getPlatformStats } from './platformStats';
import {
  MAX_BASKET_ITEMS, MAX_ITEM_NAME, MAX_ITEM_SPECIFICATIONS, MAX_ITEM_UNIT,
  MAX_ITEM_VARIANT, MAX_ITEM_QUANTITY, MIN_ITEM_QUANTITY,
} from '../shared/rfqBasket';
import { importTemplateCsv, MAX_IMPORT_BYTES, parseProductImport } from '../shared/productImport';
import { loadCategoryIndex, resolveCategory as resolveProductCategory, importCategoryResolver, listableCategories, publicCategories } from './categoryService';
import {
  listCategoriesForAdmin, createCategory, updateCategory, setCategoryStatus,
  addCategoryAlias, removeCategoryAlias, CategoryAdminError,
  CATEGORY_SCOPES, CATEGORY_STATUSES,
} from './categoryAdmin';
import { normaliseUnit, PRODUCT_UNITS } from '../shared/productUnits';
import { canCreateProject, creatorProjectRole, PROJECT_ROLES, capabilitiesFor } from '../shared/projectAccess';
import { requireProjectAccess, readableProjectIds, liveMembership } from './projectMembership';
import { RFQ_CATEGORIES, isRfqCategory } from '@shared/rfqCategories';
import { vendorCategories, vendorSponsorships, vendorSubscriptions } from '../drizzle/schema';
import { findRfqOpportunities, formatOpportunitiesForModel, isRfqSeekingRole } from './opportunity';

const scryptAsync = promisify(scryptCallback);

/**
 * Floor for any password BuildHub itself sets or accepts.
 *
 * `admin.completeInvitation` predates this and still accepts 6, which is left
 * alone deliberately - raising it would invalidate invitation links already in
 * flight without warning anyone.
 */
const PASSWORD_MIN_LENGTH = 8;

/** How long a password-reset link stays usable. */
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/**
 * ── Admin-issued QA sign-in links (Phases 7-9) ─────────────────────────────
 *
 * The replacement for the public "Dummy / Test user sign-in" form. That form
 * advertised a test-login pathway to every visitor and had no environment
 * boundary; this is admin-only to issue, staging-only to redeem, expiring,
 * single-use and revocable.
 *
 * A LINK IS A CREDENTIAL, so it is treated like one: 32 random bytes, and only
 * its sha256 is stored. The raw token is returned to the issuing admin exactly
 * once and never persisted, so a dump of testLoginTokens yields nothing
 * redeemable.
 *
 * sha256 with no salt is correct HERE and would be wrong for a password: the
 * input is 256 bits of CSPRNG output, not a human-chosen secret, so there is
 * no dictionary to attack and nothing for a salt to defend against. The unique
 * index on the hash is what makes redemption one indexed lookup instead of a
 * scan.
 */
const TEST_LOGIN_TOKEN_BYTES = 32;
const TEST_LOGIN_TTL_MINUTES_DEFAULT = 60;
const TEST_LOGIN_TTL_MINUTES_MAX = 24 * 60;

const hashTestLoginToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

const generateReferralCode = () => `BH-${randomBytes(8).toString('hex').toUpperCase()}`;

/**
 * A PASSWORD RESET LINK IS A CREDENTIAL TOO.
 *
 * testLoginTokens and adminInvitations both store only a hash, and the schema
 * says why: "a dump of this table yields nothing an attacker can redeem. Same
 * reasoning as storing a password hash rather than a password - a link IS a
 * credential." The password-reset path was the one place that rule was not
 * applied: users.passwordResetToken held the raw token and resetPassword
 * compared it directly, so any read of the users table - a backup, a dump, an
 * injection - handed over a live, redeemable reset for every account with a
 * pending request.
 *
 * Same construction as the other two, and for the same reason: the token is
 * CSPRNG output, not a human-chosen secret, so an unsalted sha256 is the right
 * primitive and a slow KDF would only delay redemption.
 */
/**
 * How close together two identical submissions must be to count as one click
 * rather than two intents. Ten seconds: long enough to cover a double-click, a
 * refresh-during-submit, and a browser retry on a slow connection; far too
 * short to swallow a customer deliberately posting a similar request later.
 */
const DUPLICATE_SUBMIT_WINDOW_MS = 10_000;

const hashPasswordResetToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

// Administrator invitation and reset tokens. Same reasoning as the QA links
// above: 32 bytes of CSPRNG output is not a human-chosen secret, so sha256 with
// no salt is correct and scrypt would only slow down redemption. Only the hash
// is ever stored, so the database holds nothing redeemable.
const ADMIN_TOKEN_BYTES = 32;
const ADMIN_INVITE_TTL_HOURS = 48;
/** Longer than a customer's 8. One of these reaches the whole admin surface. */
// ADMIN_PASSWORD_MIN_LENGTH now lives in shared/adminRoles.ts - see there.
const hashAdminToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

/**
 * The `sessionsInvalidBefore` cutoff for an operation that KILLS sessions
 * without minting a replacement - deactivation, revocation, an admin-initiated
 * reset.
 *
 * One second in the future, deliberately. authenticateRequest compares whole
 * seconds with `issuedSecond < cutoffSecond`, and that strict `<` is correct
 * where it is: a password reset mints a new session in the very same second it
 * sets the cutoff, and `<=` would log out the person who just reset. But it
 * leaves a one-second window, and where nothing legitimate is being minted that
 * window is pure loss.
 *
 * Caught by driving it live: a sub-admin signed in and was deactivated inside
 * the same second, and their session kept working. Rounding the cutoff up
 * closes it without touching the reset path that needs the tolerance.
 */
const revocationCutoff = () => new Date(Date.now() + 1000);

export { hashPassword, verifyPassword, NO_SUCH_ACCOUNT_HASH } from './passwords';

// ── Auth Router ────────────────────────────────────────────────────────────
// SECURITY (Phase 4A.6.6): `users` also holds passwordHash, invitationToken, and
// other private/internal account fields. auth.me is called by every authenticated
// page load - it must never return the full row, only this explicit allowlist.
// This is a plain pick from the already-authenticated ctx.user (itself already
// fetched by sdk.authenticateRequest), not a second select().from(users) - so
// this costs no extra query and cannot be bypassed by forgetting a `where`.
function toPublicSessionUser(user: AuthenticatedUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    userRole: user.userRole,
    onboardingStatus: user.onboardingStatus,
  } as const;
}

/**
 * Bound the guess rate on the two unauthenticated endpoints that accept a secret.
 *
 * `identifier` is the username being attempted, or null where there is nothing
 * stable to key on (invitation completion, where varying the token IS the
 * attack). The check runs BEFORE any credential comparison, so a blocked
 * request never reaches the password/token verification at all.
 *
 * Deliberately does not distinguish "wrong password" from "no such user" in its
 * own behaviour - that distinction is already handled by the single shared
 * UNAUTHORIZED message below, and rate limiting must not reintroduce it as a
 * timing or status-code oracle.
 */
function enforceAuthRateLimit(req: TrpcContext['req'], identifier: string | null): void {
  const now = Date.now();
  const ip = getClientIp(req);
  const results = [
    ...(ip ? [authLimiters.ipBurst.check(ip, now), authLimiters.ipSustained.check(ip, now)] : []),
    ...(identifier ? [authLimiters.identifierSustained.check(identifier.toLowerCase(), now)] : []),
  ];
  const blocked = results.find(result => !result.allowed);
  if (blocked) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `Too many attempts. Try again in ${Math.ceil(blocked.retryAfterMs / 1000)}s.`,
    });
  }
}

/**
 * Bound what one AUTHENTICATED account can create, as opposed to how often it
 * can try to sign in.
 *
 * Keyed by user id alone. Every caller of this is behind protectedProcedure or
 * stricter, so the account is the subject that matters, and keying by IP as
 * well would throttle whole teams behind one carrier-grade NAT address without
 * bounding anything the account limit does not already bound.
 *
 * TOO_MANY_REQUESTS with the wait in seconds, matching the auth limiter, so the
 * client renders one message for both.
 */
function enforceContentRateLimit(
  userId: number,
  burst: { check: (key: string, now?: number) => { allowed: boolean; retryAfterMs: number } },
  sustained: { check: (key: string, now?: number) => { allowed: boolean; retryAfterMs: number } },
): void {
  const now = Date.now();
  const key = String(userId);
  const blocked = [burst.check(key, now), sustained.check(key, now)].find(result => !result.allowed);
  if (blocked) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `Too many requests. Try again in ${Math.ceil(blocked.retryAfterMs / 1000)}s.`,
    });
  }
}

const enforceRfqRateLimit = (userId: number) =>
  enforceContentRateLimit(userId, contentLimiters.rfqBurst, contentLimiters.rfqSustained);

const enforceUploadRateLimit = (userId: number) =>
  enforceContentRateLimit(userId, contentLimiters.uploadBurst, contentLimiters.uploadSustained);

/**
 * Refuse the QA-persona machinery wherever test login is switched off.
 *
 * The two SIGN-IN paths (auth.signInDummy, auth.redeemTestLoginLink) were
 * already gated, so a QA persona minted in production could never actually be
 * used. This closes the other end: production should not accumulate frozen
 * test accounts and inert sign-in links at all, and an administrator should be
 * told the machinery is off rather than handed an artefact that silently does
 * nothing.
 *
 * NOT_FOUND rather than FORBIDDEN, matching the sign-in paths: where the
 * capability is switched off the endpoint should look absent rather than
 * confirm there is a test-login mechanism to go hunting for.
 */
function assertTestLoginCapabilityEnabled(): void {
  if (!isTestLoginEnabled()) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });
  }
}

const authRouter = router({
  me: publicProcedure.query(opts => opts.ctx.user ? toPublicSessionUser(opts.ctx.user) : null),
  logout: publicProcedure.mutation(async ({ ctx }) => {
    // Server-side revocation (Phase 4A.6.6): without this, clearing the cookie only
    // logs this browser out - the same token, if copied elsewhere, kept working until
    // its natural (up to one-year) expiry. Only revoke when a jti is present (older
    // pre-this-change tokens have none and simply aren't revocable by this mechanism).
    if (ctx.user?.sessionJti) {
      await revokeSession(ctx.user.sessionJti, ctx.user.id, ctx.user.sessionExpiresAt ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
    }
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),
  signInDummy: publicProcedure.input(z.object({
    username: z.string().trim().min(3).max(100),
    password: z.string().min(8).max(128),
  })).mutation(async ({ ctx, input }) => {
    // ── The environment boundary ────────────────────────────────────────
    //
    // Before this check, signInDummy was a publicProcedure with NO environment
    // gate at all: it behaved identically in staging and in production. The
    // only thing standing in front of a production session was account state -
    // dummy accounts are created frozen and deactivated - so an admin who
    // unfroze one in production would have opened a password-only door with no
    // second factor and no environment restriction.
    //
    // This must be checked FIRST, before the rate limiter and before any
    // database read, so a disabled deployment does no work and reveals nothing
    // about which usernames exist.
    //
    // NOT_FOUND rather than FORBIDDEN, deliberately: where the capability is
    // switched off the endpoint should look like it does not exist, rather
    // than confirming there is a test-login mechanism to go hunting for.
    if (!isTestLoginEnabled()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });
    }
    enforceAuthRateLimit(ctx.req, input.username);
    const target = await getUserByUsername(input.username);
    if (!target?.isDummy || target.loginMethod !== 'dummy' || !(await verifyPassword(input.password, target.passwordHash))) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid dummy username or password' });
    }
    if (target.accountStatus !== 'active' || target.deactivatedAt) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This dummy account is not active' });
    }
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const sessionToken = await sdk.createSessionToken(target.openId, { name: target.name || target.username || 'Dummy user' });
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions });
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, target.id));
    await recordAccountEvent(db, { userId: target.id, actorId: target.id, action: 'dummy_user_signed_in', source: 'dummy', note: 'Dummy user signed in with a locally managed password' });
    return { success: true, userRole: target.userRole, onboardingStatus: target.onboardingStatus } as const;
  }),
  // ── First-party password authentication (Slice 3) ───────────────────────
  //
  // Before this, the only way a real (non-dummy) user could ever obtain a
  // session was `/api/oauth/callback`, which calls OAUTH_SERVER_URL - a
  // Manus-platform service. On any infrastructure BuildHub actually controls,
  // that host is not there, and nobody can sign in at all. `signInDummy`
  // refuses anything without `isDummy = true`, so it is not a substitute.
  //
  // This also closes a defect that existed independently of hosting: an
  // admin-created account could be invited, could set a password through
  // `admin.completeInvitation`, and then had NO endpoint that would accept that
  // password. `signIn` below accepts any non-dummy account holding a
  // passwordHash, so those accounts finally work.
  //
  // OAuth is untouched and keeps working wherever OAUTH_SERVER_URL resolves.
  // This is a second door, not a replacement.
  /**
   * Redeem an admin-issued QA sign-in link.
   *
   * Every guarantee the design promises is enforced HERE, because this is the
   * only place a token turns into a session. The checks are ordered so the
   * cheapest and most absolute come first.
   */
  redeemTestLoginLink: publicProcedure.input(z.object({
    token: z.string().min(16).max(256),
  })).mutation(async ({ ctx, input }) => {
    // 1. The environment boundary, before anything else. A production
    //    deployment must look like this endpoint does not exist.
    if (!isTestLoginEnabled()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' });
    }
    // 2. Rate limited on the token itself, so a leaked-but-expired link cannot
    //    be used to grind for a live one.
    enforceAuthRateLimit(ctx.req, 'test-login-link');

    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

    // 3. Look up by HASH. The raw token is never stored, so a database dump
    //    yields nothing redeemable.
    const [row] = await db.select().from(testLoginTokens)
      .where(eq(testLoginTokens.tokenHash, hashTestLoginToken(input.token)));

    // One message for every rejection below. A link that is unknown, expired,
    // spent or withdrawn must be indistinguishable: telling the holder WHICH
    // it was tells them whether they found a real token.
    const reject = () => new TRPCError({ code: 'UNAUTHORIZED', message: 'This sign-in link is not valid' });
    if (!row) throw reject();
    if (row.revokedAt) throw reject();
    if (row.usedAt) throw reject();
    if (row.expiresAt.getTime() <= Date.now()) throw reject();

    // 4. Re-check the account. It could have been frozen, deleted or promoted
    //    since the link was issued - issue-time validation is not enough.
    const [target] = await db.select().from(users).where(eq(users.id, row.userId));
    if (!target?.isDummy) throw reject();
    if (target.accountStatus !== 'active' || target.deactivatedAt) throw reject();

    // 5. Burn it BEFORE issuing the session, and only if it is still unused.
    //    The `isNull(usedAt)` predicate makes this the atomic step: two
    //    simultaneous redemptions of the same link race here, and MySQL lets
    //    exactly one of them match a row. Marking it used after issuing the
    //    session would leave a window where both requests get one.
    const burn = await db.update(testLoginTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(testLoginTokens.id, row.id), isNull(testLoginTokens.usedAt)));
    const affected = (burn as unknown as { rowsAffected?: number })?.rowsAffected
      ?? (Array.isArray(burn) ? (burn[0] as { affectedRows?: number })?.affectedRows : undefined);
    if (affected === 0) throw reject();

    const sessionToken = await sdk.createSessionToken(target.openId, { name: target.name || target.username || 'QA user' });
    ctx.res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(ctx.req) });
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, target.id));
    await recordAccountEvent(db, {
      userId: target.id, actorId: row.issuedBy, action: 'test_login_link_redeemed', source: 'admin',
      note: 'QA persona signed in through an admin-issued link',
    });
    return { success: true, userRole: target.userRole, onboardingStatus: target.onboardingStatus } as const;
  }),

  capabilities: publicProcedure.query(() => ({
    // Reported so the UI never renders a control the server will refuse, and
    // so the staging gate can assert this is OFF on a production-shaped
    // deployment. False everywhere unless TEST_LOGIN_ENABLED is exactly "true".
    testLogin: isTestLoginEnabled(),
    passwordSignIn: true,
    oauthSignIn: ENV.oAuthServerUrl.length > 0,
    // Both halves are required for a usable reset: something to send the mail,
    // and a trustworthy origin to put in the link. The UI hides the flow rather
    // than offering a button that can only fail.
    passwordReset: isMailerConfigured() && ENV.appBaseUrl.length > 0,
    // Same contract as passwordReset: the page asks before it offers. /ai used
    // to render its eight tools unconditionally, so on a deployment with no
    // provider credential every one of them returned the generic internal
    // error - the feature looked present and was not.
    aiAssistant: isAiConfigured(),
    // Whether the corpus has actually been embedded, so retrieval is ranking
    // semantically rather than falling back to keywords.
    //
    // Reported because it is otherwise UNOBSERVABLE from outside. The fallback
    // is deliberately silent - a degraded ranking still answers - which means a
    // deployment whose embeddings endpoint is rejecting every call looks
    // identical to a healthy one from the browser. Without this the staging
    // gate could only assert that answers arrive, and would have no way to tell
    // whether the architecture under test was the one actually running.
    //
    // Starts false and becomes true after the first retrieval on this process,
    // so the gate must ask a question before reading it.
    aiSemanticRetrieval: semanticRankingAvailable(),
  } as const)),

  signUp: publicProcedure.input(z.object({
    username: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, underscores, or hyphens only'),
    email: z.string().trim().email().max(320),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
    name: z.string().trim().min(1).max(255),
    phone: z.string().trim().max(32).optional(),
    referralCode: z.string().trim().min(4).max(32).optional(),
    // 'admin' is absent by construction. Role and privilege are separate here:
    // `role` is pinned to 'user' below regardless of what is sent.
    userRole: z.enum(['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager']),
  })).mutation(async ({ ctx, input }) => {
    enforceAuthRateLimit(ctx.req, normalizeEmail(input.email));
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

    const username = normalizeUsername(input.username)!;
    const email = normalizeEmail(input.email)!;
    if (await getUserByUsername(username)) throw new TRPCError({ code: 'CONFLICT', message: 'Username is already in use' });
    if (await getUserByEmail(email)) throw new TRPCError({ code: 'CONFLICT', message: 'Email is already in use' });

    const professional = isComplianceRole(input.userRole);
    const passwordHash = await hashPassword(input.password);
    const now = new Date();

    let userId: number;
    try {
      const result = await db.insert(users).values({
        // `local_` marks a credential BuildHub itself owns, distinct from the
        // `admin_`/`dummy_`/platform openIds. authenticateRequest resolves it
        // from the database like any other, so no other code path changes.
        openId: `local_${randomUUID()}`,
        username, name: input.name, email, phone: input.phone || null,
        loginMethod: 'password',
        role: 'user',
        userRole: input.userRole,
        accountSource: 'self_registered',
        isDummy: false,
        onboardingStatus: professional ? 'not_started' : 'approved',
        // Same rule auth.updateRole already applies to OAuth signups: a
        // professional is unverified until compliance approves them.
        verified: !professional,
        passwordHash,
        passwordSetAt: now,
        lastSignedIn: now,
      });
      userId = Number(result[0]?.insertId);
    } catch (error) {
      // Two simultaneous signups for the same username/email both pass the
      // checks above; the UNIQUE indexes settle it and the loser gets a plain
      // conflict rather than a 500.
      if (error instanceof Error && /duplicate|ER_DUP_ENTRY/i.test(error.message)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'That username or email was just taken. Please try another.' });
      }
      throw error;
    }

    const ownReferralCode = generateReferralCode();
    await db.update(users).set({ referralCode: ownReferralCode }).where(eq(users.id, userId));
    if (input.referralCode) {
      const [referrer] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, input.referralCode)).limit(1);
      if (referrer && referrer.id !== userId) {
        await db.insert(referrals).values({
          referrerId: referrer.id,
          referredId: userId,
          code: input.referralCode,
          status: 'registered',
        });
      }
    }

    const [created] = await db.select({ openId: users.openId }).from(users).where(eq(users.id, userId));
    const sessionToken = await sdk.createSessionToken(created.openId, { name: input.name });
    ctx.res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(ctx.req) });
    await recordAccountEvent(db, {
      userId, actorId: userId, action: 'password_account_created', source: 'self_registered',
      note: 'Account created with an email address and password',
    });
    // Top of the funnel. `role` is safe metadata; the email and password that
    // arrived with this request are not, and never reach the analytics stream.
    recordEventAsync({
      type: ANALYTICS_EVENTS.USER_REGISTERED,
      userId,
      metadata: { method: 'password', role: input.userRole },
    });
    return { success: true, userRole: input.userRole, onboardingStatus: professional ? 'not_started' : 'approved' } as const;
  }),

  signIn: publicProcedure.input(z.object({
    /** Username or email address. Which one is decided here, never by the client. */
    identifier: z.string().trim().min(3).max(320),
    password: z.string().min(1).max(128),
  })).mutation(async ({ ctx, input }) => {
    enforceAuthRateLimit(ctx.req, input.identifier.toLowerCase());
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

    const identifier = input.identifier.trim().toLowerCase();
    const target = identifier.includes('@')
      ? await getUserByEmail(identifier)
      : await getUserByUsername(identifier);

    // Dummy accounts are excluded on purpose: they have their own endpoint with
    // its own frozen-by-default policy, and letting them in here would route
    // around it.
    const candidate = target && !target.isDummy && target.passwordHash ? target : null;

    // Always run one verification, even with nothing to verify against, so the
    // response time does not distinguish "no such account" from "wrong
    // password". The single shared message below is worthless as an
    // anti-enumeration measure if the clock gives the answer away.
    const passwordMatches = await verifyPassword(input.password, candidate?.passwordHash ?? NO_SUCH_ACCOUNT_HASH);
    if (!candidate || !passwordMatches) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid username, email, or password' });
    }
    if (candidate.accountStatus !== 'active' || candidate.deactivatedAt) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This account is not active. Please contact support.' });
    }

    const sessionToken = await sdk.createSessionToken(candidate.openId, {
      name: candidate.name || candidate.username || 'BuildHub user',
    });
    ctx.res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(ctx.req) });
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, candidate.id));
    await recordAccountEvent(db, {
      userId: candidate.id, actorId: candidate.id, action: 'password_signed_in', source: 'password',
      note: identifier.includes('@') ? 'Signed in with email and password' : 'Signed in with username and password',
    });
    recordEventAsync({ type: ANALYTICS_EVENTS.USER_SIGNED_IN, userId: candidate.id, metadata: { method: 'password' } });
    return { success: true, userRole: candidate.userRole, onboardingStatus: candidate.onboardingStatus } as const;
  }),

  /**
   * Administrator sign-in, behind its own door at /admin/login.
   *
   * A SEPARATE ENDPOINT, not a flag on auth.signIn, for three reasons:
   *
   *   1. It refuses non-administrators outright. A customer who types their
   *      own credentials into the admin form gets no session at all, rather
   *      than a working customer session on a page that then hides itself.
   *   2. It gives administrator sign-in its own audit action, so
   *      `admin_signed_in` in the trail means what it says.
   *   3. The two doors can diverge later - stricter rate limits, a second
   *      factor - without touching the path every customer uses.
   *
   * What it deliberately does NOT do is re-implement credential checking. The
   * verification below is the same shape as auth.signIn on purpose: same rate
   * limiter, same single shared message, same constant-time decoy so a
   * nonexistent account costs what a real one does.
   *
   * Note the ORDER. Credentials are verified BEFORE the role is examined, and
   * failure produces one identical error either way. Checking "is this an
   * admin?" first would turn this endpoint into an oracle that reveals which
   * accounts are administrators to anyone who can type an email address.
   */
  adminSignIn: publicProcedure.input(z.object({
    identifier: z.string().trim().min(3).max(320),
    password: z.string().min(1).max(128),
  })).mutation(async ({ ctx, input }) => {
    enforceAuthRateLimit(ctx.req, input.identifier.toLowerCase());
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

    const identifier = input.identifier.trim().toLowerCase();
    const target = identifier.includes('@')
      ? await getUserByEmail(identifier)
      : await getUserByUsername(identifier);

    // QA personas can never hold administrator authority, by construction:
    // they are excluded here before anything else is considered.
    const candidate = target && !target.isDummy && target.passwordHash ? target : null;
    const passwordMatches = await verifyPassword(input.password, candidate?.passwordHash ?? NO_SUCH_ACCOUNT_HASH);

    // ONE message for every rejection below - wrong password, no such account,
    // not an administrator, no role assigned, deactivated. Anything more
    // specific tells an attacker which of those five they hit.
    const reject = () => new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid credentials, or this account is not an administrator.' });

    if (!candidate || !passwordMatches) throw reject();
    if (candidate.role !== 'admin' || !isAdminRole(candidate.adminRole)) throw reject();
    if (candidate.accountStatus !== 'active' || candidate.deactivatedAt) throw reject();

    const sessionToken = await sdk.createSessionToken(candidate.openId, {
      name: candidate.name || candidate.username || 'BuildHub administrator',
    });
    ctx.res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(ctx.req) });
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, candidate.id));
    await recordAccountEvent(db, {
      userId: candidate.id, actorId: candidate.id, action: 'admin_signed_in', source: 'admin_login',
      note: `Administrator sign-in as ${candidate.adminRole}`,
    });
    return {
      success: true,
      adminRole: candidate.adminRole as AdminRole,
      permissions: permissionsForAdminRole(candidate.adminRole),
    } as const;
  }),

  /**
   * Redeem an administrator invitation and set the first password.
   *
   * Public because the holder has no session yet - that is what they are
   * redeeming. It is not unguarded: the token is 32 CSPRNG bytes matched by
   * sha256, single-use, expiring, revocable, and the role granted comes from
   * the stored invitation row rather than from anything the caller sends.
   */
  completeAdminInvitation: publicProcedure.input(z.object({
    token: z.string().min(20).max(200),
    password: z.string().min(ADMIN_PASSWORD_MIN_LENGTH).max(128),
  })).mutation(async ({ ctx, input }) => {
    // Unauthenticated and it grants administrator authority, so the guess rate
    // has to be bounded. Keyed by IP only: the token is the thing being
    // guessed, so keying on it would bound nothing.
    enforceAuthRateLimit(ctx.req, null);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

    // One message for unknown, expired, spent and revoked alike.
    const reject = () => new TRPCError({ code: 'BAD_REQUEST', message: 'This invitation link is invalid, expired, or has already been used.' });

    const [row] = await db.select().from(adminInvitations)
      .where(eq(adminInvitations.tokenHash, hashAdminToken(input.token)));
    if (!row) throw reject();
    if (row.usedAt || row.revokedAt) throw reject();
    if (new Date(row.expiresAt).getTime() < Date.now()) throw reject();

    // Burn the invitation FIRST, conditionally on it still being unused, so two
    // simultaneous redemptions cannot both succeed. Same pattern as the QA
    // sign-in links: the database decides the winner, not application logic.
    const burn = await db.update(adminInvitations)
      .set({ usedAt: new Date() })
      .where(and(eq(adminInvitations.id, row.id), isNull(adminInvitations.usedAt)));
    const affected = (burn as unknown as { affectedRows?: number }[])[0]?.affectedRows
      ?? (burn as unknown as { affectedRows?: number }).affectedRows ?? 0;
    if (affected === 0) throw reject();

    const passwordHash = await hashPassword(input.password);
    await db.update(users).set({
      passwordHash,
      passwordSetAt: new Date(),
      // The authority comes from the invitation row, never from the request.
      role: 'admin',
      adminRole: row.adminRole,
      userRole: 'admin',
      accountStatus: 'active',
      verified: true,
      invitationStatus: 'password_set',
    }).where(eq(users.id, row.userId));

    await recordAccountEvent(db, {
      userId: row.userId, actorId: row.userId, action: 'admin_invitation_redeemed', source: 'admin_invite',
      note: `Administrator account activated as ${row.adminRole}`,
    });
    return { success: true } as const;
  }),

  requestPasswordReset: publicProcedure.input(z.object({
    email: z.string().trim().email().max(320),
  })).mutation(async ({ ctx, input }) => {
    enforceAuthRateLimit(ctx.req, normalizeEmail(input.email));
    // Refuses rather than returning a cheerful "check your inbox" that no
    // message will ever follow. `auth.capabilities` lets the UI avoid ever
    // reaching this state.
    if (!isMailerConfigured() || ENV.appBaseUrl.length === 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Password reset by email is not available on this deployment. Please contact support.',
      });
    }
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

    const email = normalizeEmail(input.email)!;
    const target = await getUserByEmail(email);
    const eligible = target && !target.isDummy && target.passwordHash
      && target.accountStatus === 'active' && !target.deactivatedAt;

    if (eligible) {
      // The raw token goes in the email and nowhere else; the column gets the
      // hash, so what is stored is not what is redeemable.
      const token = `${randomUUID()}-${randomUUID().slice(0, 8)}`;
      await db.update(users).set({
        passwordResetToken: hashPasswordResetToken(token),
        passwordResetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      }).where(eq(users.id, target.id));
      try {
        await getMailer().send({
          to: email,
          subject: 'Reset your BuildHub password',
          body: `Open this link to choose a new password:\n\n${ENV.appBaseUrl}/auth/reset-password?token=${token}\n\n`
            + `The link expires in ${Math.round(PASSWORD_RESET_TTL_MS / 60000)} minutes. `
            + `If you did not request this, you can ignore this message - your password has not changed.`,
        });
      } catch (error) {
        // Swallowed on purpose. A delivery failure that surfaced as a 500 here,
        // while an unknown address returned 200, would turn this endpoint into
        // an account-existence oracle.
        console.error('[auth] Password reset email failed to send', error);
      }
      await recordAccountEvent(db, {
        userId: target.id, actorId: target.id, action: 'password_reset_requested', source: 'password',
        note: 'A password reset link was issued',
      });
    }

    // Identical for a known and an unknown address.
    return { requested: true } as const;
  }),

  resetPassword: publicProcedure.input(z.object({
    token: z.string().trim().min(10).max(128),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
  })).mutation(async ({ ctx, input }) => {
    // Keyed by IP only: the token is the secret being guessed, so keying the
    // limiter on it would bound nothing.
    enforceAuthRateLimit(ctx.req, null);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

    // Looked up by HASH. The raw token never has to exist server-side beyond
    // this comparison, and an attacker holding the column value holds nothing.
    const [target] = await db.select().from(users).where(eq(users.passwordResetToken, hashPasswordResetToken(input.token)));
    if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'This reset link is invalid or has already been used' });
    if (!target.passwordResetExpiresAt || new Date(target.passwordResetExpiresAt).getTime() < Date.now()) {
      await db.update(users).set({ passwordResetToken: null, passwordResetExpiresAt: null }).where(eq(users.id, target.id));
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This reset link has expired. Please request a new one.' });
    }

    const now = new Date();
    await db.update(users).set({
      passwordHash: await hashPassword(input.password),
      passwordSetAt: now,
      // Single-use.
      passwordResetToken: null,
      passwordResetExpiresAt: null,
      // Completing the flow proves control of the mailbox the link was sent to.
      emailVerifiedAt: target.emailVerifiedAt ?? now,
      // The whole point of a reset is that someone else may hold a live session.
      // Retire every one of them, including any this account currently has.
      sessionsInvalidBefore: now,
    }).where(eq(users.id, target.id));

    await recordAccountEvent(db, {
      userId: target.id, actorId: target.id, action: 'password_reset_completed', source: 'password',
      note: 'Password changed via reset link; all existing sessions invalidated',
    });

    // Deliberately does not sign the user in. They re-authenticate with the new
    // password, which proves the reset worked and keeps this endpoint from
    // being a way to obtain a session.
    return { success: true } as const;
  }),

  checkSignupAvailability: publicProcedure.input(z.object({
    username: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, underscores, or hyphens only'),
    email: z.string().email().optional(),
  })).mutation(async ({ input }) => {
    const username = normalizeUsername(input.username);
    const email = normalizeEmail(input.email);
    const [usernameUser, emailUser] = await Promise.all([
      username ? getUserByUsername(username) : undefined,
      email ? getUserByEmail(email) : undefined,
    ]);
    return { usernameAvailable: !usernameUser, emailAvailable: !emailUser, hasExistingAccount: Boolean(usernameUser || emailUser) };
  }),
  updateRole: protectedProcedure
    .input(z.object({
      // 'admin' is NOT self-selectable, matching signUp - which already
      // excluded it and which this path had drifted away from.
      //
      // Choosing it never granted server-side privilege: adminProcedure checks
      // the separate `role` column, which this mutation does not touch. What it
      // DID do was write userRole='admin', which the dashboard reads to pick the
      // admin menu, and set verified=true / onboardingStatus=approved because
      // 'admin' is not a compliance role. So a normal account could show itself
      // admin navigation and a verified badge by naming a role that is not a
      // marketplace role at all.
      userRole: z.enum(['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager']),
      name: z.string().optional(),
      phone: z.string().optional(),
      location: z.string().optional(),
      username: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await db.update(users).set({ username: input.username ? normalizeUsername(input.username) : undefined, userRole: input.userRole, name: input.name, phone: input.phone, location: input.location, onboardingStatus: isComplianceRole(input.userRole) ? 'not_started' : 'approved', verified: isComplianceRole(input.userRole) ? false : true }).where(eq(users.id, ctx.user.id));
      await recordAccountEvent(db, { userId: ctx.user.id, actorId: ctx.user.id, action: 'profile_role_completed', source: 'self_registered', note: `Role selected: ${input.userRole}` });
      recordEventAsync({
        type: ANALYTICS_EVENTS.VENDOR_PROFILE_COMPLETED,
        userId: ctx.user.id,
        metadata: { role: input.userRole, professional: isComplianceRole(input.userRole) },
      });
      // PROFILE_COMPLETED, at the moment the product ALREADY treats a profile
      // as complete - the same line that emits the analytics event and writes
      // `profile_role_completed`. Inventing a separate definition of "complete"
      // for the referral engine would make the reward fire at a moment nothing
      // else on the platform recognises.
      await qualifyReferralEvent(db, ctx.user.id, 'PROFILE_COMPLETED', `profile:${ctx.user.id}`, new Date());
      return { success: true };
    }),
});

// ── Registration Compliance Router ─────────────────────────────────────────
const complianceProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isComplianceRole(ctx.user.userRole)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Professional onboarding is required for this role' });
  return next({ ctx });
});

/**
 * STORING A FILE, WITH THE ONE FAILURE A DEPLOYMENT ACTUALLY CAUSES.
 *
 * If no object storage backend is configured, `storagePut` throws
 * `ObjectStorageNotConfiguredError` - a deliberate, loud refusal. Exactly one
 * of the seven upload sites caught it and turned it into something a user
 * could read. The other six let it become a generic 500: the customer was told
 * "Something went wrong. Please try again." for a condition that retrying can
 * never fix, and the operator got a log line reading "unclassified - inspect
 * the deployment logs", which WAS the deployment log.
 *
 * Found by running the product against a real database with no storage
 * configured - which is precisely the state a deployment is in when an S3
 * environment variable is missing on launch day.
 *
 * SERVICE_UNAVAILABLE rather than INTERNAL_SERVER_ERROR, because that is what
 * it is: the feature is off on this deployment, the request was fine, and
 * saying so stops a user retrying into the same wall.
 */
async function storagePutOrUnavailable(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType: string,
): Promise<{ key: string; url: string }> {
  try {
    return await storagePut(relKey, data, contentType);
  } catch (error) {
    if (error instanceof ObjectStorageNotConfiguredError) {
      // LOGGED HERE, DELIBERATELY, and not left to the tRPC error classifier.
      //
      // That classifier only reports INTERNAL_SERVER_ERROR, on the sound
      // reasoning that a server-authored refusal already says what it means to
      // the caller. It does - to the CALLER. Turning this into a 503 therefore
      // fixed the customer's half and silently removed the operator's: the
      // access log would show 503s on every upload and never say why.
      //
      // So the diagnosis is emitted where it is known. It names the variables
      // to set, because this line goes to a deployment log, not to a customer.
      console.error(JSON.stringify({
        level: 'error',
        event: 'upload_rejected_storage_unconfigured',
        remedy: 'set S3_BUCKET, S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY '
          + '(or BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY) on this deployment',
      }));
      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'File uploads are not available on this deployment.',
      });
    }
    throw error;
  }
}

const MAX_REGISTRATION_DOCUMENT_SIZE = 10 * 1024 * 1024;

/**
 * Slice 9 (audit item A10). Every upload endpoint below validated only the
 * content type the CLIENT declared, then stored the bytes under that label
 * without ever looking at them - a check the caller controls both sides of.
 *
 * This turns the byte-level verification in server/_core/fileType.ts into the
 * BAD_REQUEST the client already knows how to display. It is applied at all
 * five upload endpoints rather than the one that looked riskiest, because the
 * gap was identical in each.
 */
function assertUploadedFileMatches(
  declaredContentType: string,
  buffer: Buffer,
  allowed: readonly string[],
): void {
  const problem = checkUploadedFile(declaredContentType, buffer, allowed);
  if (problem) throw new TRPCError({ code: 'BAD_REQUEST', message: problem.message });
}

const isAllowedRegistrationDocumentType = (contentType: string) => contentType === 'application/pdf' || contentType.startsWith('image/');

function getOverallComplianceStatus(role: string | null | undefined, docs: Array<{ documentType: string; status: string }>, requestedStatus?: string): ComplianceStatus {
  if (requestedStatus === 'rejected') return 'rejected';
  if (requestedStatus === 'update_required') return 'update_required';
  const required = getComplianceRequirements(role).filter(requirement => requirement.required);
  const allApproved = required.length > 0 && required.every(requirement => docs.some(doc => doc.documentType === requirement.type && doc.status === 'approved'));
  return allApproved ? 'approved' : 'under_review';
}

const registrationRouter = router({
  requirements: complianceProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [applicant] = await db.select({ userRole: users.userRole, onboardingStatus: users.onboardingStatus, onboardingReviewNotes: users.onboardingReviewNotes, onboardingReviewedAt: users.onboardingReviewedAt }).from(users).where(eq(users.id, ctx.user.id));
    const docs = await db.select().from(registrationDocuments).where(eq(registrationDocuments.userId, ctx.user.id)).orderBy(desc(registrationDocuments.createdAt));
    const history = await db.select().from(registrationDocumentSubmissions).where(eq(registrationDocumentSubmissions.userId, ctx.user.id)).orderBy(desc(registrationDocumentSubmissions.createdAt)).limit(100);
    const events = await db.select().from(registrationReviewEvents).where(eq(registrationReviewEvents.userId, ctx.user.id)).orderBy(desc(registrationReviewEvents.createdAt)).limit(50);
    return { role: applicant?.userRole ?? ctx.user.userRole, status: applicant?.onboardingStatus ?? 'not_started', reviewNotes: applicant?.onboardingReviewNotes ?? null, reviewedAt: applicant?.onboardingReviewedAt ?? null, requirements: getComplianceRequirements(applicant?.userRole ?? ctx.user.userRole), documents: docs, history, events };
  }),
  uploadDocument: complianceProcedure.input(z.object({
    documentType: z.string().min(1).max(100),
    fileName: z.string().min(1).max(255),
    contentType: z.string().refine(isAllowedRegistrationDocumentType, 'Only PDF and image files are supported'),
    base64: z.string().min(1),
    applicantNote: z.string().max(1000).optional(),
  })).mutation(async ({ ctx, input }) => {
    enforceUploadRateLimit(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const requirements = getComplianceRequirements(ctx.user.userRole);
    const requirement = requirements.find(item => item.type === input.documentType);
    if (!requirement) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This document is not required for the selected role' });
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_REGISTRATION_DOCUMENT_SIZE) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Registration documents must be between 1 byte and 10MB' });
    assertUploadedFileMatches(input.contentType, bytes, DOCUMENT_TYPES);
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const { key, url } = await storagePutOrUnavailable(`registration/${ctx.user.id}/${Date.now()}-${safeName}`, bytes, input.contentType);
    const result = await db.insert(registrationDocuments).values({ userId: ctx.user.id, documentType: input.documentType, displayName: requirement.name, fileName: input.fileName, url, fileKey: key, mimeType: input.contentType, size: bytes.length, status: 'submitted', applicantNote: input.applicantNote });
    const documentId = Number(result[0].insertId);
    await db.insert(registrationDocumentSubmissions).values({ documentId, userId: ctx.user.id, documentType: input.documentType, fileName: input.fileName, url, fileKey: key, mimeType: input.contentType, size: bytes.length, status: 'submitted', applicantNote: input.applicantNote });
    await db.update(users).set({ onboardingStatus: 'under_review', onboardingReviewNotes: null }).where(eq(users.id, ctx.user.id));
    await db.insert(registrationReviewEvents).values({ userId: ctx.user.id, documentId, actorId: ctx.user.id, action: 'document_submitted', status: 'submitted', note: input.applicantNote });
    // The document itself, its filename and the applicant's note stay out of
    // the analytics stream; only the fact that a submission happened, and its
    // type, are recorded.
    recordEventAsync({
      type: ANALYTICS_EVENTS.VENDOR_SUBMITTED_FOR_REVIEW,
      userId: ctx.user.id,
      subjectType: 'registrationDocument',
      subjectId: documentId,
      metadata: { documentType: input.documentType },
    });
    return { id: documentId, key, url, status: 'submitted' as const };
  }),
});

// ── Projects Router ────────────────────────────────────────────────────────
const providerRoles = ['contractor', 'engineer', 'architect', 'supplier', 'project_manager'] as const;
const approvedProviderProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!providerRoles.includes(ctx.user.userRole as typeof providerRoles[number])) throw new TRPCError({ code: 'FORBIDDEN', message: 'Provider access required' });
  if ((ctx.user as any).onboardingStatus !== 'approved') throw new TRPCError({ code: 'FORBIDDEN', message: 'Professional registration approval is required. Visit /compliance.' });
  return next({ ctx });
});

const projectsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    // Owned OR joined. Before the project team model this was ownership alone,
    // which is why a contractor put on a job could not see it: there was no
    // membership to see it through.
    const ids = await readableProjectIds(db, ctx.user.id);
    if (ids.length === 0) return [];
    return db.select().from(projects).where(inArray(projects.id, ids)).orderBy(desc(projects.createdAt));
  }),
  directory: approvedProviderProcedure.query(async ({ ctx }) => {
    if (!providerRoles.includes(ctx.user.userRole as typeof providerRoles[number])) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Provider access required' });
    }
    const db = await requireDb();
    // Lead-directory listing only - never select budget/spent (or other owner-private
    // columns) here. Confirmed against every consumer of this query (RolePlatform.tsx's
    // provider/supplier/PM workspaces) that only id/title/type/status/location/progress
    // are ever rendered from directory results.
    return db.select({
      id: projects.id,
      title: projects.title,
      type: projects.type,
      status: projects.status,
      location: projects.location,
      progress: projects.progress,
      updatedAt: projects.updatedAt,
    }).from(projects).orderBy(desc(projects.updatedAt)).limit(50);
  }),
  get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    // Throws NOT_FOUND for a project that does not exist AND for one the
    // caller is not on, so guessing ids reveals nothing.
    const access = await requireProjectAccess(db, input.id, ctx.user.id, 'read');
    const [project] = await db.select().from(projects).where(eq(projects.id, input.id));
    if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
    // The caller's own capacity travels with the record so the UI can render
    // the right controls - it is a convenience, never the enforcement.
    return { ...project, myProjectRole: access.projectRole };
  }),
  /**
   * WHO MAY START A PROJECT - the owner's decision, enforced HERE.
   *
   * This was `protectedProcedure` with no role check at all. Only the homeowner
   * dashboard offered a "Create Project" button, so it LOOKED restricted, and
   * that appearance was the whole of the restriction: any authenticated account
   * - a supplier, a contractor, anyone - could POST to this procedure directly
   * and own a project. Hiding a control is not a permission, and a reviewer
   * reading the UI would have had no way to notice.
   *
   * A project is the customer's record of work they are commissioning. Every
   * downstream rule assumes that: `list` and `get` scope by ownerId, rfq.create
   * refuses a projectId the caller does not own, and the provider-facing view is
   * `directory`, a lead list, not ownership. A provider-owned project has no
   * meaning in any of those paths.
   *
   * VERIFIED BEFORE RESTRICTING, not assumed: every project in the database was
   * owned by a homeowner (32 of 32 at the time of the change; group by userRole
   * returned that single row).
   *
   * THAT OBSERVATION WAS THEN USED AS A RULE, AND IT SHOULD NOT HAVE BEEN. The
   * restriction was drawn at `homeowner` because homeowners were the only
   * accounts that had ever created a project - but the only reason no
   * contractor had created one is that the UI never offered it. A restriction
   * cannot be evidence for itself.
   *
   * The rule the code enforces now is the one the business actually has, and it
   * lives in `PROJECT_CREATOR_ROLES`: every professional role that participates
   * in delivering a job may commission one, because a main contractor
   * subcontracting a package and a project manager commissioning on a client's
   * behalf are ordinary construction practice. SUPPLIER STAYS EXCLUDED, and
   * that exclusion is the whole security content of this guard - a supplier
   * answers a request for work rather than commissioning one.
   */
  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      type: z.enum(['residential', 'commercial', 'renovation', 'finishing', 'maintenance', 'other']).optional(),
      budget: z.number().optional(),
      location: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // The message names the rule rather than saying "forbidden": a supplier
      // who tries this is not attacking anything, they are looking for the
      // feature, and being told where they actually stand is more use than a
      // bare refusal.
      if (!canCreateProject(ctx.user.userRole)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Suppliers sell into projects rather than commissioning them. Ask the customer or project manager to add you to the project, or respond to one of their requests.',
        });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      /**
       * CREATOR AND OWNER ARE RECORDED SEPARATELY.
       *
       * `ownerId` defaults to the creator because most projects are made by
       * the customer themselves, and a professional creating one on a client's
       * behalf has no way to name that client until the client is on BuildHub.
       * `createdBy` always records who actually typed it in, so the two can
       * diverge the moment the product supports naming a customer - and the
       * audit trail already answers "who made this" today.
       */
      const projectRole = creatorProjectRole(ctx.user.userRole);
      const result = await db.insert(projects).values({
        ...input,
        ownerId: ctx.user.id,
        createdBy: ctx.user.id,
        budget: input.budget != null ? String(input.budget) : undefined,
      });
      const id = Number(result[0].insertId);

      /**
       * THE CREATOR'S MEMBERSHIP IS PART OF CREATING THE PROJECT.
       *
       * Without this row a project would exist with nobody on it. Ownership is
       * still read directly from `projects.ownerId`, so the project is not
       * orphaned if this insert fails - but every team-facing surface reads
       * memberships, and a project whose own creator is not on its team would
       * render as having no members at all.
       */
      await db.insert(projectMembers).values({
        projectId: id,
        userId: ctx.user.id,
        projectRole,
        assignedBy: ctx.user.id,
      });
      return { id, projectRole };
    }),

  /**
   * ── THE PROJECT TEAM ────────────────────────────────────────────────────
   *
   * Everything below is new capability, not a repaired one. Before this,
   * nothing in BuildHub could put a second person on a project.
   */

  /** Who is on this project. Any member may see the team they are part of. */
  members: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const access = await requireProjectAccess(db, input.projectId, ctx.user.id, 'read');

      // An explicit column allowlist over the joined user. A team list needs a
      // name and a way to recognise someone; it does not need their email,
      // their phone or anything else on the users row.
      const rows = await db.select({
        id: projectMembers.id,
        userId: projectMembers.userId,
        projectRole: projectMembers.projectRole,
        assignedAt: projectMembers.assignedAt,
        removedAt: projectMembers.removedAt,
        name: users.name,
        userRole: users.userRole,
        avatar: users.avatar,
        verified: users.verified,
      }).from(projectMembers)
        .innerJoin(users, eq(users.id, projectMembers.userId))
        .where(eq(projectMembers.projectId, input.projectId))
        .orderBy(projectMembers.assignedAt);

      return {
        // Live members first; removed ones are returned too because "who WAS
        // on this job" is a question a dispute has to answer, and the client
        // distinguishes them by removedAt rather than by their absence.
        members: rows,
        myProjectRole: access.projectRole,
        myCapabilities: capabilitiesFor(access.projectRole),
      };
    }),

  /**
   * Put someone on a project.
   *
   * REACTIVATION RATHER THAN A SECOND ROW. The unique index is on
   * (projectId, userId) with no removedAt in it, so re-adding somebody who was
   * removed updates the existing row. Without this the insert would simply
   * fail with a duplicate-key error and the operator would be told nothing
   * useful about why.
   */
  addMember: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      userId: z.number().int().positive(),
      projectRole: z.enum(PROJECT_ROLES),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await requireProjectAccess(db, input.projectId, ctx.user.id, 'manage');

      // OWNERSHIP IS NOT GRANTABLE. `owner` is derived from projects.ownerId,
      // and handing it out here would create a project with two owners, one of
      // whom the ownership column does not know about.
      if (input.projectRole === 'owner') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Ownership belongs to the customer the project is for and cannot be assigned. Use "manager" for someone who runs the project.',
        });
      }

      const [target] = await db.select({ id: users.id, name: users.name, accountStatus: users.accountStatus })
        .from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such user' });
      if (target.accountStatus && target.accountStatus !== 'active') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That account is not active.' });
      }

      const [existing] = await db.select({ id: projectMembers.id, removedAt: projectMembers.removedAt })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, input.userId)))
        .limit(1);

      if (existing) {
        if (!existing.removedAt) {
          throw new TRPCError({ code: 'CONFLICT', message: 'That person is already on this project.' });
        }
        await db.update(projectMembers).set({
          projectRole: input.projectRole,
          assignedBy: ctx.user.id,
          assignedAt: new Date(),
          removedAt: null,
          removedBy: null,
        }).where(eq(projectMembers.id, existing.id));
      } else {
        await db.insert(projectMembers).values({
          projectId: input.projectId,
          userId: input.userId,
          projectRole: input.projectRole,
          assignedBy: ctx.user.id,
        });
      }

      const [project] = await db.select({ title: projects.title })
        .from(projects).where(eq(projects.id, input.projectId)).limit(1);
      await notifyUser(db, {
        userId: input.userId,
        title: 'You were added to a project',
        body: `${project?.title ?? 'A project'} - your role: ${input.projectRole}`,
        type: 'info',
        // A deep link to the project itself. The recipient is now a member, so
        // this link resolves for them; before the membership it would not have.
        link: `/projects/${input.projectId}`,
        messageKey: 'notif.project.member.added',
        messageParams: { title: project?.title ?? '', role: input.projectRole },
      });

      return { success: true, projectRole: input.projectRole };
    }),

  /** Take someone off a project. A soft end - the history keeps them. */
  removeMember: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      userId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const access = await requireProjectAccess(db, input.projectId, ctx.user.id, 'manage');

      // THE OWNER CANNOT BE REMOVED FROM THEIR OWN PROJECT. Without this a
      // project manager could remove the customer from the job the customer
      // is paying for.
      if (input.userId === access.ownerId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The project owner cannot be removed from their own project.',
        });
      }

      const result = await db.update(projectMembers).set({
        removedAt: new Date(),
        removedBy: ctx.user.id,
      }).where(and(
        eq(projectMembers.projectId, input.projectId),
        eq(projectMembers.userId, input.userId),
        isNull(projectMembers.removedAt),
      ));

      // Reported honestly: removing somebody who is not on the project is not
      // an error, but it is also not a removal, and saying "success" either
      // way would make the two indistinguishable.
      const affected = Number((result as { rowsAffected?: number })?.rowsAffected ?? 0);
      return { success: true, removed: affected > 0 };
    }),
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).optional(),
      progress: z.number().min(0).max(100).optional(),
      budget: z.number().optional(),
      spent: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const { id, budget, spent, ...rest } = input;
      // AUTHORIZE FIRST, and throw. The predicate used to be the only guard:
      // `where(id = ? AND ownerId = ?)` simply matched no rows for anyone else
      // and the procedure still returned `{ success: true }` - reporting a
      // write that never happened. A caller cannot tell a refusal from a
      // no-op, and neither could a test.
      await requireProjectAccess(db, id, ctx.user.id, 'manage');
      await db.update(projects).set({
        ...rest,
        budget: budget != null ? String(budget) : undefined,
        spent: spent != null ? String(spent) : undefined,
      }).where(eq(projects.id, id));
      return { success: true };
    }),
  milestones: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    await requireProjectAccess(db, input.projectId, ctx.user.id, 'read');
    return db.select().from(milestones).where(eq(milestones.projectId, input.projectId)).orderBy(milestones.dueDate);
  }),
  addMilestone: protectedProcedure
    .input(z.object({ projectId: z.number(), title: z.string(), dueDate: z.date().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await requireProjectAccess(db, input.projectId, ctx.user.id, 'manage');
      await db.insert(milestones).values(input);
      return { success: true };
    }),
  tasks: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    await requireProjectAccess(db, input.projectId, ctx.user.id, 'read');
    return db.select().from(tasks).where(eq(tasks.projectId, input.projectId)).orderBy(desc(tasks.createdAt));
  }),
  addTask: protectedProcedure
    .input(z.object({ projectId: z.number(), title: z.string(), description: z.string().optional(), priority: z.enum(['low', 'medium', 'high']).optional(), dueDate: z.date().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await requireProjectAccess(db, input.projectId, ctx.user.id, 'manage');
      await db.insert(tasks).values(input);
      return { success: true };
    }),
  updateTask: protectedProcedure
    .input(z.object({ id: z.number(), status: z.enum(['todo', 'in_progress', 'done']).optional(), title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const { id, ...data } = input;
      // Tasks don't carry the owner directly - join through their project so a
      // not-found task and a task on someone else's project fail identically.
      const [row] = await db.select({ ownerId: projects.ownerId })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(eq(tasks.id, id));
      if (!row || row.ownerId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
      await db.update(tasks).set(data).where(eq(tasks.id, id));
      return { success: true };
    }),
  expenses: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    await requireProjectAccess(db, input.projectId, ctx.user.id, 'finance');
    return db.select().from(expenses).where(eq(expenses.projectId, input.projectId)).orderBy(desc(expenses.date));
  }),
  addExpense: protectedProcedure
    .input(z.object({ projectId: z.number(), category: z.string().optional(), description: z.string().optional(), amount: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await requireProjectAccess(db, input.projectId, ctx.user.id, 'finance');
      await db.insert(expenses).values({ ...input, amount: String(input.amount) });
      return { success: true };
    }),
  dailyLogs: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    await requireProjectAccess(db, input.projectId, ctx.user.id, 'read');
    return db.select().from(dailyLogs).where(eq(dailyLogs.projectId, input.projectId)).orderBy(desc(dailyLogs.date));
  }),
  addDailyLog: protectedProcedure
    .input(z.object({ projectId: z.number(), description: z.string(), weather: z.string().optional(), workers: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await requireProjectAccess(db, input.projectId, ctx.user.id, 'report');
      await db.insert(dailyLogs).values({ ...input, authorId: ctx.user.id });
      return { success: true };
    }),
  documents: protectedProcedure.input(z.object({ projectId: z.number(), type: z.enum(['drawing', 'boq', 'photo', 'contract', 'invoice', 'other']).optional() })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    await requireProjectAccess(db, input.projectId, ctx.user.id, 'read');
    const filters = input.type ? and(eq(documents.projectId, input.projectId), eq(documents.type, input.type)) : eq(documents.projectId, input.projectId);
    return db.select().from(documents).where(filters).orderBy(desc(documents.createdAt));
  }),
  uploadDocument: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      name: z.string().min(1).max(255),
      type: z.enum(['drawing', 'boq', 'photo', 'contract', 'invoice', 'other']),
      contentType: z.string().refine(isAllowedProjectDocumentType, { message: 'Unsupported project document type' }),
      base64: z.string().max(11_000_000, 'File too large (max ~8MB)'),
    }))
    .mutation(async ({ ctx, input }) => {
      enforceUploadRateLimit(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await requireProjectAccess(db, input.projectId, ctx.user.id, 'report');
      const buffer = Buffer.from(input.base64, 'base64');
      if (buffer.length > 8 * 1024 * 1024) throw new TRPCError({ code: 'BAD_REQUEST', message: 'File too large (max 8MB)' });
      assertUploadedFileMatches(input.contentType, buffer, DOCUMENT_TYPES);
      const safeName = input.name.replace(/[^\w.-]+/g, '_');
      const { key, url } = await storagePutOrUnavailable(`project-documents/user-${ctx.user.id}/project-${input.projectId}/${safeName}`, buffer, input.contentType);
      const result = await db.insert(documents).values({ projectId: input.projectId, uploaderId: ctx.user.id, name: input.name, type: input.type, url, fileKey: key, size: buffer.length });
      // The bytes are stored and the row is written by this point. Throwing here
      // because a driver returned an unexpected shape would show the user a
      // failure for an upload that succeeded, and they would try again.
      return { id: Number(result?.[0]?.insertId ?? 0), key, url, name: input.name, type: input.type, size: buffer.length };
    }),
  progressReports: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    await requireProjectAccess(db, input.projectId, ctx.user.id, 'read');
    return db.select().from(progressReports).where(eq(progressReports.projectId, input.projectId)).orderBy(desc(progressReports.createdAt));
  }),
  addProgressReport: protectedProcedure.input(z.object({ projectId: z.number(), title: z.string().min(1), summary: z.string().min(1), progress: z.number().int().min(0).max(100) })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    await requireProjectAccess(db, input.projectId, ctx.user.id, 'report');
    const progress = clampProjectProgress(input.progress);
    await db.insert(progressReports).values({ ...input, progress, authorId: ctx.user.id });
    await db.update(projects).set({ progress }).where(eq(projects.id, input.projectId));
    return { success: true };
  }),
});

// ── Marketplace Router ─────────────────────────────────────────────────────
const marketplaceRouter = router({
  // ── Real vendor directory (Phase 4B.3) ──────────────────────────────────
  // Replaces the static mock list that previously backed /marketplace/vendors.
  // Explicit column allowlist, organic ordering only - a paid plan is never
  // read here and never affects position.
  vendors: publicProcedure
    .input(z.object({
      category: z.string().max(MAX_SEARCH_LENGTH).optional(),
      location: z.string().max(MAX_SEARCH_LENGTH).optional(),
      search: z.string().max(MAX_SEARCH_LENGTH).optional(),
      limit: z.number().int().positive().max(100).optional(),
    }).optional())
    .query(async ({ input }) => {
      const organic = await listDirectoryVendors(input ?? {});
      const db = await getDb();
      // No database means no organic rows either, so there is nothing to
      // re-rank. Routed through applyBoost with an empty candidate list rather
      // than returned early, so this path has the SAME response type as the
      // boosted one - a union here would make every caller handle a row shape
      // that depends on whether a query happened to find anything.
      if (!db || organic.length === 0) return applyBoost(organic, []);
      // Boost RE-RANKS the directory; it never adds a provider to it. A
      // Contractor-boosted provider cannot surface inside a Designer-filtered
      // search, because the organic query did not return them there.
      const candidates = await boostCandidates({ db, entityType: 'PROVIDER', category: input?.category });
      return applyBoost(organic, candidates);
    }),
  vendorCategories: publicProcedure.query(async () => listDirectoryCategories()),

  /**
   * THE SPONSORED STRIP for one service category.
   *
   * Public, like the directory it sits above. Returns both routes to a
   * sponsored slot - an administrator's grant and a Premium entitlement -
   * labelled by `sponsorshipSource` so the screen can be honest about which,
   * and so nothing has to be fabricated when neither exists: a category with
   * no sponsors returns an empty list and the strip does not render.
   */
  sponsoredVendors: publicProcedure
    .input(z.object({
      category: z.string().max(MAX_SEARCH_LENGTH).optional(),
      location: z.string().max(MAX_SEARCH_LENGTH).optional(),
    }).optional())
    .query(async ({ input }) => listSponsoredVendors(input ?? {})),

  /**
   * The counts on the landing and sign-up pages, from the database.
   *
   * They used to be four hardcoded strings. `satisfaction` is null until a
   * review exists, and the pages render nothing in that case - see
   * server/platformStats.ts for why that is the rule rather than a fallback
   * number.
   */
  platformStats: publicProcedure.query(async () => {
    // No database is not an excuse to invent figures - and ZEROES ARE A
    // FIGURE. "0 registered users" on the public homepage is a claim about
    // BuildHub, made confidently, and false. It fails instead.
    const db = await requireDb();
    return getPlatformStats(db);
  }),

  // Featured placement (Slice 8). A SEPARATE endpoint from `vendors` above, on
  // purpose: the organic list and the sponsored strip are two different things
  // and merging them into one response is how a client ends up rendering a paid
  // slot as an organic result. `sponsored: true` on every row makes the
  // labelling obligation impossible to overlook on the client side.
  featuredVendors: publicProcedure
    .input(z.object({
      category: z.string().max(MAX_SEARCH_LENGTH).optional(),
      location: z.string().max(MAX_SEARCH_LENGTH).optional(),
    }).optional())
    .query(async ({ input }) => {
      const vendors = await listFeaturedVendors(input ?? {});
      return {
        vendors: vendors.map(vendor => ({ ...vendor, sponsored: true as const })),
        slots: FEATURED_PLACEMENT_SLOTS,
      };
    }),
  /**
   * EDITORIAL FEATURED PROVIDERS. A separate endpoint from `featuredVendors`
   * (the Premium entitlement rotation) and `sponsoredVendors` (paid placement):
   * this is the admin-curated selection, and it must not be confused with
   * either. Each row carries its `featuredCategory` so a directory can render
   * Featured Designers, Featured Finishing and the rest from one source.
   */
  featuredProviders: publicProcedure
    .input(z.object({ category: z.string().max(MAX_SEARCH_LENGTH).optional() }).optional())
    .query(async ({ input }) => listFeaturedProviders(input ?? {})),

  /**
   * ── MASTER DISCOVERY: the single exclusive slot ─────────────────────────
   *
   * One provider, or none. The scope is the `category`; omitted means the
   * platform-wide GLOBAL scope, which is what provider discovery shows before
   * a visitor has chosen a type.
   *
   * Public for the same reason the directory is, and exposing strictly less:
   * the same card the organic list already shows, plus a label saying whether
   * the placement was paid for. No period, no granter, no reason, no price -
   * the commercial record stays behind marketplace.manage.
   *
   * Returns null when nothing is booked or nothing booked is still eligible.
   * The caller renders nothing in that case; there is no placeholder
   * advertiser to fall back to and inventing one would be fabricating a
   * business relationship.
   */
  masterProvider: publicProcedure
    .input(z.object({ category: z.string().max(MAX_SEARCH_LENGTH).optional() }).optional())
    .query(async ({ input }) => masterProvider(input?.category)),

  /** The Master product slot. Same contract, same honesty about emptiness. */
  masterProduct: publicProcedure
    .input(z.object({ category: z.string().max(MAX_SEARCH_LENGTH).optional() }).optional())
    .query(async ({ input }) => masterProduct(input?.category)),

  /**
   * ── SPOTLIGHT: the premium block inside ONE chosen type or category ─────
   *
   * `category` is REQUIRED, and that is the design rather than an oversight.
   * Spotlight is the surface a visitor reaches AFTER narrowing; a Spotlight
   * request with no category is a category error, and answering it from the
   * Master inventory would sell one advertiser's exclusive slot as three.
   *
   * Public on the same terms as the Master slots: the directory's own card
   * shape plus a label, and no commercial record.
   */
  spotlightProviders: publicProcedure
    .input(z.object({ category: z.string().min(1).max(MAX_SEARCH_LENGTH) }))
    .query(async ({ input }) => spotlightProviders(input.category)),

  spotlightProducts: publicProcedure
    .input(z.object({ category: z.string().min(1).max(MAX_SEARCH_LENGTH) }))
    .query(async ({ input }) => spotlightProducts(input.category)),

  /**
   * ── REPORTING A PLACEMENT EVENT ────────────────────────────────────────
   *
   * PUBLIC, because most marketplace browsing is anonymous and an advertiser's
   * impressions must not be limited to signed-in readers. That makes this the
   * one analytics surface an untrusted party can write to, so:
   *
   *   - the event type is a CLOSED enum - nobody invents a metric;
   *   - QUALIFIED_ENQUIRY is absent from that enum, because a browser must
   *     never be able to assert that a business relationship exists. That
   *     event is written server-side from the enquiry record itself;
   *   - the placement must exist and be LIVE, so a fabricated id records
   *     nothing and an expired campaign cannot keep accruing;
   *   - the surface and entity come from the placement ROW, not the request;
   *   - it is rate limited by IP, since there is no account to key on.
   *
   * It returns whether the event was recorded rather than a bare success: "we
   * recorded it" is the entire value of the call, and a refusal must not be
   * reported as a write.
   */
  recordPlacementEvent: publicProcedure
    .input(z.object({
      placementId: z.number().int().positive(),
      event: z.enum(PLACEMENT_CLIENT_EVENTS),
    }))
    .mutation(async ({ ctx, input }) => {
      const now = Date.now();
      const ip = getClientIp(ctx.req);
      if (ip) {
        const blocked = [
          contentLimiters.placementEventBurst.check(ip, now),
          contentLimiters.placementEventSustained.check(ip, now),
        ].find(result => !result.allowed);
        // A throttled report is DROPPED, not an error: analytics must never
        // interrupt a visitor's browsing, and the page has nothing useful to
        // do with the refusal.
        if (blocked) return { recorded: false as const };
      }
      const result = await recordPlacementEvent({
        placementId: input.placementId,
        event: input.event,
        userId: ctx.user?.id ?? null,
      });
      return { recorded: result.recorded };
    }),
  list: publicProcedure
    // BOUNDED, matching marketplace.vendors below, which already was. This
    // endpoint is PUBLIC and unauthenticated: `limit` had no int, no minimum
    // and no maximum, so `limit: 100000` returned the entire catalogue in one
    // request and `limit: -1` reached MySQL as a syntax error. The strings had
    // no length cap either.
    .input(z.object({
      category: z.string().max(MAX_SEARCH_LENGTH).optional(),
      search: z.string().max(MAX_SEARCH_LENGTH).optional(),
      limit: z.number().int().positive().max(100).default(24),
    }))
    .query(async ({ input }) => {
      const db = await requireDb();
      // Slice 10: `category` and `search` were accepted and then silently
      // ignored - the query built the filter variable and never used it. It
      // went unnoticed because the products page filtered a hardcoded array on
      // the client instead of calling this endpoint at all, so the parameters
      // had no consumer to be wrong for.
      const conditions = [eq(products.active, true)];
      if (input.category && input.category !== 'All') {
        conditions.push(eq(products.category, input.category));
      }
      if (input.search) {
        const term = containsTerm(input.search);
        conditions.push(or(
          like(products.name, term),
          like(products.nameAr, term),
          like(products.brand, term),
          like(products.category, term),
        )!);
      }
      const organic = await db.select().from(products)
        .where(and(...conditions))
        .orderBy(desc(products.featured), desc(products.createdAt))
        .limit(input.limit);

      /**
       * BOOST RE-RANKS THIS LIST. It does not add to it.
       *
       * The organic query above has already decided WHICH products match the
       * category and search terms; boosting only changes the order of what it
       * returned. A boosted product that does not match is simply not in
       * `organic`, so it cannot be lifted - which is what makes "pay to appear
       * in unrelated searches" impossible rather than merely discouraged.
       */
      const candidates = await boostCandidates({
        db, entityType: 'PRODUCT',
        category: input.category && input.category !== 'All' ? input.category : undefined,
      });
      return applyBoost(organic, candidates);
    }),
  /**
   * ONE VENDOR'S PUBLISHED CATALOGUE.
   *
   * The vendor detail page listed no products at all, so a buyer who found a
   * supplier in the directory could see their rating and nothing they sell.
   * Same visibility rule as `list`: published rows only, so a delisted product
   * is no more visible here than it is on the marketplace.
   */
  vendorProducts: publicProcedure
    .input(z.object({ vendorId: z.number().int().positive(), limit: z.number().int().positive().max(60).default(24) }))
    .query(async ({ input }) => {
      const db = await requireDb();
      return db.select().from(products)
        .where(and(eq(products.supplierId, input.vendorId), eq(products.active, true)))
        .orderBy(desc(products.createdAt))
        .limit(input.limit);
    }),
  get: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    // Slice 9: `active` is filtered here as well as in `list` above. A supplier
    // who deactivates a product - delisted, discontinued, mispriced - has
    // withdrawn it from sale, and it stayed fully readable by id to anyone who
    // knew or guessed the number. Absent and withdrawn are the same answer to a
    // buyer, so both are NOT_FOUND.
    const [product] = await db.select().from(products)
      .where(and(eq(products.id, input.id), eq(products.active, true)));
    if (!product) throw new TRPCError({ code: 'NOT_FOUND' });
    // WHO SELLS THIS.
    //
    // The page invited buyers to "ask the supplier a question" without ever
    // saying who the supplier was, and there was no route from a product to
    // the vendor's record or to the rest of their catalogue.
    //
    // Name and verification ONLY - exactly the two fields marketplace.vendors
    // already publishes to anyone, with no session at all. Nothing here widens
    // what the directory already shows, and email and phone are no more
    // present than they are anywhere else on a public surface.
    let supplier: { id: number; name: string | null; verified: boolean | null } | null = null;
    if (product.supplierId) {
      const [row] = await db.select({ id: users.id, name: users.name, verified: users.verified })
        .from(users).where(eq(users.id, product.supplierId));
      supplier = row ?? null;
    }
    return { ...product, supplier };
  }),
  myProducts: approvedProviderProcedure.query(async ({ ctx }) => {
    if (ctx.user.userRole !== 'supplier') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Supplier access required' });
    }
    const db = await requireDb();
    return db.select().from(products).where(eq(products.supplierId, ctx.user.id)).orderBy(desc(products.createdAt));
  }),
  create: approvedProviderProcedure
    .input(z.object({
      name: z.string().min(1),
      nameAr: z.string().optional(),
      description: z.string().optional(),
      /**
       * VALIDATED AGAINST THE DATABASE, NOT A COMPILED-IN LIST.
       *
       * This was `z.enum(PRODUCT_CATEGORIES)` - nineteen strings frozen into
       * the bundle. An administrator could not add a category without a
       * deployment, and the same list was the reason bulk upload refused
       * "Waterproofing" for a category BuildHub already had.
       *
       * The shape check stays here; WHICH categories are acceptable is decided
       * below by the same resolver bulk import uses, so the two paths cannot
       * disagree again.
       */
      category: z.string().min(1).max(120),
      brand: z.string().optional(),
      /**
       * WHERE IT COMES FROM. The column has existed all along and
       * `updateProduct` already accepted it - but `create` did not, and no
       * form collected it, so the only way a product could ever carry an
       * origin was to create it without one and then edit it. In a market
       * where "Italian marble" and "local marble" are different products at
       * different prices, that is not a cosmetic omission.
       */
      origin: z.string().max(100).optional(),
      price: z.number().optional(),
      stock: z.number().int().min(0).optional(),
      // A NEW product must use a unit from the shared list. See
      // shared/productUnits.ts: free text produced sixteen products priced per
      // "tonne" and three per "ton", which no buyer can compare.
      unit: z.string().max(50).optional(),
      deliveryDays: z.number().int().min(1).optional(),
      warranty: z.string().max(100).optional(),
      descriptionAr: z.string().max(5000).optional(),
      specs: z.string().max(5000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.userRole !== 'supplier') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Supplier access required' });
      }
      // Nothing exists yet, so there is no stored value to preserve: a new
      // product's unit comes from the list or is not set at all.
      const unit = normaliseUnit(input.unit, null);
      if (!unit.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Choose a unit from the list. "${input.unit}" is not one of: ${PRODUCT_UNITS.join(', ')}`,
        });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      /**
       * THE CATEGORY IS RESOLVED SERVER-SIDE, against the live taxonomy.
       *
       * The same call bulk import makes, so the two paths cannot disagree - and
       * the refusal names WHICH problem it is. A category that exists but is
       * hidden is not an unknown one, and telling a supplier otherwise sends
       * them looking for a typo that is not there.
       */
      const categoryIndex = await loadCategoryIndex(db);
      const resolved = resolveProductCategory(categoryIndex, input.category);
      if (!resolved.ok) {
        const rejection = resolved.rejection;
        const message = rejection.reason === 'INACTIVE'
          ? `"${rejection.category.nameEn}" is not currently available for new listings.`
          : rejection.reason === 'SERVICE_ONLY'
            ? `"${rejection.category.nameEn}" is a service category and cannot be used for a product.`
            : rejection.reason === 'AMBIGUOUS'
              ? `"${rejection.supplied}" matches more than one category. Use the exact category name.`
              : `"${input.category}" is not a BuildHub category.`;
        throw new TRPCError({ code: 'BAD_REQUEST', message });
      }

      const result = await db.insert(products).values({
        ...input,
        // The canonical name and its id, so a product created here is
        // indistinguishable from one created by bulk import.
        category: resolved.category.nameEn,
        categoryId: resolved.category.id,
        unit: unit.value ?? undefined,
        supplierId: ctx.user.id,
        price: input.price != null ? String(input.price) : undefined,
      });
      return { id: Number(result[0].insertId) };
    }),
  /**
   * SUPPLIER CATALOGUE MANAGEMENT.
   *
   * `create` existed and nothing else did: once a supplier listed a product
   * they could never correct a price, fix a typo, add a photo or take it down.
   * A catalogue you cannot edit is not a catalogue, and "delete the row in the
   * database" is not a product feature.
   *
   * All three procedures below share one ownership rule, applied the same way:
   * the row is read WITH the supplierId predicate, so a product that is not
   * yours simply does not come back. Absent and not-mine give the same NOT_FOUND
   * so the endpoint is not an oracle for which product ids exist.
   */
  /**
   * BULK CATALOGUE IMPORT.
   *
   * A supplier could add products only one at a time. A vendor with a real
   * catalogue had no way in, which made onboarding them a manual data-entry
   * project - the reason this was raised as a launch requirement.
   *
   * WHAT IS ENFORCED HERE AND NOT IN THE BROWSER:
   *  - the caller is an approved SUPPLIER, and every row is written with THEIR
   *    supplierId. There is no field in the file that can change the owner;
   *  - the file is re-parsed server-side. The preview the browser showed is a
   *    convenience, never the basis for what is written;
   *  - the category must be a real BuildHub category, so an import cannot
   *    invent taxonomy the directory does not have;
   *  - a name already in THIS supplier's catalogue is reported, not silently
   *    duplicated or silently overwritten - which of those a supplier wants is
   *    not something to guess;
   *  - ALL-OR-NOTHING, in one transaction. A partial import leaves a supplier
   *    unable to tell what landed, and re-uploading then duplicates whatever
   *    did.
   */
  importProducts: approvedProviderProcedure
    .input(z.object({
      csv: z.string().min(1).max(MAX_IMPORT_BYTES, 'File too large'),
      /** Preview asks for the verdict without writing anything. */
      dryRun: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.userRole !== 'supplier') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Supplier access required' });
      }
      enforceUploadRateLimit(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      /**
       * THE SAME RESOLVER THE SINGLE-PRODUCT PATH USES.
       *
       * Passing a resolver rather than a list of strings is the whole point:
       * there is no second copy of "which categories are acceptable" to drift.
       */
      const categoryIndex = await loadCategoryIndex(db);
      const parsed = parseProductImport(input.csv, importCategoryResolver(categoryIndex));

      // Names this supplier already lists. Scoped to them: another supplier
      // selling "Rebar 12mm" is not this supplier's problem, and telling them
      // about it would leak a rival's catalogue.
      const existing = parsed.rows.length > 0
        ? await db.select({ name: products.name }).from(products).where(eq(products.supplierId, ctx.user.id))
        : [];
      const alreadyListed = new Set(existing.map(row => row.name.trim().toLowerCase()));
      const conflicts = parsed.rows
        .filter(row => row.name && alreadyListed.has(row.name.trim().toLowerCase()))
        .map(row => ({ line: row.line, column: 'name', message: `"${row.name}" is already in your catalogue` }));

      /**
       * THE UNIT RULE APPLIES HERE TOO.
       *
       * `create` and `updateProduct` both send `unit` through normaliseUnit;
       * this path wrote `row.unit` straight from the file. A supplier could
       * not list ONE product priced per "ton" through the form, and could
       * list five hundred of them through a spreadsheet - which would have
       * quietly undone the whole point of having a list.
       *
       * Reported per line like every other import error, naming what is
       * acceptable, so the file can be corrected and re-uploaded. Every row
       * here is NEW, so there is no stored value to preserve: the legacy
       * escape hatch in normaliseUnit has nothing to match against and an
       * unknown unit is simply refused.
       */
      const unitErrors = parsed.rows
        .filter(row => !normaliseUnit(row.unit, null).ok)
        .map(row => ({
          line: row.line,
          column: 'unit',
          message: `"${row.unit}" is not a unit BuildHub recognises. Use one of: ${PRODUCT_UNITS.join(', ')}`,
        }));

      const errors = [...parsed.errors, ...conflicts, ...unitErrors]
        .sort((a, b) => a.line - b.line)
        .slice(0, 100);   // a bounded report; the first hundred are enough to act on

      const summary = {
        totalRows: parsed.rows.length,
        errors,
        errorCount: [...parsed.errors, ...conflicts, ...unitErrors].length,
        duplicatesInFile: parsed.duplicatesInFile,
        /**
         * Grouped by the offending value, so fifty Waterproofing rows read as
         * one problem affecting fifty rows rather than fifty problems. The
         * per-row errors above are unchanged - an error export needs them.
         */
        categoryIssues: parsed.categoryIssues,
        /**
         * What each row WILL be filed under, shown before anything is written.
         * A supplier who typed "Pools" sees "Swimming Pool Equipment" here
         * rather than discovering the mapping afterwards.
         */
        resolvedCategories: Array.from(new Map(parsed.rows
          .filter(row => row.resolvedCategory)
          .map(row => [row.category, { supplied: row.category, resolved: row.resolvedCategory! }])).values()),
        imported: 0,
        dryRun: input.dryRun,
      };

      if (errors.length > 0 || input.dryRun) return summary;

      await db.transaction(async (tx) => {
        await tx.insert(products).values(parsed.rows.map(row => ({
          supplierId: ctx.user.id,          // never from the file
          name: row.name,
          nameAr: row.nameAr,
          // The CANONICAL name and its id - not the raw cell. A supplier who
          // typed "Pools" gets the same stored result as one who picked
          // "Swimming Pool Equipment" from the dropdown, which is what makes
          // bulk and single product genuinely the same operation.
          category: row.resolvedCategory ?? row.category,
          categoryId: row.categoryId,
          brand: row.brand,
          description: row.description,
          unit: row.unit,
          price: row.price != null ? String(row.price) : undefined,
          stock: row.stock,
          deliveryDays: row.deliveryDays,
        })));
      });

      // No analytics event: the framework has no product-listing event, and
      // inventing one that nothing aggregates would be a metric that looks
      // real and measures nothing.
      return { ...summary, imported: parsed.rows.length };
    }),

  /**
   * THE LIVE TAXONOMY, for every surface that offers a category.
   *
   * Public because browsing is public, and because the alternative - each
   * screen shipping its own compiled-in copy - is precisely the architecture
   * that produced three disagreeing category lists.
   *
   * `scope` chooses the view: 'listable' is what a vendor may list against,
   * 'public' is what may be browsed. Both are filters over the same rows.
   */
  categories: publicProcedure
    .input(z.object({ view: z.enum(['listable', 'public']).default('listable') }).optional())
    .query(async ({ input }) => {
      // An empty taxonomy would empty every category dropdown on the platform
      // and read as "BuildHub has no categories".
      const db = await requireDb();
      const index = await loadCategoryIndex(db);
      const view = input?.view ?? 'listable';
      return { categories: view === 'public' ? publicCategories(index) : listableCategories(index) };
    }),

  /** The file a supplier fills in. Static, so it needs no authorization. */
  importTemplate: publicProcedure.query(() => ({ csv: importTemplateCsv() })),

  updateProduct: approvedProviderProcedure
    .input(z.object({
      id: z.number().int().positive(),
      // Every field optional: this is a PATCH. `name` and `category` are
      // notNull in the schema, so they may be changed but not cleared.
      name: z.string().min(1).max(255).optional(),
      nameAr: z.string().max(255).optional(),
      description: z.string().max(5000).optional(),
      descriptionAr: z.string().max(5000).optional(),
      /**
       * Shape only. WHICH categories are acceptable is decided below by the
       * same resolver create and bulk import use - see the block that sets
       * `patch.categoryId`.
       */
      category: z.string().min(1).max(120).optional(),
      brand: z.string().max(100).optional(),
      origin: z.string().max(100).optional(),
      // Bounds match decimal(12,2). A negative price is not a discount.
      price: z.number().min(0).max(9_999_999_999).optional(),
      currency: z.string().max(10).optional(),
      stock: z.number().int().min(0).optional(),
      unit: z.string().max(50).optional(),
      warranty: z.string().max(100).optional(),
      deliveryDays: z.number().int().min(0).max(3650).optional(),
      specs: z.string().max(5000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.userRole !== 'supplier') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Supplier access required' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const { id, price, ...rest } = input;
      // THE WHOLE ROW, not just its id. Part 43 needs the value a price moved
      // FROM, and after the UPDATE has run it is gone. The ownership predicate
      // is unchanged - this still refuses a product the caller does not own.
      const [owned] = await db.select()
        .from(products)
        .where(and(eq(products.id, id), eq(products.supplierId, ctx.user.id)));
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });

      /**
       * The unit rule, applied AFTER the row is read so the stored value is
       * known. A supplier editing the PRICE of a product whose unit predates
       * the list must not be refused because of a field they did not touch -
       * see normaliseUnit.
       */
      const unit = normaliseUnit(rest.unit, owned.unit);
      if (!unit.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Choose a unit from the list. "${rest.unit}" is not one of: ${PRODUCT_UNITS.join(', ')}`,
        });
      }
      if (unit.value !== undefined) rest.unit = unit.value ?? undefined;

      // Drop undefined keys so a PATCH cannot blank the columns it omitted.
      //
      // Over JSON this is belt-and-braces: `undefined` does not survive
      // serialisation and zod omits absent optionals entirely, so `{ ...rest }`
      // would behave identically today - mutation testing confirmed the two are
      // equivalent rather than one being a fix for the other. It is kept
      // because the guarantee should hold for any caller, not only for the ones
      // that happen to arrive as JSON.
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) patch[key] = value;
      }
      if (price !== undefined) patch.price = String(price);

      /**
       * EDITING A CATEGORY GOES THROUGH THE SAME RESOLVER, and moves the LINK
       * with the name.
       *
       * This is the third write path, and it was the remaining way for the two
       * to drift apart: `category` was free text here and `categoryId` was
       * never touched, so a product created as Waterproofing could be edited to
       * any string at all while its link still pointed at Waterproofing. The
       * row would then say two different things about itself - which is the
       * exact shape of the reported defect, reached through Edit instead of
       * through Add.
       *
       * A supplier who does not touch the category is unaffected: `patch` only
       * carries what the PATCH actually sent.
       */
      if (typeof patch.category === 'string') {
        const categoryIndex = await loadCategoryIndex(db);
        const resolved = resolveProductCategory(categoryIndex, patch.category);
        if (!resolved.ok) {
          const rejection = resolved.rejection;
          const message = rejection.reason === 'INACTIVE'
            ? `"${rejection.category.nameEn}" is not currently available for new listings.`
            : rejection.reason === 'SERVICE_ONLY'
              ? `"${rejection.category.nameEn}" is a service category and cannot be used for a product.`
              : rejection.reason === 'AMBIGUOUS'
                ? `"${rejection.supplied}" matches more than one category. Use the exact category name.`
                : `"${patch.category}" is not a BuildHub category.`;
          throw new TRPCError({ code: 'BAD_REQUEST', message });
        }
        patch.category = resolved.category.nameEn;
        patch.categoryId = resolved.category.id;
      }

      if (Object.keys(patch).length === 0) return { id };

      await db.update(products).set(patch)
        .where(and(eq(products.id, id), eq(products.supplierId, ctx.user.id)));
      // OLD -> NEW, in its own table with its own read path. The audit row
      // below still records only the field NAMES, for the wider audience it
      // has always had; the values go where only the owner and an
      // audit.read administrator can read them.
      await recordChangedFields(db, {
        subjectType: 'product', subjectId: id, ownerId: ctx.user.id, actorId: ctx.user.id,
      }, owned as unknown as Record<string, unknown>, patch, HISTORY_FIELDS.product);
      await recordCommercialEvent(db, {
        actorId: ctx.user.id, ownerId: ctx.user.id,
        subjectType: 'product', subjectId: id, action: 'product_updated',
        // WHICH fields changed, never their old and new values: an audit row
        // is read by more people than the record it describes.
        detail: `changed: ${Object.keys(patch).sort().join(', ')}`,
      });
      return { id };
    }),

  /**
   * Publish or delist. `active` already governs whether a product is visible to
   * buyers - marketplace.get and askQuestion both check it - but nothing could
   * ever set it, so a supplier who listed something by mistake had no way to
   * withdraw it.
   *
   * Delisting is reversible and does NOT delete: questions, quotations and
   * order history reference the row, and destroying it to hide it would take
   * the history with it.
   */
  setProductActive: approvedProviderProcedure
    .input(z.object({ id: z.number().int().positive(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.userRole !== 'supplier') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Supplier access required' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [owned] = await db.select({ id: products.id, active: products.active })
        .from(products)
        .where(and(eq(products.id, input.id), eq(products.supplierId, ctx.user.id)));
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
      await db.update(products).set({ active: input.active })
        .where(and(eq(products.id, input.id), eq(products.supplierId, ctx.user.id)));
      // Part 44: publishing and delisting is a status change, and a status
      // change without its previous value cannot answer "was this live when
      // the customer says they saw it".
      await recordFieldChange(db, {
        subjectType: 'product', subjectId: input.id, ownerId: ctx.user.id, actorId: ctx.user.id,
        field: 'active', oldValue: String(owned.active), newValue: String(input.active),
      });
      await recordCommercialEvent(db, {
        actorId: ctx.user.id, ownerId: ctx.user.id,
        subjectType: 'product', subjectId: input.id,
        action: input.active ? 'product_published' : 'product_delisted',
      });
      return { id: input.id, active: input.active };
    }),

  /**
   * Upload one product image.
   *
   * Bytes are SNIFFED, not trusted: assertUploadedFileMatches reads the real
   * header and refuses a file whose content disagrees with its declared type,
   * which is what stops an executable wearing a .png extension. Images only -
   * a product photo has no reason to be a PDF, and narrowing the allowlist
   * here costs nothing.
   *
   * The key is `product-images/user-<id>/...`, written by this procedure and
   * nothing else. Ownership is still resolved through the database row on
   * read (see authorizeStorageKey), because a key is a string an attacker may
   * come to possess.
   */
  uploadProductImage: approvedProviderProcedure
    .input(z.object({
      fileName: z.string().min(1).max(255),
      contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      base64: z.string().max(11_000_000),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.userRole !== 'supplier') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Supplier access required' });
      }
      enforceUploadRateLimit(ctx.user.id);
      const buffer = Buffer.from(input.base64, 'base64');
      if (buffer.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That file is empty' });
      if (buffer.length > MAX_PRODUCT_IMAGE_SIZE) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Image too large (max 5MB)' });
      }
      assertUploadedFileMatches(input.contentType, buffer, IMAGE_TYPES);
      const safeName = input.fileName.replace(/[^\w.-]+/g, '_');
      const { key, url } = await storagePutOrUnavailable(
        `product-images/user-${ctx.user.id}/${safeName}`,
        buffer,
        input.contentType,
      );
      return { key, url, name: input.fileName, type: input.contentType, size: buffer.length };
    }),

  /**
   * Set the ordered image list for one product.
   *
   * ORDER IS THE FEATURE: `images[0]` is what ProductDetail and the marketplace
   * card render as the primary photo, so reordering and choosing a primary are
   * the same operation and there is no separate `primaryImageId` to drift out
   * of sync with the array.
   *
   * Every URL must be one this supplier uploaded. Without that check a supplier
   * could point their listing at a competitor's photo, or at any storage path
   * they could name - the product row would then be a way to launder a key past
   * the proxy's ownership check.
   */
  setProductImages: approvedProviderProcedure
    .input(z.object({
      id: z.number().int().positive(),
      images: z.array(z.string().max(512)).max(MAX_PRODUCT_IMAGES),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.userRole !== 'supplier') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Supplier access required' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const prefix = `/manus-storage/product-images/user-${ctx.user.id}/`;
      for (const image of input.images) {
        // startsWith ALONE IS NOT ENOUGH. `.../user-5/../../secret.png` begins
        // with the caller's own prefix and then climbs out of it, so the
        // remainder is checked for traversal too. The storage proxy would
        // refuse such a key on READ, but without this the row would still
        // store a path that means something other than it appears to - and the
        // next reader of that column has no reason to expect one.
        if (!image.startsWith(prefix)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You may only use images you uploaded.',
          });
        }
        const remainder = image.slice(prefix.length);
        const traverses = remainder.length === 0
          || remainder.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..');
        if (traverses) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You may only use images you uploaded.',
          });
        }
      }
      // Duplicates would render the same photo twice and make "reorder" lie.
      if (new Set(input.images).size !== input.images.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That image is already on this product.' });
      }

      const [owned] = await db.select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, input.id), eq(products.supplierId, ctx.user.id)));
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });

      await db.update(products)
        .set({ images: input.images.length > 0 ? JSON.stringify(input.images) : null })
        .where(and(eq(products.id, input.id), eq(products.supplierId, ctx.user.id)));
      await recordCommercialEvent(db, {
        actorId: ctx.user.id, ownerId: ctx.user.id,
        subjectType: 'product', subjectId: input.id, action: 'product_images_changed',
        detail: `${input.images.length} image(s)`,
      });
      return { id: input.id, images: input.images };
    }),

  /**
   * THE FOURTH LIST, AND THE ONE THAT EXPLAINS THE REPORTED FAILURE.
   *
   * This returned a hard-coded array of 27 names that INCLUDED "Waterproofing"
   * and "Pools" - while the write path validated against a different list of
   * 19 that did not. The marketplace filter offered a category, a supplier
   * chose it, and listing it was then refused as "not a BuildHub category".
   * The product was telling the user two different things about itself.
   *
   * It now serves the same taxonomy as everything else. The shape stays a
   * string array so Marketplace.tsx keeps working; `marketplace.categories`
   * with a view argument is the richer form for surfaces that need slugs and
   * Arabic names.
   */
  categoryNames: publicProcedure.query(async () => {
    const db = await requireDb();
    const index = await loadCategoryIndex(db);
    return publicCategories(index).map(category => category.nameEn);
  }),
  questions: publicProcedure.input(z.object({ productId: z.number() })).query(async ({ input }) => {
    const db = await requireDb();
    // Slice 9: an explicit column allowlist. This is a PUBLIC endpoint and the
    // bare select returned `askerId`, so anyone could walk the product
    // catalogue and collect the user id of every buyer who had asked about
    // anything. The page renders the question, the answer and the timestamps;
    // it has never needed to say who asked.
    return db.select({
      id: productQuestions.id,
      productId: productQuestions.productId,
      question: productQuestions.question,
      answer: productQuestions.answer,
      answeredAt: productQuestions.answeredAt,
      createdAt: productQuestions.createdAt,
    }).from(productQuestions).where(eq(productQuestions.productId, input.productId)).orderBy(desc(productQuestions.createdAt));
  }),
  askQuestion: protectedProcedure.input(z.object({ productId: z.number(), question: z.string().min(2).max(2000) })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    // Mirrors marketplace.get's predicate exactly, and for its reasons. Two
    // things were wrong with the line this replaces.
    //
    // `input.productId > 10` let ids 1-10 skip the existence check entirely -
    // a leftover accommodation for the static mock catalogue that used to back
    // this page. productQuestions.productId now carries a RESTRICT foreign key,
    // so the insert would fail at the database instead, turning a clean
    // NOT_FOUND into a 500 for exactly those ten ids.
    //
    // And `active` was never checked. Slice 9 established for marketplace.get
    // that a withdrawn product and an absent one are the same answer to a
    // buyer; a question thread attached to a product the supplier has delisted
    // contradicted that, and had nowhere to be displayed.
    const [product] = await db.select({ id: products.id, name: products.name, supplierId: products.supplierId })
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.active, true)));
    if (!product) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    const result = await db.insert(productQuestions).values({ productId: input.productId, askerId: ctx.user.id, question: input.question });
    // The supplier is the only person who can answer, and nothing told them a
    // question existed. Every thread stayed one-sided while the buyer-facing
    // listing implied a reply was coming.
    //
    // The asker's identity is deliberately NOT in the notification: the Q&A is
    // public on the listing and marketplace.questions omits askerId precisely
    // so the thread cannot be walked back to the buyers.
    if (product.supplierId && product.supplierId !== ctx.user.id) {
      await notifyUser(db, {
        userId: product.supplierId,
        title: 'New question on your product',
        body: `Someone asked a question about "${product.name}"`,
        type: 'product',
        link: `/marketplace/products/${input.productId}`,
        messageKey: 'notif.product.question',
        messageParams: { productName: product.name },
      });
    }
    return { id: Number(result[0].insertId) };
  }),
  /**
   * THE OTHER HALF OF THE Q&A, which did not exist.
   *
   * productQuestions carries `answer` and `answeredAt`, marketplace.questions
   * returns both, and ProductDetail renders the answer when present - but
   * nothing could ever write one. A customer asked a question on a listing and
   * the supplier had no procedure and no surface to reply with, so every
   * thread was permanently one-sided while the buyer-facing UI implied a reply
   * was coming.
   *
   * AUTHORIZATION: the supplier who owns the product, and nobody else. Not the
   * asker, not another supplier, not an approved provider in general. The
   * ownership check is a JOIN rather than two reads, so there is no window
   * between "this question exists" and "this product is mine".
   *
   * A question on a delisted product cannot be answered, matching askQuestion:
   * a withdrawn product and an absent one are the same answer to a buyer, and
   * an answer that appears on nothing would contradict that.
   *
   * NOT DECIDED HERE: whether a supplier may EDIT an answer once given, and
   * whether answers need moderation before they are public. Both are policy.
   * This writes an answer once and refuses to overwrite one.
   */
  answerQuestion: protectedProcedure
    .input(z.object({ questionId: z.number().int().positive(), answer: z.string().min(2).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [row] = await db
        .select({
          questionId: productQuestions.id,
          productId: productQuestions.productId,
          askerId: productQuestions.askerId,
          answer: productQuestions.answer,
          productName: products.name,
          supplierId: products.supplierId,
          active: products.active,
        })
        .from(productQuestions)
        .innerJoin(products, eq(productQuestions.productId, products.id))
        .where(eq(productQuestions.id, input.questionId));

      // One refusal for "no such question", "not your product" and "delisted".
      // Distinguishing them would tell a caller which question ids exist and
      // which products are theirs to guess at.
      if (!row || row.supplierId !== ctx.user.id || !row.active) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Question not found' });
      }
      if (row.answer) {
        throw new TRPCError({ code: 'CONFLICT', message: 'That question has already been answered.' });
      }

      await db.update(productQuestions)
        .set({ answer: input.answer, answeredAt: new Date() })
        .where(eq(productQuestions.id, input.questionId));
      // subjectType is 'product' so subjectId must be a PRODUCT id. It was the
      // question id, which meant a supplier reading the trail for product 12
      // would get rows about whichever questions happened to share that number.
      // The question itself is context.
      await recordCommercialEvent(db, {
        actorId: ctx.user.id, ownerId: ctx.user.id,
        subjectType: 'product', subjectId: row.productId,
        action: 'product_question_answered',
        detail: `question ${input.questionId}`,
      });
      // And the person who asked is told there is an answer, on the listing
      // that now carries it.
      if (row.askerId && row.askerId !== ctx.user.id) {
        await notifyUser(db, {
          userId: row.askerId,
          title: 'Your question was answered',
          body: `The supplier answered your question about "${row.productName}"`,
          type: 'product',
          link: `/marketplace/products/${row.productId}`,
          messageKey: 'notif.product.answered',
          messageParams: { productName: row.productName ?? '' },
        });
      }
      return { id: input.questionId };
    }),
  /**
   * The questions on THIS supplier's own products, so they have somewhere to
   * answer from. Scoped by supplierId in the join - a supplier sees their own
   * threads and no one else's.
   */
  myProductQuestions: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db
      .select({
        id: productQuestions.id,
        productId: productQuestions.productId,
        productName: products.name,
        question: productQuestions.question,
        answer: productQuestions.answer,
        answeredAt: productQuestions.answeredAt,
        createdAt: productQuestions.createdAt,
      })
      .from(productQuestions)
      .innerJoin(products, eq(productQuestions.productId, products.id))
      .where(and(eq(products.supplierId, ctx.user.id), eq(products.active, true)))
      .orderBy(desc(productQuestions.createdAt));
  }),
});

// ── RFQ Router ─────────────────────────────────────────────────────────────
const rfqRouter = router({
  // Slice 9. This was `publicProcedure` and returned `select().from(rfqs)` -
  // every column of the 50 most recent RFQs, to anyone on the internet with no
  // account at all. That included `budget`, which is the homeowner's private
  // figure for the job, alongside requesterId, description, location and the
  // attachment keys.
  //
  // Authenticated exposure IS the approved design: Phase 4B.3 documented that
  // rfq.list and rfq.get show full RFQ detail to any signed-in user because
  // BuildHub is an open-bidding marketplace. Anonymous exposure was never part
  // of that, and `rfq.get` immediately below has always been protected - this
  // was one procedure that got missed, not a policy.
  //
  // Both client call sites are already authenticated-only paths, and
  // RFQPage.tsx gates its neighbouring queries on isAuthenticated already.
  // The browse feed. An explicit column allowlist, NOT `select().from(rfqs)`.
  //
  // Slice 9 moved this from public to protected because it was handing every
  // RFQ column to anonymous callers. That closed the anonymous hole and stopped
  // there: any authenticated account still received the whole row, and a free
  // account costs one sign-up. Verified against a live server with a brand-new
  // unapproved contractor - rfq.eligible FORBIDDEN, rfq.openEnquiry FORBIDDEN,
  // rfq.list ALLOWED, full rows.
  //
  // `attachments` is the part that had to go. It holds the URLs of the
  // requester's own uploads - drawings, BOQs, site photos - and the feed
  // rendered them inline for every RFQ, so every signed-in account had direct
  // links to every requester's files. A browse card needs none of that to
  // decide whether a lead is worth opening. Owners still get their own
  // attachments through `myList`, which is scoped by requesterId, and
  // parseRfqAttachments treats the absent field as "none".
  //
  // NOTE for the owner, deliberately not decided here: `description` and the
  // exact `budget` are still returned. Whether the free feed should show those
  // at all is a pricing question - openQualifiedEnquiry charges a credit for
  // "full detail" - and narrowing it would change what the product gives away.
  // That is a call for you, not something to infer from a table.
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    /**
     * WHO THE FEED IS FOR.
     *
     * This returned every RFQ's title, full description, exact budget and
     * location to EVERY authenticated caller - which meant one homeowner could
     * read another homeowner's brief and the exact figure they were willing to
     * spend, and so could a supplier who had no intention of bidding.
     *
     * The feed exists so PROVIDERS can find work. A customer has no reason to
     * browse other customers' requests, so a non-provider now sees only their
     * own. This is the owner's decision, taken explicitly, recorded here:
     * discovery is for approved providers; a requester always sees their own.
     */
    const isProvider = providerRoles.includes(ctx.user.userRole as typeof providerRoles[number])
      && (ctx.user as { onboardingStatus?: string }).onboardingStatus === 'approved';
    return db.select({
      id: rfqs.id,
      requesterId: rfqs.requesterId,
      projectId: rfqs.projectId,
      title: rfqs.title,
      description: rfqs.description,
      category: rfqs.category,
      budget: rfqs.budget,
      location: rfqs.location,
      deadline: rfqs.deadline,
      productReference: rfqs.productReference,
      status: rfqs.status,
      createdAt: rfqs.createdAt,
    }).from(rfqs)
      .where(isProvider ? undefined : eq(rfqs.requesterId, ctx.user.id))
      .orderBy(desc(rfqs.createdAt)).limit(50);
  }),
  myList: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db.select().from(rfqs).where(eq(rfqs.requesterId, ctx.user.id)).orderBy(desc(rfqs.createdAt));
  }),
  /**
   * ONE RFQ, at the same visibility the open feed already gives.
   *
   * WHY THIS EXISTS. `rfq.get` is scoped `WHERE requesterId = ctx.user.id`, so
   * a provider cannot read a single RFQ at all - they only ever saw RFQs as
   * rows inside `rfq.list`. That made a detail PAGE impossible for the very
   * people an RFQ is addressed to, which is why the product had none.
   *
   * WHY IT IS NOT A NEW EXPOSURE. The projection below is EXACTLY the column
   * allowlist `rfq.list` already returns to any authenticated caller - and
   * deliberately not `attachments`, which is what `openQualifiedEnquiry`
   * charges a credit to reveal. The only difference is that a row is addressed
   * by id instead of arriving inside a page of fifty.
   *
   * The one honest asymmetry: `rfq.list` is `limit(50)` ordered by newest, so
   * an older RFQ is not in the feed while it IS fetchable here. That limit is
   * pagination, not an authorization boundary - it protects the payload size,
   * not the record - and treating it as a boundary would mean an RFQ became
   * private simply by ageing, which is not a rule this product has anywhere
   * else. Stated rather than glossed, because it is the kind of difference
   * that deserves an owner's eye.
   *
   * VIEWING IS FREE. Opening this page charges nothing. The credit is spent on
   * `openEnquiry`, which reveals the attachments and the full brief, and that
   * separation is the whole reason a supplier can review before they buy.
   */
  /**
   * ── WHO IS ASKING (§17) ──────────────────────────────────────────────────
   *
   * A supplier reviewing a request could see the brief and not one word about
   * who wrote it. The response page showed "Contact: N/A" while the answer sat
   * in `users` the whole time.
   *
   * TWO TIERS, AND THE LINE BETWEEN THEM IS THE ONE THE PRODUCT ALREADY DRAWS.
   *
   *   IDENTITY IS FREE - name, role, location, verification, member since. A
   *   supplier deciding whether to bid needs to know whether they are quoting
   *   a verified customer in their own city, and `rfq.summary` already gives
   *   the brief away on exactly that reasoning.
   *
   *   CONTACT CHANNELS ARE NOT - email and phone are released only to the
   *   requester themselves, to an administrator, or to a provider who has
   *   CONSUMED a qualified enquiry on this RFQ. That is not a rule invented
   *   here: openQualifiedEnquiry is what a provider spends a credit on, and
   *   handing out the customer's phone number for free would let any approved
   *   supplier route around the charge by calling them directly. Making the
   *   contact details the thing the credit buys keeps the existing commercial
   *   model intact rather than quietly repricing it.
   *
   * AN EXPLICIT COLUMN ALLOWLIST, like INVESTIGATION_PARTY_COLUMNS: `users`
   * holds passwordHash and a live invitationToken, and a bare select has
   * carried both into a browser twice in this file's history.
   */
  requesterContact: protectedProcedure
    .input(z.object({ rfqId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const [rfq] = await db.select({ id: rfqs.id, requesterId: rfqs.requesterId })
        .from(rfqs).where(eq(rfqs.id, input.rfqId));
      if (!rfq) throw new TRPCError({ code: 'NOT_FOUND', message: 'RFQ not found' });

      const isOwner = rfq.requesterId === ctx.user.id;
      const isApprovedProvider = providerRoles.includes(ctx.user.userRole as typeof providerRoles[number])
        && (ctx.user as { onboardingStatus?: string }).onboardingStatus === 'approved';
      const isAdmin = isAdminRole(ctx.user.adminRole);
      // Same gate as `summary`, and NOT_FOUND rather than FORBIDDEN so a
      // stranger cannot use this to learn that an id exists.
      if (!isOwner && !isApprovedProvider && !isAdmin) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'RFQ not found' });
      }

      const [requester] = await db.select({
        id: users.id,
        name: users.name,
        userRole: users.userRole,
        location: users.location,
        verified: users.verified,
        accountStatus: users.accountStatus,
        createdAt: users.createdAt,
      }).from(users).where(eq(users.id, rfq.requesterId));
      if (!requester) throw new TRPCError({ code: 'NOT_FOUND', message: 'Requester not found' });

      // Has this provider actually paid for this lead?
      const consumed = isOwner || isAdmin
        ? true
        : (await db.select({ id: qualifiedEnquiries.id }).from(qualifiedEnquiries)
            .where(and(eq(qualifiedEnquiries.userId, ctx.user.id), eq(qualifiedEnquiries.rfqId, input.rfqId)))
            .limit(1)).length > 0;

      let contact: { email: string | null; phone: string | null } | null = null;
      if (consumed) {
        const [row] = await db.select({ email: users.email, phone: users.phone })
          .from(users).where(eq(users.id, rfq.requesterId));
        contact = { email: row?.email ?? null, phone: row?.phone ?? null };
      }

      return {
        requester,
        // Absent, and the client says WHY it is absent rather than rendering
        // "N/A" as though the customer had left the field blank.
        contact,
        contactUnlocked: consumed,
      };
    }),

  summary: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [rfq] = await db.select({
        id: rfqs.id,
        requesterId: rfqs.requesterId,
        projectId: rfqs.projectId,
        title: rfqs.title,
        description: rfqs.description,
        category: rfqs.category,
        budget: rfqs.budget,
        location: rfqs.location,
        deadline: rfqs.deadline,
        productReference: rfqs.productReference,
        status: rfqs.status,
        createdAt: rfqs.createdAt,
      }).from(rfqs).where(eq(rfqs.id, input.id));
      if (!rfq) throw new TRPCError({ code: 'NOT_FOUND', message: 'RFQ not found' });
      /**
       * THE SAME GATE AS THE FEED. This is the per-record version of
       * `rfq.list`, so it must not be a way around the narrowing applied
       * there: the brief and the exact budget are for approved providers
       * deciding whether to bid, and for the requester reading their own.
       * NOT_FOUND rather than FORBIDDEN, so it does not confirm to a stranger
       * that an id exists.
       */
      const mayRead = rfq.requesterId === ctx.user.id
        || (providerRoles.includes(ctx.user.userRole as typeof providerRoles[number])
            && (ctx.user as { onboardingStatus?: string }).onboardingStatus === 'approved');
      if (!mayRead) throw new TRPCError({ code: 'NOT_FOUND', message: 'RFQ not found' });
      /**
       * The lines are part of the BRIEF, and the brief is free to read - the
       * same rule already applied to `description`, `budget` and `location` by
       * `rfq.list`. A supplier deciding whether to spend a credit needs to know
       * what is being asked for; the attachments remain what the credit buys.
       */
      const items = await db.select({
        id: rfqItems.id, productId: rfqItems.productId, name: rfqItems.name,
        variantLabel: rfqItems.variantLabel, quantity: rfqItems.quantity,
        unit: rfqItems.unit, specifications: rfqItems.specifications,
        unitPriceSnapshot: rfqItems.unitPriceSnapshot,
      }).from(rfqItems).where(eq(rfqItems.rfqId, input.id)).orderBy(rfqItems.position, rfqItems.id);
      return { ...rfq, items };
    }),
  /**
   * The server-side gate for the dedicated response page.
   *
   * The free RFQ summary is intentionally wider than the paid/invited response
   * workflow. This read never consumes an enquiry; it only reports authority
   * already established by openQualifiedEnquiry, an invitation, or the
   * supplier's existing quotation. Requester attachments are returned only
   * after that authority exists.
   */
  responseAccess: approvedProviderProcedure
    .input(z.object({ rfqId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [rfq] = await db.select({
        id: rfqs.id,
        projectId: rfqs.projectId,
        status: rfqs.status,
        attachments: rfqs.attachments,
      }).from(rfqs).where(eq(rfqs.id, input.rfqId)).limit(1);
      if (!rfq) throw new TRPCError({ code: 'NOT_FOUND', message: 'RFQ not found' });

      const access = await getRfqResponseAccess(db, ctx.user.id, input.rfqId);
      let projectTitle: string | null = null;
      if (access.canRespond && rfq.projectId !== null) {
        const [project] = await db.select({ title: projects.title })
          .from(projects).where(eq(projects.id, rfq.projectId)).limit(1);
        projectTitle = project?.title ?? null;
      }
      return {
        ...access,
        status: rfq.status,
        projectTitle,
        attachments: access.canRespond ? rfq.attachments : null,
      };
    }),
  // The requester's own RFQ, in full. Scoped by requesterId in the WHERE clause.
  //
  // This had no ownership check at all: any authenticated caller could read any
  // RFQ's entire row by id, attachments included. It is the same detail that
  // openQualifiedEnquiry gates behind approval, declared categories, a billing
  // entitlement and one credit per lead enforced by a unique index - so this one
  // procedure made that whole mechanism optional for anyone willing to guess an
  // integer. It has no callers in the client.
  //
  // A provider who wants this detail goes through openEnquiry, which is what the
  // credit buys. NOT_FOUND rather than FORBIDDEN so it does not confirm that an
  // id exists to someone who cannot see it.
  get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [rfq] = await db.select().from(rfqs)
      .where(and(eq(rfqs.id, input.id), eq(rfqs.requesterId, ctx.user.id)));
    if (!rfq) throw new TRPCError({ code: 'NOT_FOUND' });
    // Read only AFTER ownership is established, so the items query cannot
    // become a second way to learn what an RFQ contains.
    const items = await db.select().from(rfqItems)
      .where(eq(rfqItems.rfqId, rfq.id)).orderBy(rfqItems.position, rfqItems.id);
    return { ...rfq, items };
  }),
  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      /**
       * REQUIRED, AND A CLOSED ENUM. Both halves of that were once wrong, and
       * together they produced an RFQ the platform could not serve.
       *
       * `openQualifiedEnquiry` refuses any RFQ whose category is not one of
       * RFQ_CATEGORIES - `unclassified_rfq`. A category-less RFQ was still
       * accepted, still listed in the open feed, and permanently impossible to
       * open or quote on. The customer waited for responses that could never
       * arrive; suppliers saw a request they were forbidden to answer; nobody
       * was told why. A free-text category did the same thing, because
       * "Marble" is not a member of the taxonomy either.
       *
       * Requiring it is not a business decision - the eligibility rule that
       * needs it already exists. This makes the contract match the requirement
       * rather than inventing one.
       */
      category: z.enum(RFQ_CATEGORIES),
      budget: z.number().optional(),
      location: z.string().optional(),
      deadline: z.date().optional(),
      projectId: z.number().optional(),
      productReference: z.object({ productId: z.number(), variantId: z.string().min(1), variantLabel: z.string().min(1) }).optional(),
      /**
       * THE LINES OF THE REQUEST — what the customer is actually asking to be
       * priced. Before this, an RFQ could carry ONE `productReference` and no
       * quantity at all, while the UI offered a button labelled "Add to RFQ
       * list". See shared/rfqBasket.ts.
       *
       * `name`, `unit` and the price are NOT taken from this input for a
       * catalogue line: they are re-read from the products table below, so a
       * caller cannot post an item claiming to be a product it is not.
       */
      items: z.array(z.object({
        productId: z.number().int().positive().nullable().optional(),
        name: z.string().min(1).max(MAX_ITEM_NAME),
        variantLabel: z.string().max(MAX_ITEM_VARIANT).nullable().optional(),
        quantity: z.number().min(MIN_ITEM_QUANTITY).max(MAX_ITEM_QUANTITY),
        unit: z.string().max(MAX_ITEM_UNIT).nullable().optional(),
        specifications: z.string().max(MAX_ITEM_SPECIFICATIONS).nullable().optional(),
      })).max(MAX_BASKET_ITEMS).optional(),
      attachments: z.array(z.object({
        key: z.string(),
        url: z.string(),
        name: z.string(),
        type: z.string(),
        size: z.number(),
      })).max(6).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      enforceRfqRateLimit(ctx.user.id);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      if (input.projectId != null) {
        // Raising an RFQ commits the project to spend, so it needs the
        // `commercial` capability - owner or project manager. A contractor on
        // the job can see it and report on it but cannot commission from it.
        await requireProjectAccess(db, input.projectId, ctx.user.id, 'commercial');
      }
      const { attachments, productReference, items, ...rest } = input;

      /**
       * EVERY CATALOGUE LINE IS RE-READ FROM THE CATALOGUE.
       *
       * The client sends a productId and a name. Only the id is trusted: the
       * name, unit and price are taken from the products row, so a basket
       * edited in localStorage cannot put "Premium Italian Marble" next to a
       * cement product's id, and a supplier cannot be sent a request naming
       * something they never listed.
       *
       * An id that does not exist, or points at a WITHDRAWN product, is
       * refused rather than silently dropped - a customer who thinks they
       * asked for three things must not receive quotes for two.
       */
      const resolvedItems: {
        productId: number | null; name: string; variantLabel: string | null;
        quantity: string; unit: string | null; specifications: string | null;
        unitPriceSnapshot: string | null; position: number;
      }[] = [];
      if (items && items.length > 0) {
        const catalogueIds = Array.from(new Set(
          items.map(item => item.productId).filter((id): id is number => typeof id === 'number'),
        ));
        const catalogue = catalogueIds.length > 0
          ? await db.select({
              id: products.id, name: products.name, unit: products.unit,
              price: products.price, active: products.active,
            }).from(products).where(inArray(products.id, catalogueIds))
          : [];
        const byId = new Map(catalogue.map(row => [row.id, row]));
        items.forEach((item, index) => {
          if (item.productId == null) {
            // A free-text line. The customer's own words, length-capped by zod.
            resolvedItems.push({
              productId: null, name: item.name, variantLabel: item.variantLabel ?? null,
              quantity: String(item.quantity), unit: item.unit ?? null,
              specifications: item.specifications ?? null, unitPriceSnapshot: null, position: index,
            });
            return;
          }
          const product = byId.get(item.productId);
          if (!product) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'One of the requested products is no longer available' });
          }
          if (!product.active) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `"${product.name}" has been withdrawn by its supplier and cannot be quoted` });
          }
          resolvedItems.push({
            productId: product.id,
            name: product.name,
            variantLabel: item.variantLabel ?? null,
            quantity: String(item.quantity),
            unit: item.unit ?? product.unit ?? null,
            specifications: item.specifications ?? null,
            unitPriceSnapshot: product.price ?? null,
            position: index,
          });
        });
      }

      /**
       * ACCIDENTAL DOUBLE-SUBMIT.
       *
       * Two rfq.create calls fired concurrently with the same payload produced
       * TWO identical requests, each notifying suppliers and each collecting
       * its own bids. Proven by firing them in parallel from one session
       * against the running server, not inferred.
       *
       * A unique constraint would be the wrong tool: a customer may legitimately
       * post the same request again weeks later, for the next floor or the next
       * property. What is not legitimate is the same title, from the same
       * customer, in the same category, seconds apart - that is one intent and
       * two clicks.
       *
       * The window is narrow and the response is IDEMPOTENT rather than an
       * error: the second click returns the request the first one made, so the
       * customer sees the outcome they expected instead of a failure for
       * something that did succeed.
       */
      const rfqId = await db.transaction(async (tx) => {
        // THE LOCK IS WHY THIS WORKS, and the first attempt at it did not.
        //
        // Checking for a recent identical request BEFORE the transaction reads
        // committed state only - so two genuinely concurrent submissions both
        // read "nothing there" and both insert. Measured, not assumed: with the
        // unlocked check in place, two parallel calls still produced two rows,
        // three runs out of three.
        //
        // Locking the REQUESTER'S OWN users row serialises that customer's
        // creations against each other and nothing else. The second transaction
        // blocks here, and by the time it reads, the first has committed and is
        // visible. Contention is one row per person, which is exactly the scope
        // of the problem.
        //
        // The same lock, on the same table, is taken first in submitQuotation.
        // Consistent ordering is deliberate - the enquiry path deadlocked
        // precisely because two transactions took overlapping locks in
        // different orders.
        await tx.select({ id: users.id }).from(users).where(eq(users.id, ctx.user.id)).for('update');

        const [recentIdentical] = await tx
          .select({ id: rfqs.id })
          .from(rfqs)
          .where(and(
            eq(rfqs.requesterId, ctx.user.id),
            eq(rfqs.title, rest.title),
            gte(rfqs.createdAt, new Date(Date.now() - DUPLICATE_SUBMIT_WINDOW_MS)),
          ))
          .orderBy(desc(rfqs.id))
          .limit(1);
        // Returned as the id of "the request you just made", because from the
        // customer's point of view that is exactly what it is.
        if (recentIdentical) return recentIdentical.id;

        const result = await tx.insert(rfqs).values({
          ...rest,
          requesterId: ctx.user.id,
          budget: input.budget != null ? String(input.budget) : undefined,
          attachments: attachments && attachments.length > 0 ? JSON.stringify(attachments) : undefined,
          productReference: productReference ?? undefined,
        });
        const id = Number(result[0].insertId);
        if (resolvedItems.length > 0) {
          await tx.insert(rfqItems).values(resolvedItems.map(item => ({ ...item, rfqId: id })));
        }
        return id;
      });
      recordEventAsync({
        type: ANALYTICS_EVENTS.RFQ_POSTED,
        userId: ctx.user.id,
        subjectType: 'rfq',
        subjectId: rfqId,
        metadata: { category: rest.category ?? undefined },
      });
      await recordCommercialEvent(db, {
        actorId: ctx.user.id, ownerId: ctx.user.id,
        subjectType: 'rfq', subjectId: rfqId, action: 'rfq_created',
        detail: `${rest.category ?? 'uncategorised'}`
          + `${resolvedItems.length ? `, ${resolvedItems.length} item(s)` : ''}`
          + `${attachments?.length ? `, ${attachments.length} attachment(s)` : ''}`,
      });

      /**
       * FIRST_VALID_RFQ - and it checks that it IS the first.
       *
       * The engine is idempotent on its own, so firing on every RFQ would
       * record the qualification only once anyway. But the campaign type is
       * named FIRST_VALID_RFQ, and a referral qualifying on somebody's tenth
       * RFQ - because that is when a campaign finally became eligible - is not
       * what an administrator budgeting that campaign agreed to. The count is
       * the cheap way to make the name true.
       */
      const [rfqCount] = await db.select({ count: sql<number>`count(*)` })
        .from(rfqs).where(eq(rfqs.requesterId, ctx.user.id));
      if (Number(rfqCount?.count ?? 0) === 1) {
        await qualifyReferralEvent(db, ctx.user.id, 'FIRST_VALID_RFQ', `firstrfq:${ctx.user.id}`, new Date());
      }
      return { id: rfqId };
    }),
  uploadAttachment: protectedProcedure
    .input(z.object({
      fileName: z.string().min(1).max(255),
      contentType: z.string().refine(
        isAllowedRfqAttachmentType,
        { message: 'Only images and PDF floor plans are allowed' },
      ),
      base64: z.string().max(11_000_000, 'File too large (max ~8MB)'),
    }))
    .mutation(async ({ ctx, input }) => {
      enforceUploadRateLimit(ctx.user.id);
      const buffer = Buffer.from(input.base64, 'base64');
      if (buffer.length > MAX_RFQ_ATTACHMENT_SIZE) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File too large (max 8MB)' });
      }
      assertUploadedFileMatches(input.contentType, buffer, DOCUMENT_TYPES);
      const safeName = input.fileName.replace(/[^\w.-]+/g, '_');
      const { key, url } = await storagePutOrUnavailable(
        `rfq-attachments/user-${ctx.user.id}/${safeName}`,
        buffer,
        input.contentType,
      );
      return { key, url, name: input.fileName, type: input.contentType, size: buffer.length };
    }),
  myQuotations: approvedProviderProcedure.query(async ({ ctx }) => {
    if (!providerRoles.includes(ctx.user.userRole as typeof providerRoles[number])) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Provider access required' });
    }
    const db = await requireDb();
    return db.select({
      id: quotations.id,
      rfqId: quotations.rfqId,
      price: quotations.price,
      currency: quotations.currency,
      timeline: quotations.timeline,
      warranty: quotations.warranty,
      validUntil: quotations.validUntil,
      commercialTerms: quotations.commercialTerms,
      paymentTerms: quotations.paymentTerms,
      notes: quotations.notes,
      attachments: quotations.attachments,
      status: quotations.status,
      revisionNumber: quotations.revisionNumber,
      createdAt: quotations.createdAt,
      rfqTitle: rfqs.title,
      rfqStatus: rfqs.status,
    }).from(quotations).leftJoin(rfqs, eq(quotations.rfqId, rfqs.id))
      .where(and(eq(quotations.providerId, ctx.user.id), isNull(quotations.supersededAt)))
      .orderBy(desc(quotations.createdAt));
  }),
  // SECURITY (Phase 4A final gate): quotations on an RFQ include each bidding
  // vendor's email, exact price, timeline, and notes - competitive-intelligence
  // and contact-info exposure if any authenticated user (including a rival
  // vendor) could pull them for an RFQ they don't own, not just the homeowner
  // legitimately comparing bids on their own request. This ownership check
  // matches the same pattern already used by every other project/RFQ-scoped
  // query in this file (projects.get, projects.expenses, projects.dailyLogs).
  quotations: protectedProcedure.input(z.object({ rfqId: z.number() })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    const [rfq] = await db.select({ requesterId: rfqs.requesterId }).from(rfqs).where(eq(rfqs.id, input.rfqId));
    if (!rfq || rfq.requesterId !== ctx.user.id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this RFQ' });
    }
    const rows = await db
      .select({
        id:               quotations.id,
        rfqId:            quotations.rfqId,
        providerId:       quotations.providerId,
        price:            quotations.price,
        currency:         quotations.currency,
        timeline:         quotations.timeline,
        warranty:         quotations.warranty,
        validUntil:       quotations.validUntil,
        commercialTerms:  quotations.commercialTerms,
        paymentTerms:     quotations.paymentTerms,
        notes:            quotations.notes,
        // Added to the allowlist deliberately. This read is already scoped to
        // the RFQ's requester and refuses everybody else, so the customer
        // evaluating the bid is exactly the audience these files are for. The
        // BYTES stay behind the storage proxy, which re-derives the same rule
        // rather than trusting that this list was reached legitimately.
        attachments:      quotations.attachments,
        status:           quotations.status,
        revisionNumber:   quotations.revisionNumber,
        createdAt:        quotations.createdAt,
        providerName:     users.name,
        providerEmail:    users.email,
        providerVerified: users.verified,
        providerRole:     users.userRole,
        providerLocation: users.location,
      })
      .from(quotations)
      .leftJoin(users, eq(quotations.providerId, users.id))
      .where(and(eq(quotations.rfqId, input.rfqId), isNull(quotations.supersededAt)))
      .orderBy(quotations.price);

    // Phase 4A.6.9: reputation must come from the same dynamic AVG/COUNT
    // definition already approved in reviews.statsForUser (Phase 4A.6.2) -
    // never the stale users.rating/reviewCount columns, which nothing in
    // the codebase writes to and which would always show 0 here regardless
    // of a vendor's real reviews. This keeps the homeowner's quote-comparison
    // view consistent with the same vendor's profile/dashboard reputation.
    const providerIds = Array.from(new Set(rows.map(row => row.providerId).filter((id): id is number => id != null)));
    const reputationByProvider = new Map<number, { averageRating: number | null; reviewCount: number }>();
    if (providerIds.length > 0) {
      const aggregateRows = await db.select({
        revieweeId: reviews.revieweeId,
        avg: sql<string | null>`avg(${reviews.rating})`,
        count: sql<number>`count(*)`,
      }).from(reviews).where(and(inArray(reviews.revieweeId, providerIds), eq(reviews.verified, true))).groupBy(reviews.revieweeId);
      for (const row of aggregateRows) {
        const reviewCount = Number(row.count ?? 0);
        reputationByProvider.set(row.revieweeId, {
          averageRating: reviewCount > 0 && row.avg != null ? Math.round(Number(row.avg) * 10) / 10 : null,
          reviewCount,
        });
      }
    }

    return rows.map(row => {
      const reputation = row.providerId != null ? reputationByProvider.get(row.providerId) : undefined;
      return {
        ...row,
        providerRating: reputation?.averageRating ?? null,
        providerReviews: reputation?.reviewCount ?? 0,
      };
    });
  }),
  // ── RFQ targeting (Phase 4B.3) ──────────────────────────────────────────
  // Which open RFQs this vendor is eligible for, by declared-category match.
  // Listing is free: no credit is consumed here, only by openEnquiry below.
  /**
   * ── INVITE A SUPPLIER TO THIS RFQ ───────────────────────────────────────
   *
   * `protectedProcedure`, not an admin one: the customer who raised the RFQ is
   * the ordinary caller. Authorization is `requireInviteRights`, which is the
   * single place the rule lives - requester, anyone holding `commercial` on
   * the linked project, or Super Admin.
   *
   * THE TARGET IS RE-READ, NEVER TRUSTED. A supplierId from the client is a
   * number, not a permission: the account must exist and must be an approved
   * provider, or an invitation would be created for someone who could never
   * act on it - and the requester would sit waiting for a reply that cannot
   * come.
   */
  inviteSupplier: protectedProcedure
    .input(z.object({
      rfqId: z.number().int().positive(),
      supplierId: z.number().int().positive(),
      deadline: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const rfq = await requireInviteRights(db, input.rfqId, ctx.user);
      if (rfq.status !== 'open') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This request is no longer open, so suppliers cannot be invited to it.',
        });
      }
      if (input.supplierId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot invite yourself to your own request.' });
      }

      const [supplier] = await db
        .select({ id: users.id, name: users.name, userRole: users.userRole, onboardingStatus: users.onboardingStatus })
        .from(users).where(eq(users.id, input.supplierId)).limit(1);
      if (!supplier) throw new TRPCError({ code: 'NOT_FOUND', message: 'Supplier not found' });
      if (!providerRoles.includes(supplier.userRole as typeof providerRoles[number])) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only provider accounts can be invited to a request.' });
      }
      if (supplier.onboardingStatus !== 'approved') {
        // An unapproved provider cannot quote. Inviting them would create an
        // invitation that can never be answered.
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That provider is not yet approved to receive requests.' });
      }

      const result = await inviteSupplier({
        db,
        rfqId: input.rfqId,
        supplierId: input.supplierId,
        invitedBy: ctx.user.id,
        deadline: input.deadline ? new Date(input.deadline) : null,
      });

      // AN ALREADY-INVITED SUPPLIER IS NOT NOTIFIED AGAIN. A second click on
      // the same name must not put a second "you were invited" in their list
      // about one invitation.
      if (result.outcome === 'invited') {
        const [rfqRow] = await db.select({ title: rfqs.title }).from(rfqs).where(eq(rfqs.id, input.rfqId)).limit(1);
        await notifyUser(db, {
          userId: input.supplierId,
          title: 'You were invited to quote',
          body: `You were invited to submit a quotation for "${rfqRow?.title ?? 'a request'}".`,
          type: 'rfq',
          // The RFQ itself, which is where they act - not a list to hunt through.
          link: `/rfq/${input.rfqId}`,
          messageKey: 'notif.rfq.invited',
          messageParams: { rfqTitle: rfqRow?.title ?? '' },
        });
      }
      return result;
    }),

  /**
   * Who has been invited, and where each of them has got to.
   *
   * Only for someone who may invite in the first place: the list of firms a
   * customer approached is commercially sensitive - a rival supplier learning
   * who else was asked, and who declined, is exactly the disclosure the
   * allowlist below and this gate exist to prevent.
   */
  invitations: protectedProcedure
    .input(z.object({ rfqId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await requireInviteRights(db, input.rfqId, ctx.user);
      return listInvitations(db, input.rfqId);
    }),

  /**
   * The supplier declines an invitation.
   *
   * Their own decision about their own invitation, so no separate ownership
   * read: `declineInvitation` filters on (rfqId, supplierId) and returns false
   * when there is nothing of theirs to decline, which is answered as NOT_FOUND
   * so a stranger cannot probe which invitations exist.
   */
  declineInvitation: approvedProviderProcedure
    .input(z.object({ rfqId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const declined = await declineInvitation(db, input.rfqId, ctx.user.id);
      if (!declined) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No open invitation to decline.',
        });
      }
      // The requester is told, because a decline is the answer to a question
      // they asked - silence would leave them waiting on a supplier who has
      // already said no.
      const [rfq] = await db.select({ requesterId: rfqs.requesterId, title: rfqs.title })
        .from(rfqs).where(eq(rfqs.id, input.rfqId)).limit(1);
      if (rfq) {
        await notifyUser(db, {
          userId: rfq.requesterId,
          title: 'A supplier declined your invitation',
          body: `${ctx.user.name} declined to quote for "${rfq.title}".`,
          type: 'rfq',
          link: `/rfq/${input.rfqId}`,
          messageKey: 'notif.rfq.invitationDeclined',
          messageParams: { supplier: ctx.user.name ?? '', rfqTitle: rfq.title },
        });
      }
      return { success: true as const };
    }),

  eligible: approvedProviderProcedure.query(async ({ ctx }) => {
    const [items, usage] = await Promise.all([
      listEligibleRfqs(ctx.user.id),
      getEnquiryUsage(ctx.user.id),
    ]);
    return { items, usage };
  }),

  // Open an eligible RFQ's full detail, consuming one qualified-enquiry credit
  // the first time. Every decision - identity, declared categories, RFQ
  // eligibility, billing entitlement - is re-derived server-side; the only
  // caller input is which RFQ to open, so an RFQ id, category, or plan cannot
  // be manipulated into access.
  openEnquiry: approvedProviderProcedure
    .input(z.object({ rfqId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const result = await openQualifiedEnquiry(ctx.user.id, input.rfqId);
      switch (result.outcome) {
        case 'not_found':
          throw new TRPCError({ code: 'NOT_FOUND', message: 'RFQ not found' });
        case 'not_eligible':
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: result.reason === 'unclassified_rfq'
              ? 'This request has no recognised service category, so it is not offered as a qualified enquiry.'
              : 'This request does not match any of your declared service categories.',
          });
        case 'limit_reached':
          throw new TRPCError({
            code: 'FORBIDDEN',
            // Enough for the UI to explain the limit; no other vendor's data.
            message: `You have used all ${result.usage.allowance} qualified enquiries for this month. Your allowance resets on ${result.usage.resetsAt.toISOString().slice(0, 10)}.`,
          });
        case 'granted':
          // The paid lead. `alreadyConsumed` distinguishes a re-open (free)
          // from a fresh charge, and the trail records which - otherwise a
          // billing dispute has no way to tell them apart.
          //
          // subjectId IS THE qualifiedEnquiries ROW, not the RFQ. The rule this
          // trail keeps is that subjectId always names a row in the table
          // subjectType names - otherwise `subjectType='enquiry' AND
          // subjectId=5` would sometimes mean an enquiry and sometimes an RFQ,
          // and nothing about the result would look wrong. The RFQ is context,
          // so it goes in `detail`.
          //
          // A null enquiryId does not suppress the event: the credit was still
          // spent, and a row saying so with the id missing is far better than
          // no record of a charge.
          await recordCommercialEvent(await getDb(), {
            actorId: ctx.user.id,
            ownerId: result.rfq?.requesterId ?? null,
            subjectType: 'enquiry',
            subjectId: result.enquiryId ?? 0,
            action: 'enquiry_opened',
            // THREE DISTINCT FACTS, and the trail must not collapse them.
            // Before invitations there were two - a fresh charge and a re-open
            // - and an invited open would have been recorded as "credit
            // charged", which is simply false: no credit was spent and no
            // qualifiedEnquiries row exists to point at. An audit line that
            // asserts a charge that did not happen is worse than a terse one.
            detail: `rfq ${input.rfqId}, ${
              result.byInvitation ? 'opened by invitation, exempt from the allowance'
                : result.alreadyConsumed ? 'reopened, no credit charged'
                  : 'credit charged'}`,
          });
          return {
            rfq: result.rfq,
            alreadyConsumed: result.alreadyConsumed,
            usage: result.usage,
            // Passed through so the supplier's screen can say the open was
            // free. Without it the UI shows a usage figure beside an action
            // that did not change it, which reads as a charge they cannot find.
            byInvitation: result.byInvitation === true,
          };
      }
    }),
  /**
   * A SUPPLIER'S SUPPORTING FILES FOR A QUOTATION.
   *
   * Until this existed a supplier could send a price, a timeline, a warranty
   * string and free-text notes - and nothing else. No proposal, no technical
   * specification, no certificate, no product photograph. Real construction
   * bidding is not conducted that way, and a customer comparing two numbers
   * with no supporting documents is not really comparing anything.
   *
   * approvedProviderProcedure, the same gate submitQuotation sits behind: a
   * vendor who may not quote may not stage files for a quotation either.
   *
   * The written key is `quotation-attachments/user-<id>/...`, its own prefix
   * so the storage proxy can authorise it as its own category. It is NOT
   * shared with `rfq-attachments/`, whose rule is "the requester, plus a
   * provider who has PAID for the enquiry" - the opposite direction of travel
   * and the opposite audience.
   */
  uploadQuotationAttachment: approvedProviderProcedure
    .input(z.object({
      fileName: z.string().min(1).max(255),
      contentType: z.string().refine(
        isAllowedRfqAttachmentType,
        { message: 'Only images and PDF documents are allowed' },
      ),
      base64: z.string().max(11_000_000, 'File too large (max ~8MB)'),
    }))
    .mutation(async ({ ctx, input }) => {
      enforceUploadRateLimit(ctx.user.id);
      const buffer = Buffer.from(input.base64, 'base64');
      if (buffer.length > MAX_RFQ_ATTACHMENT_SIZE) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File too large (max 8MB)' });
      }
      assertUploadedFileMatches(input.contentType, buffer, DOCUMENT_TYPES);
      const safeName = input.fileName.replace(/[^\w.-]+/g, '_');
      const { key, url } = await storagePutOrUnavailable(
        `quotation-attachments/user-${ctx.user.id}/${safeName}`,
        buffer,
        input.contentType,
      );
      return { key, url, name: input.fileName, type: input.contentType, size: buffer.length };
    }),
  /**
   * ONE quotation, by id, for its detail page.
   *
   * Until this existed a quotation had no page. It was a row inside RFQDetail
   * for the customer and a tile in the supplier's workspace, and neither could
   * be linked to, bookmarked, or opened from the notification announcing it.
   * "Supplier X responded to your RFQ" led to a list and left the reader to
   * find the bid themselves.
   *
   * TWO READERS, DIFFERENT COLUMNS. This is the whole reason the procedure is
   * written out rather than reusing the list's select:
   *
   *   - the RFQ's requester is evaluating a bid addressed to them, so they see
   *     the commercial terms and the supplier's contact details - the same
   *     fields marketplace.quotations already hands them.
   *   - the supplier who WROTE it sees their own bid in full, but nothing about
   *     the requester beyond the RFQ they answered. They are not the customer.
   *
   * Everybody else is refused, and that includes a RIVAL SUPPLIER WHO BID ON
   * THE SAME RFQ. They hold a legitimate quotation id from their own bid, the
   * ids are sequential, and the competitor's price sits one integer away. That
   * is the attack this ownership predicate exists to stop.
   *
   * NOT FOUND, not FORBIDDEN, for a quotation the caller may not read: telling
   * a rival "that exists but is not yours" confirms a bid was placed and by
   * how many, which is itself the competitive intelligence being protected.
   */
  quotation: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quotation not found' });

    const [row] = await db
      .select({
        id:           quotations.id,
        rfqId:        quotations.rfqId,
        providerId:   quotations.providerId,
        price:        quotations.price,
        currency:     quotations.currency,
        timeline:     quotations.timeline,
        warranty:     quotations.warranty,
        validUntil:   quotations.validUntil,
        commercialTerms: quotations.commercialTerms,
        paymentTerms: quotations.paymentTerms,
        notes:        quotations.notes,
        attachments:  quotations.attachments,
        status:       quotations.status,
        revisionNumber: quotations.revisionNumber,
        supersededAt: quotations.supersededAt,
        createdAt:    quotations.createdAt,
        rfqTitle:       rfqs.title,
        rfqStatus:      rfqs.status,
        rfqCategory:    rfqs.category,
        rfqRequesterId: rfqs.requesterId,
      })
      .from(quotations)
      .leftJoin(rfqs, eq(quotations.rfqId, rfqs.id))
      .where(eq(quotations.id, input.id));

    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quotation not found' });

    const isRequester = row.rfqRequesterId === ctx.user.id;
    const isAuthor = row.providerId === ctx.user.id;
    if (!isRequester && !isAuthor) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Quotation not found' });
    }

    // The supplier's identity is shown to the customer evaluating their bid,
    // and to the supplier themselves - who already knows who they are, but the
    // page renders one shape for both readers. Contact details are the
    // requester's alone; a supplier reading their own quotation gets no route
    // to the customer's inbox out of this procedure.
    const [provider] = await db
      .select({ id: users.id, name: users.name, verified: users.verified, location: users.location, email: users.email })
      .from(users)
      .where(eq(users.id, row.providerId));

    const { rfqRequesterId: _requesterId, ...quotation } = row;

    return {
      ...quotation,
      viewerRole: isRequester ? ('requester' as const) : ('author' as const),
      provider: provider
        ? {
            id: provider.id,
            name: provider.name,
            verified: provider.verified,
            location: provider.location,
            email: isRequester ? provider.email : null,
          }
        : null,
    };
  }),
  submitQuotation: approvedProviderProcedure
    // BOUNDS MATCH THE COLUMNS. `price` is decimal(12,2), `warranty` is
    // varchar(100), `timeline` is an int. None of these were bounded, so a
    // negative price was accepted as a bid, and an over-long warranty string
    // reached MySQL as an error or a silent truncation depending on sql_mode.
    // This is input validation, not policy - the shape of the column is not a
    // business rule somebody has to decide.
    .input(z.object({
      rfqId: z.number().int().positive(),
      price: z.number().positive().max(9_999_999_999.99),
      currency: z.literal(BILLING_CURRENCY).default(BILLING_CURRENCY),
      timeline: z.number().int().positive().max(3650).optional(),
      warranty: z.string().max(100).optional(),
      validUntil: z.date().refine(
        value => value.getTime() >= new Date().setHours(0, 0, 0, 0),
        { message: 'Quotation validity cannot be in the past' },
      ),
      commercialTerms: z.string().max(4000).optional(),
      paymentTerms: z.string().max(2000).optional(),
      notes: z.string().max(4000).optional(),
      /**
       * Bounded at 6 like the RFQ side. Each entry must have been produced by
       * uploadQuotationAttachment - the key prefix is re-checked below rather
       * than trusted, because this array arrives from the client.
       */
      attachments: z.array(z.object({
        key: z.string().min(1).max(1024),
        url: z.string().min(1).max(2048),
        name: z.string().min(1).max(255),
        type: z.string().max(128),
        size: z.number().int().nonnegative(),
      })).max(6).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      // THE RFQ IS READ FIRST, AND ITS STATE IS CHECKED.
      //
      // This used to insert immediately and look the RFQ up afterwards, only to
      // address the notification. Two consequences. A quotation against an id
      // that does not exist hit the RESTRICT foreign key and surfaced as a 500
      // rather than a 404. And a quotation could be submitted against a CLOSED
      // or AWARDED RFQ - the requester had already accepted somebody, and new
      // bids still landed in their inbox.
      //
      // The client filters the pipeline to `status === 'open'`, which is why
      // nobody hit this through the UI. Frontend filtering is not a control;
      // the status enum and acceptQuotation's transition to 'awarded' are the
      // existing rule, and this enforces it where it is enforceable.
      const [rfq] = await db.select({ requesterId: rfqs.requesterId, title: rfqs.title, status: rfqs.status })
        .from(rfqs).where(eq(rfqs.id, input.rfqId));
      if (!rfq) throw new TRPCError({ code: 'NOT_FOUND', message: 'RFQ not found' });
      if (rfq.status !== 'open') {
        throw new TRPCError({ code: 'CONFLICT', message: 'This request is no longer accepting quotations' });
      }
      if (rfq.requesterId === ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot submit a quotation to your own request' });
      }
      const responseAccess = await getRfqResponseAccess(db, ctx.user.id, input.rfqId);
      if (!responseAccess.canRespond) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Open this qualified enquiry, or accept its invitation, before submitting a quotation.',
        });
      }
      // KNOWN GAP, deliberately not decided here: nothing stops the same
      // provider submitting several quotations on one RFQ, and each one
      // notifies the requester again. Whether a second submission should be
      // refused, or should REPLACE the first as a revision, is a product
      // decision about how bidding works on BuildHub - not something to infer
      // from the schema. Recorded in the Phase 1B handoff for the owner.
      // EVERY KEY MUST BE THIS SUPPLIER'S OWN.
      //
      // The array is client-supplied. Without this check a supplier could name
      // `quotation-attachments/user-<someone else>/...` - or an
      // `rfq-attachments/` key belonging to the customer - and attach another
      // party's file to their own quotation. The storage proxy would then be
      // asked to authorise it against THIS quotation and could reasonably say
      // yes, which is how a file crosses an ownership boundary by being
      // referenced rather than by being read.
      //
      // The traversal check is separate from the prefix check on purpose:
      // `quotation-attachments/user-1/../user-2/secret.pdf` starts with the
      // right prefix and is not the right file.
      const prefix = `quotation-attachments/user-${ctx.user.id}/`;
      for (const attachment of input.attachments ?? []) {
        const remainder = attachment.key.startsWith(prefix)
          ? attachment.key.slice(prefix.length)
          : null;
        const traverses = remainder === null || remainder.length === 0
          || remainder.split('/').some(part => part.length === 0 || part === '.' || part === '..');
        if (traverses) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'An attachment on this quotation is not one you uploaded.',
          });
        }
      }

      const { attachments, ...quotationFields } = input;

      /**
       * ACCIDENTAL DOUBLE-SUBMIT, and only that.
       *
       * Two concurrent submitQuotation calls with the same payload produced TWO
       * bids on one request and notified the customer TWICE. Observed by firing
       * them in parallel against the running server.
       *
       * WHAT THIS DELIBERATELY DOES NOT DECIDE. Whether a supplier may hold
       * several quotations on one RFQ - and whether a second should replace the
       * first as a revision - is the OWNER DECISION recorded above and in the
       * Phase 1B handoff, and it is untouched here. A bid with a DIFFERENT price
       * or timeline still goes through exactly as before.
       *
       * What is caught is the same provider sending the same RFQ the same price
       * and the same timeline within seconds. That is not a revision under any
       * answer to the open question - nobody revises a bid to the number it
       * already was - so refusing it costs the undecided policy nothing.
       *
       * Idempotent, not an error: the second click returns the bid the first one
       * made, so the supplier sees the submission they believe they made.
       */
      const submission = await db.transaction(async (tx) => {
        // The provider's own users row, locked first - the same lock on the
        // same table in the same order as rfq.create, so the two can never
        // deadlock against each other. An unlocked pre-check loses this race:
        // measured at two rows, three runs out of three.
        await tx.select({ id: users.id }).from(users).where(eq(users.id, ctx.user.id)).for('update');

        const [recentIdentical] = await tx
          .select({ id: quotations.id })
          .from(quotations)
          .where(and(
            eq(quotations.rfqId, input.rfqId),
            eq(quotations.providerId, ctx.user.id),
            eq(quotations.price, String(input.price)),
            gte(quotations.createdAt, new Date(Date.now() - DUPLICATE_SUBMIT_WINDOW_MS)),
          ))
          .orderBy(desc(quotations.id))
          .limit(1);
        if (recentIdentical) return { id: recentIdentical.id, deduplicated: true };

        // ONE CURRENT QUOTATION PER SUPPLIER PER RFQ, WITH REVISION HISTORY.
        // A later bid supersedes the previous version rather than accumulating
        // unrelated quotations from the same supplier; the older version stays
        // as immutable history.
        const [current] = await tx
          .select({ id: quotations.id, revisionNumber: quotations.revisionNumber })
          .from(quotations)
          .where(and(
            eq(quotations.rfqId, input.rfqId),
            eq(quotations.providerId, ctx.user.id),
            isNull(quotations.supersededAt),
          ))
          .orderBy(desc(quotations.revisionNumber))
          .limit(1);

        if (current) {
          await tx.update(quotations).set({ supersededAt: new Date() })
            .where(eq(quotations.id, current.id));
        }

        const inserted = await tx.insert(quotations).values({
          ...quotationFields,
          providerId: ctx.user.id,
          price: String(input.price),
          revisionNumber: current ? current.revisionNumber + 1 : 1,
          attachments: attachments && attachments.length > 0 ? JSON.stringify(attachments) : null,
        });
        // The QUOTATION's own id, because that is what the audit trail records.
        // See the note beside recordCommercialEvent below.
        return { id: Number(inserted?.[0]?.insertId ?? 0), deduplicated: false };
      });

      // A de-duplicated submission is not a new bid: the customer must not be
      // notified again, the funnel must not count it twice, and the audit trail
      // must not record a second submission of the same offer.
      if (submission.deduplicated) return { success: true as const, quotationId: submission.id };
      const quotationId = submission.id;
      // If this supplier was INVITED, the invitation has now been answered.
      // Best-effort and after the bid is stored: a bookkeeping write must never
      // be able to fail the commercial act it describes. A no-op when there was
      // no invitation, which is the ordinary open-board case.
      await markInvitationResponded(db, input.rfqId, ctx.user.id).catch(() => {});
      await notifyUser(db, { userId: rfq.requesterId, title: 'New quotation received', body: `You received a new quotation for "${rfq.title}"`, type: 'quotation', link: `/quotations/${quotationId}`, messageKey: 'notif.quotation.received', messageParams: { rfqTitle: rfq.title } });
      // Funnel milestone: a vendor responding is the point at which the
      // marketplace has produced value for both sides.
      recordEventAsync({
        type: ANALYTICS_EVENTS.QUOTATION_SUBMITTED,
        userId: ctx.user.id,
        subjectType: 'rfq',
        subjectId: input.rfqId,
      });
      // Commercial trail. AFTER the insert succeeded - an audit row for a
      // quotation that was never stored would be worse than no row at all.
      //
      // subjectId IS THE QUOTATION, NOT THE RFQ. This recorded the rfqId at
      // first, which made `subjectType: 'quotation'` mean the quotation id in
      // `quotation_accepted` and the RFQ id here - two id spaces under one
      // label, so `WHERE subjectType='quotation' AND subjectId=5` would return
      // unrelated rows and nothing would look wrong. The RFQ belongs in
      // `detail`, which is where context goes.
      await recordCommercialEvent(db, {
        actorId: ctx.user.id,
        ownerId: rfq.requesterId,
        subjectType: 'quotation',
        subjectId: quotationId,
        action: 'quotation_submitted',
        detail: `rfq ${input.rfqId}, price ${input.price}`
          + `${input.timeline ? `, ${input.timeline} days` : ''}`
          + `${attachments?.length ? `, ${attachments.length} attachment(s)` : ''}`,
      });
      /**
       * FIRST_VALID_QUOTATION_RESPONSE - counted the same way as the RFQ event.
       *
       * A REVISION is not a new response: `revisionNumber` increments on the
       * same RFQ, and counting rows would make a supplier who revised twice
       * look like a supplier who answered three RFQs. Counted DISTINCT by RFQ.
       */
      const [quoteCount] = await db.select({ count: sql<number>`count(distinct ${quotations.rfqId})` })
        .from(quotations).where(eq(quotations.providerId, ctx.user.id));
      if (Number(quoteCount?.count ?? 0) === 1) {
        await qualifyReferralEvent(db, ctx.user.id, 'FIRST_VALID_QUOTATION_RESPONSE', `firstquote:${ctx.user.id}`, new Date());
      }

      await recordFieldChanges(db, {
        subjectType: 'quotation', subjectId: quotationId,
        ownerId: ctx.user.id, actorId: ctx.user.id,
        reason: 'quotation submitted',
      }, [
        { field: 'price', oldValue: null, newValue: input.price },
        { field: 'currency', oldValue: null, newValue: input.currency },
        { field: 'timeline', oldValue: null, newValue: input.timeline },
        { field: 'warranty', oldValue: null, newValue: input.warranty },
        { field: 'validUntil', oldValue: null, newValue: input.validUntil },
        { field: 'commercialTerms', oldValue: null, newValue: input.commercialTerms },
        { field: 'paymentTerms', oldValue: null, newValue: input.paymentTerms },
        { field: 'attachments', oldValue: null, newValue: attachments?.length ? `${attachments.length} file(s)` : null },
        { field: 'status', oldValue: null, newValue: 'pending' },
      ]);
      return { success: true, quotationId };
    }),
  /**
   * Withdraw a request. See closeRfqSecure for why this exists and what it
   * deliberately does not do to the outstanding bids.
   */
  close: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => closeRfqSecure(input.id, ctx.user.id)),
  acceptQuotation: protectedProcedure
    .input(z.object({ quotationId: z.number(), rfqId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const accepted = await acceptQuotationSecure(input.rfqId, input.quotationId, ctx.user.id);
      recordEventAsync({
        type: ANALYTICS_EVENTS.QUOTATION_ACCEPTED,
        userId: ctx.user.id,
        subjectType: 'quotation',
        subjectId: input.quotationId,
      });
      // The award. If any single event in this product deserves a permanent
      // record, it is the one where a customer commits to a supplier.
      await recordCommercialEvent(await getDb(), {
        actorId: ctx.user.id,
        ownerId: ctx.user.id,
        subjectType: 'quotation',
        subjectId: input.quotationId,
        action: 'quotation_accepted',
        detail: `rfq ${input.rfqId}`,
      });
      return accepted;
    }),
  rejectQuotation: protectedProcedure
    .input(z.object({ quotationId: z.number(), rfqId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const rejected = await rejectQuotationSecure(input.rfqId, input.quotationId, ctx.user.id);
      await recordCommercialEvent(await getDb(), {
        actorId: ctx.user.id,
        ownerId: ctx.user.id,
        subjectType: 'quotation',
        subjectId: input.quotationId,
        action: 'quotation_rejected',
        detail: `rfq ${input.rfqId}`,
      });
      return rejected;
    }),
});

// ── Messages Router ─────────────────────────────────────────────────────────
const messagesRouter = router({
  conversations: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await db.select({ senderId: messages.senderId, receiverId: messages.receiverId, content: messages.content, createdAt: messages.createdAt, read: messages.read }).from(messages).where(sql`${messages.senderId} = ${ctx.user.id} OR ${messages.receiverId} = ${ctx.user.id}`).orderBy(desc(messages.createdAt));
    const otherIds = Array.from(new Set(rows.map(row => row.senderId === ctx.user.id ? row.receiverId : row.senderId)));
    if (!otherIds.length) return [];
    const people = await db.select({ id: users.id, name: users.name, userRole: users.userRole }).from(users).where(inArray(users.id, otherIds));
    return people.map(person => {
      const latest = rows.find(row => row.senderId === person.id || row.receiverId === person.id);
      const name = person.name || 'BuildHub user';
      // `unread` was hard-coded to 0 and `online` to false, while the UI
      // rendered a live-presence dot and an unread badge from them. A counter
      // that is always zero is not a conservative default, it is a broken
      // counter that hides real messages; and BuildHub has no presence system
      // at all, so `online` could only ever have been decoration. The count is
      // now computed from the rows already loaded, and `online` is gone rather
      // than shipped as a permanently-false field the UI can misread.
      const unread = rows.filter(row =>
        row.senderId === person.id && row.receiverId === ctx.user.id && !row.read).length;
      return { id: person.id, name, initials: name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase(), lastMessage: latest?.content ?? '', time: latest?.createdAt ? new Date(latest.createdAt).toLocaleDateString() : '', unread, role: person.userRole || 'Member' };
    });
  }),
  /**
   * WHO AM I ABOUT TO WRITE TO.
   *
   * `conversations` lists only people you have ALREADY exchanged messages
   * with, so there was no way to open a thread with a vendor you just found:
   * the messages page could select nothing, and the empty state's own advice -
   * "conversations start when you contact a vendor from the marketplace" -
   * described a route that did not exist.
   *
   * This resolves the display identity of one messageable account, for
   * /messages?to=<id>. It reveals nothing new: messages.send already accepts
   * any active account id and already answers NOT_FOUND identically for "no
   * such user" and "not active", so this is the same oracle with the same
   * answer, not a wider one. Name and role are exactly the two fields
   * `conversations` would return the moment the first message is sent.
   */
  recipient: protectedProcedure.input(z.object({ userId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    if (input.userId === ctx.user.id) throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot send a message to yourself.' });
    const [person] = await db
      .select({ id: users.id, name: users.name, userRole: users.userRole, accountStatus: users.accountStatus })
      .from(users).where(eq(users.id, input.userId));
    if (!person || person.accountStatus !== 'active') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'That recipient is not available.' });
    }
    const name = person.name || 'BuildHub user';
    return {
      id: person.id,
      name,
      initials: name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase(),
      role: person.userRole || 'Member',
    };
  }),
  list: protectedProcedure.input(z.object({ otherUserId: z.number().optional() })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    const filter = input.otherUserId
      ? and(sql`(${messages.senderId} = ${ctx.user.id} AND ${messages.receiverId} = ${input.otherUserId}) OR (${messages.senderId} = ${input.otherUserId} AND ${messages.receiverId} = ${ctx.user.id})`)
      : sql`${messages.senderId} = ${ctx.user.id} OR ${messages.receiverId} = ${ctx.user.id}`;
    return db.select().from(messages).where(filter).orderBy(messages.createdAt);
  }),
  // `fileUrl` WAS `z.string().url()`, and two things followed from that.
  //
  // IT BROKE THE FEATURE. storagePut returns a RELATIVE proxy path,
  // `/manus-storage/<key>`, and the client sends exactly that back here. A
  // relative path is not a valid URL, so zod refused every real attachment:
  // the upload succeeded and the send that followed it failed. Attaching a
  // file to a message has never worked.
  //
  // AND IT WAS FREE-FORM CLIENT INPUT pointing at a storage key. The proxy
  // authorizes a message attachment by finding the message row whose fileUrl
  // equals the requested path and checking the caller is a party to it - so a
  // message that referenced SOMEONE ELSE'S key would have handed the sender
  // that file. It was not exploitable only because the absolute URL zod
  // demanded could never equal the relative path the proxy compares against;
  // fixing the first problem without this would have created the second.
  //
  // So the path is now checked to be a message attachment THIS SENDER
  // uploaded. The `user-<id>` segment is not trusted as authorization
  // elsewhere - the proxy resolves keys through rows - but here it is the
  // sender's own id from the session being required to match, which is a
  // different thing: it stops a sender naming a key that is not theirs.
  send: protectedProcedure.input(z.object({ receiverId: z.number().int().positive(), projectId: z.number().int().positive().optional(), content: z.string().min(1).max(4000), type: z.enum(['text', 'file', 'quotation']).default('text'), fileUrl: z.string().max(512).regex(/^\/manus-storage\/message-attachments\/user-\d+\//, 'Attachment must be a BuildHub message upload').optional(), quotationId: z.number().int().positive().optional() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    if (input.fileUrl && !input.fileUrl.startsWith(`/manus-storage/message-attachments/user-${ctx.user.id}/`)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You may only attach a file you uploaded' });
    }
    if (input.type === 'quotation') {
      if (!input.quotationId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Quotation reference is required' });
      // Slice 9: the sender must be a PARTY to the quotation, not merely someone
      // who guessed a number that exists. This previously checked existence
      // only, which made the endpoint an oracle - type ids into the "Quote ID"
      // box and NOT_FOUND versus success tells you exactly which quotations
      // exist and how many bids the marketplace carries.
      //
      // A party is the provider who submitted it, or the homeowner who owns the
      // RFQ it answers. Those are the only two people with any reason to share
      // one, and both already see it elsewhere in the product.
      const [quotation] = await db
        .select({ providerId: quotations.providerId, requesterId: rfqs.requesterId })
        .from(quotations)
        .innerJoin(rfqs, eq(quotations.rfqId, rfqs.id))
        .where(eq(quotations.id, input.quotationId));
      // Not-a-party and does-not-exist give the SAME answer, so the oracle is
      // not simply moved one step along.
      if (!quotation || (quotation.providerId !== ctx.user.id && quotation.requesterId !== ctx.user.id)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Quotation not found' });
      }
    }
    // THE RECEIVER MUST BE A REAL, ACTIVE ACCOUNT, AND NOT THE SENDER.
    //
    // This endpoint accepted any positive integer as `receiverId`. The FK on
    // messages.receiverId meant a NON-existent id failed - loudly, as an
    // INTERNAL_SERVER_ERROR - but an id that happened to exist succeeded, and
    // the message was delivered to that account. Combined with the mock
    // conversation list the Messages page used to render for new users (ids
    // 1-4, removed in the same change), a person could type into a thread
    // labelled "Ahmed Hassan (Contractor)" and have it delivered to whichever
    // real account holds user id 1.
    //
    // Existence and active status are INTEGRITY, not policy - a message to a
    // deleted or suspended account has nowhere to go. Whether BuildHub should
    // additionally require a prior relationship (a shared RFQ, a quotation, a
    // directory enquiry) before one user may message another is a product
    // decision and is NOT decided here: the marketplace deliberately lets a
    // customer contact a vendor they just found. It is recorded as an owner
    // decision in the audit report.
    const [receiver] = await db
      .select({ id: users.id, accountStatus: users.accountStatus })
      .from(users)
      .where(eq(users.id, input.receiverId));
    if (!receiver || receiver.accountStatus !== 'active') {
      // Same answer for "no such user" and "not active", so the endpoint does
      // not become a directory of which account ids exist.
      throw new TRPCError({ code: 'NOT_FOUND', message: 'That recipient is not available.' });
    }
    if (input.receiverId === ctx.user.id) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot send a message to yourself.' });
    }

    const result = await db.insert(messages).values({ ...input, senderId: ctx.user.id });
    // THE RECIPIENT IS TOLD.
    //
    // Nothing notified anyone about a message, so the in-platform thread - the
    // ONE contact channel BuildHub operates between a customer and a vendor -
    // was silent until the other person happened to open /messages. That made
    // "Contact this vendor" a message into a void.
    //
    // The link opens the conversation with the SENDER, which is the thread the
    // notification is about. Best-effort by design: notifyUser never throws, so
    // a notification problem cannot fail a message that was already stored.
    await notifyUser(db, {
      userId: input.receiverId,
      title: 'New message',
      body: `${ctx.user.name || 'A BuildHub user'} sent you a message`,
      type: 'message',
      link: `/messages?to=${ctx.user.id}`,
      messageKey: 'notif.message.received',
      messageParams: { senderName: ctx.user.name || 'A BuildHub user' },
    });
    return { id: Number(result[0].insertId), ...input, senderId: ctx.user.id };
  }),
  uploadAttachment: protectedProcedure.input(z.object({ fileName: z.string().min(1).max(255), contentType: z.string().startsWith('image/').or(z.literal('application/pdf')), base64: z.string().max(11_000_000) })).mutation(async ({ ctx, input }) => {
    enforceUploadRateLimit(ctx.user.id);
    const buffer = Buffer.from(input.base64, 'base64');
    if (buffer.length > 8 * 1024 * 1024) throw new TRPCError({ code: 'BAD_REQUEST', message: 'File too large (max 8MB)' });
    assertUploadedFileMatches(input.contentType, buffer, DOCUMENT_TYPES);
    // The character class here read [^\\w.-] - a DOUBLE backslash inside a regex
    // literal, so the negated set was {backslash, w, dot, hyphen} rather than
    // {word characters, dot, hyphen}. Every ordinary letter was therefore
    // replaced: "site-plan.pdf" became "_-_._". The other three upload
    // endpoints already had this right.
    const safeName = input.fileName.replace(/[^\w.-]+/g, '_');
    const { key, url } = await storagePutOrUnavailable(`message-attachments/user-${ctx.user.id}/${Date.now()}-${safeName}`, buffer, input.contentType);
    return { key, url, name: input.fileName, size: buffer.length, type: input.contentType };
  }),
});

// ── Notifications Router ───────────────────────────────────────────────────
const notificationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db.select().from(notifications).where(eq(notifications.userId, ctx.user.id)).orderBy(desc(notifications.createdAt)).limit(50);
  }),
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    // "0 unread" hides real notifications behind a number the user trusts.
    const db = await requireDb();
    const result = await db.select({ count: sql<number>`count(*)` }).from(notifications).where(and(eq(notifications.userId, ctx.user.id), eq(notifications.read, false)));
    return { count: Number(result[0]?.count ?? 0) };
  }),
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    await db.update(notifications).set({ read: true }).where(eq(notifications.userId, ctx.user.id));
    return { success: true };
  }),
});

// ── Reviews Router ─────────────────────────────────────────────────────────
const reviewsRouter = router({
  forUser: publicProcedure.input(z.object({ userId: z.number() })).query(async ({ input }) => {
    const db = await requireDb();
    return db.select().from(reviews).where(and(eq(reviews.revieweeId, input.userId), eq(reviews.verified, true))).orderBy(desc(reviews.createdAt));
  }),
  // Dynamic/computed rating (Phase 4A.4 decision): always derived live from the
  // reviews table, never a stored aggregate - so it can never drift out of sync
  // the way users.rating/reviewCount already have. Same access level and same
  // `verified: true` filter as `forUser` above, since this is an aggregate over
  // exactly the same public-by-design data, not a new/competing calculation.
  statsForUser: publicProcedure.input(z.object({ userId: z.number().int().positive() })).query(async ({ input }) => {
    // "No reviews" about a vendor who has them is a reputational statement,
    // not a degraded read.
    const db = await requireDb();
    const [row] = await db.select({
      avg: sql<string | null>`avg(${reviews.rating})`,
      count: sql<number>`count(*)`,
    }).from(reviews).where(and(eq(reviews.revieweeId, input.userId), eq(reviews.verified, true)));
    const reviewCount = Number(row?.count ?? 0);
    const averageRating = reviewCount > 0 && row?.avg != null ? Math.round(Number(row.avg) * 10) / 10 : null;
    return { averageRating, reviewCount };
  }),
  // Lists who the caller can currently leave a review for on this project, and
  // whether they already have. Reuses the exact same "verified participant"
  // definition as `submit` below (accepted-quotation providers on RFQs linked
  // to this project) rather than a second, competing eligibility rule - only
  // covers the RFQ-linked case, not `submit`'s older-project role-based
  // fallback, since that fallback has no well-defined, enumerable participant
  // list to safely offer as UI choices.
  eligibleReviewees: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
    const db = await requireDb();
    const [project] = await db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.status, 'completed')));
    if (!project || project.ownerId !== ctx.user.id) return [];
    const awardedProviders = await db.select({ providerId: quotations.providerId, name: users.name })
      .from(quotations)
      .innerJoin(rfqs, eq(quotations.rfqId, rfqs.id))
      .innerJoin(users, eq(quotations.providerId, users.id))
      .where(and(eq(rfqs.projectId, input.projectId), eq(quotations.status, 'accepted')));
    const existingReviews = await db.select({ revieweeId: reviews.revieweeId }).from(reviews).where(and(eq(reviews.projectId, input.projectId), eq(reviews.reviewerId, ctx.user.id)));
    const reviewedIds = new Set(existingReviews.map(r => r.revieweeId));
    const seen = new Set<number>();
    const result: { providerId: number; name: string | null; alreadyReviewed: boolean }[] = [];
    for (const p of awardedProviders) {
      if (seen.has(p.providerId)) continue;
      seen.add(p.providerId);
      result.push({ providerId: p.providerId, name: p.name, alreadyReviewed: reviewedIds.has(p.providerId) });
    }
    return result;
  }),
  submit: protectedProcedure
    .input(z.object({ projectId: z.number(), revieweeId: z.number(), rating: z.number().min(1).max(5), comment: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      // Only allow verified post-project reviews, and only from the homeowner who owns the project.
      const [project] = await db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.status, 'completed')));
      if (!project || project.ownerId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Reviews only allowed for completed projects you own' });
      if (input.revieweeId === ctx.user.id) throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot review yourself' });

      // Verified participation: the project may have one or more RFQs linked to it
      // (rfqs.projectId, set at RFQ-creation time) with an accepted quotation - the provider
      // of that quotation genuinely won/fulfilled work on this project. When at least one such
      // link exists, the reviewee MUST be one of those verified providers. Older/unlinked
      // projects (created before this link existed, or never linked to an RFQ) have no such
      // relationship to check - for those we fall back to the same provider-role heuristic
      // used since Phase 2, rather than blocking every historical review outright.
      const awardedProviders = await db.select({ providerId: quotations.providerId })
        .from(quotations)
        .innerJoin(rfqs, eq(quotations.rfqId, rfqs.id))
        .where(and(eq(rfqs.projectId, input.projectId), eq(quotations.status, 'accepted')));

      if (awardedProviders.length > 0) {
        if (!awardedProviders.some(p => p.providerId === input.revieweeId)) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'This provider did not win an awarded RFQ on this project' });
        }
      } else {
        const [reviewee] = await db.select({ id: users.id, userRole: users.userRole }).from(users).where(eq(users.id, input.revieweeId));
        if (!reviewee || !providerRoles.includes(reviewee.userRole as typeof providerRoles[number])) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reviewee must be a service provider' });
        }
      }
      const [existing] = await db.select({ id: reviews.id }).from(reviews).where(
        and(eq(reviews.projectId, input.projectId), eq(reviews.reviewerId, ctx.user.id), eq(reviews.revieweeId, input.revieweeId))
      );
      if (existing) throw new TRPCError({ code: 'CONFLICT', message: 'You have already reviewed this provider for this project' });
      await db.insert(reviews).values({ ...input, reviewerId: ctx.user.id, verified: true });
      // `/provider` renders no reviews at all - it was a dead end for the one
      // notification whose whole point is "come and read this". The page that
      // actually shows a provider's reviews is their own vendor profile, via
      // <VendorReputation userId=... />, keyed by user id.
      await notifyUser(db, { userId: input.revieweeId, title: 'New review received', body: `You received a new ${input.rating}-star review.`, type: 'review', link: `/vendor/${input.revieweeId}`, messageKey: 'notif.review.received', messageParams: { rating: input.rating } });
      return { success: true };
    }),
});

// ── Vendor Profile Router ─────────────────────────────────────────────────
// SECURITY: `users` also holds passwordHash, invitationToken, email, phone,
// frozenReason, and other private account fields. The public/self profile
// selects below MUST always use an explicit column allowlist - never
// `select().from(users)` - so a future edit to this file cannot silently
// start leaking a private column through these endpoints.
const PUBLIC_PROFILE_COLUMNS = {
  id: users.id,
  name: users.name,
  bio: users.bio,
  avatar: users.avatar,
  location: users.location,
  userRole: users.userRole,
  verified: users.verified,
  createdAt: users.createdAt,
} as const;
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
function isAllowedAvatarType(contentType: string): boolean {
  return contentType.startsWith('image/');
}
async function completedProjectCount(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number) {
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(quotations).where(and(eq(quotations.providerId, userId), eq(quotations.status, 'accepted')));
  return Number(row?.count ?? 0);
}

// ── Disputes (user-facing) ─────────────────────────────────────────────────
// A customer or provider can open a dispute against a real project relationship.
// The admin side (list/update) already exists; this is the missing user half.
const disputesRouter = router({
  myDisputes: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db.select().from(disputes)
      .where(or(eq(disputes.reporterId, ctx.user.id), eq(disputes.respondentId, ctx.user.id)))
      .orderBy(desc(disputes.createdAt));
  }),

  create: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      respondentId: z.number().int().positive().optional(),
      title: z.string().trim().min(1).max(255),
      description: z.string().trim().min(1).max(5000),
      type: z.string().max(80).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      // The reporter must be a participant of the project they dispute about.
      const access = await requireProjectAccess(db, input.projectId, ctx.user.id, 'read');

      let respondentId: number | null = input.respondentId ?? null;
      if (respondentId != null) {
        if (respondentId === ctx.user.id) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot open a dispute against yourself.' });
        }
        const isOwner = access.ownerId === respondentId;
        const [member] = await db
          .select({ userId: projectMembers.userId })
          .from(projectMembers)
          .where(and(
            eq(projectMembers.projectId, input.projectId),
            eq(projectMembers.userId, respondentId),
            isNull(projectMembers.removedAt),
          ))
          .limit(1);
        if (!member && !isOwner) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'The respondent must be a participant on this project.' });
        }
      }

      const result = await db.insert(disputes).values({
        reporterId: ctx.user.id,
        respondentId,
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        type: input.type ?? 'general',
        status: 'open',
        priority: 'medium',
      });
      return { id: Number(result[0].insertId) };
    }),
});

// ── Provider Portfolio ─────────────────────────────────────────────────────
// A professional showcases their own completed work. Ownership is the server's:
// every write is scoped to ctx.user.id, and reads of someone else's portfolio
// are public showcase data only.
const portfolioRouter = router({
  list: protectedProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      return db.select().from(portfolioItems)
        .where(eq(portfolioItems.userId, input.userId))
        .orderBy(desc(portfolioItems.createdAt));
    }),

  myItems: approvedProviderProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db.select().from(portfolioItems)
      .where(eq(portfolioItems.userId, ctx.user.id))
      .orderBy(desc(portfolioItems.createdAt));
  }),

  create: approvedProviderProcedure
    .input(z.object({
      title: z.string().min(1).max(191),
      description: z.string().max(5000).optional(),
      category: z.string().max(100).optional(),
      location: z.string().max(191).optional(),
      completionYear: z.number().int().min(1900).max(2100).optional(),
      services: z.string().max(500).optional(),
      images: z.array(z.string().max(2048)).max(10).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const result = await db.insert(portfolioItems).values({
        ...input,
        userId: ctx.user.id,
        images: input.images && input.images.length > 0 ? JSON.stringify(input.images) : null,
      });
      return { id: Number(result[0].insertId) };
    }),

  update: approvedProviderProcedure
    .input(z.object({
      id: z.number().int().positive(),
      title: z.string().min(1).max(191).optional(),
      description: z.string().max(5000).optional(),
      category: z.string().max(100).optional(),
      location: z.string().max(191).optional(),
      completionYear: z.number().int().min(1900).max(2100).nullable().optional(),
      services: z.string().max(500).optional(),
      images: z.array(z.string().max(2048)).max(10).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const { id, images, ...fields } = input;
      const [owned] = await db.select({ id: portfolioItems.id })
        .from(portfolioItems).where(and(eq(portfolioItems.id, id), eq(portfolioItems.userId, ctx.user.id))).limit(1);
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'Portfolio item not found' });
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(fields)) if (value !== undefined) patch[key] = value;
      if (images !== undefined) patch.images = images.length > 0 ? JSON.stringify(images) : null;
      if (Object.keys(patch).length > 0) {
        await db.update(portfolioItems).set(patch)
          .where(and(eq(portfolioItems.id, id), eq(portfolioItems.userId, ctx.user.id)));
      }
      return { id };
    }),

  delete: approvedProviderProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [owned] = await db.select({ id: portfolioItems.id })
        .from(portfolioItems).where(and(eq(portfolioItems.id, input.id), eq(portfolioItems.userId, ctx.user.id))).limit(1);
      if (!owned) throw new TRPCError({ code: 'NOT_FOUND', message: 'Portfolio item not found' });
      await db.delete(portfolioItems)
        .where(and(eq(portfolioItems.id, input.id), eq(portfolioItems.userId, ctx.user.id)));
      return { success: true as const };
    }),

  uploadImage: approvedProviderProcedure
    .input(z.object({
      fileName: z.string().min(1).max(255),
      contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      base64: z.string().max(11_000_000),
    }))
    .mutation(async ({ ctx, input }) => {
      enforceUploadRateLimit(ctx.user.id);
      const buffer = Buffer.from(input.base64, 'base64');
      if (buffer.length > MAX_PRODUCT_IMAGE_SIZE) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Image too large (max 5MB)' });
      }
      assertUploadedFileMatches(input.contentType, buffer, IMAGE_TYPES);
      const safeName = input.fileName.replace(/[^\w.-]+/g, '_');
      const { key, url } = await storagePutOrUnavailable(
        `portfolio-images/user-${ctx.user.id}/${Date.now()}-${safeName}`,
        buffer,
        input.contentType,
      );
      return { key, url, name: input.fileName, type: input.contentType, size: buffer.length };
    }),
});

const profileRouter = router({
  // Public vendor profile. Requires authentication (the safer of the two options
  // left open by Phase 4A.5 - fully logged-out access was explicitly flagged as
  // an unresolved owner decision and is deliberately NOT chosen here; see
  // BUILDHUB_PHASE4A61_VENDOR_PROFILE_IMPLEMENTATION.md). Scoped to provider-role
  // accounts only - this endpoint answers "what does this vendor look like,"
  // not "what does any BuildHub user look like."
  getPublic: protectedProcedure.input(z.object({ userId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    // accountStatus is read here and DELIBERATELY not returned: it decides
    // whether the contact button is offered, and telling a stranger that a
    // particular account is frozen is not the vendor's public record.
    const [target] = await db
      .select({ ...PUBLIC_PROFILE_COLUMNS, accountStatus: users.accountStatus })
      .from(users).where(eq(users.id, input.userId));
    if (!target || !providerRoles.includes(target.userRole as typeof providerRoles[number])) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor profile not found' });
    }
    const { accountStatus, ...publicFields } = target;
    // THE CONTACT MODEL, DERIVED - NOT INVENTED.
    //
    // Three tiers exist in this codebase already and this endpoint does not
    // add a fourth:
    //
    //  PUBLIC     - what marketplace.vendors returns without a session: name,
    //               location, verification, categories, reputation.
    //  AUTHORIZED - this response, and the in-platform message channel.
    //               messages.send already lets any signed-in account write to
    //               any active account; that was a deliberate marketplace
    //               decision recorded in an earlier audit, and it is the one
    //               contact route BuildHub actually operates.
    //  PRIVATE    - users.phone and users.email. They are not in
    //               PUBLIC_PROFILE_COLUMNS and they are NOT added here. There
    //               is no flow in this repository that releases a vendor's
    //               direct line to a customer, so inventing one would be
    //               inventing a business rule.
    //
    // `contactChannel` states which of those the reader is entitled to, so the
    // page renders the truth rather than each client guessing.
    // ── THE COMPANY PROFILE, AT THE TIER THIS READER HAS EARNED ──────────
    //
    // The note above records that no flow existed to release a vendor's direct
    // line, and that inventing one would be inventing a business rule. That
    // rule has since been DECIDED by the owner: the contact block is released
    // once the vendor has ENGAGED - they quoted on this customer's RFQ, or
    // they are a live member of this customer's project. An invitation is
    // deliberately not enough, or anyone could harvest any vendor's details by
    // inviting them to a throwaway RFQ.
    //
    // Note what is released and what is not. `users.email` / `users.phone` -
    // the vendor's personal login details - remain private exactly as before.
    // What unlocks is the PRIMARY CONTACT the vendor themselves nominated as
    // their business contact, which is a different field and a different
    // consent.
    const company = await readVendorProfile(db, target.id, ctx.user);

    return {
      ...publicFields,
      categories: await getVendorCategories(target.id),
      completedProjects: await completedProjectCount(db, target.id),
      // A frozen or deactivated vendor cannot receive messages - messages.send
      // refuses them - so the page must not offer a button that will fail.
      contactChannel: accountStatus === 'active' ? 'message' as const : 'none' as const,
      // Null when the vendor has filled in nothing. The page says so rather
      // than inventing a company name out of their personal name.
      company: company.profile,
      // Null when LOCKED, which is a different thing from "the vendor left it
      // blank" - and `contactAccess` is what lets the page say which.
      primaryContact: company.contact,
      contactAccess: company.contactAccess,
      ...(company.registrationNumber !== undefined
        ? { registrationNumber: company.registrationNumber }
        : {}),
    };
  }),
  // A vendor's own profile, for the edit form. Identical field set to getPublic
  // (no additional private data) - self-scoping comes entirely from using
  // ctx.user.id, never a client-supplied id.
  getOwn: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select(PUBLIC_PROFILE_COLUMNS).from(users).where(eq(users.id, ctx.user.id));
    if (!target) throw new TRPCError({ code: 'NOT_FOUND' });
    return { ...target, completedProjects: await completedProjectCount(db, ctx.user.id) };
  }),
  // Self-only by construction: there is no userId (or any other target-account
  // identifier) anywhere in this input schema, so there is no field a client
  // could ever populate to modify a different account's profile.
  update: protectedProcedure.input(z.object({
    bio: z.string().max(1000).optional(),
    location: z.string().max(255).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    await db.update(users).set({ bio: input.bio, location: input.location }).where(eq(users.id, ctx.user.id));
    return { success: true };
  }),
  /**
   * The vendor's own company profile, for their edit form.
   *
   * A DIFFERENT procedure from getPublic on purpose. That one answers "what
   * may this viewer see"; reusing it here would make the edit form's contents
   * depend on an access check that should never apply to the owner of the
   * record. Two questions, two procedures.
   *
   * Self-scoped by construction: no userId in the input, so there is no field
   * a client could populate to read another company's profile.
   */
  myCompanyProfile: approvedProviderProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    return readOwnVendorProfile(db, ctx.user.id);
  }),

  myReferral: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [row] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, ctx.user.id)).limit(1);
    let code = row?.referralCode ?? null;
    if (!code) {
      code = generateReferralCode();
      await db.update(users).set({ referralCode: code }).where(eq(users.id, ctx.user.id));
    }
    const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(referrals).where(eq(referrals.referrerId, ctx.user.id));
    return {
      code,
      link: `/auth?mode=signup&ref=${encodeURIComponent(code)}`,
      referrals: Number(countRow?.count ?? 0),
    };
  }),

  /**
   * Save the caller's own company profile.
   *
   * Self-only by construction, the same discipline as `update` above: there is
   * no userId anywhere in this schema, and `saveOwnVendorProfile` takes the id
   * from the authenticated session. No payload can move a profile onto another
   * account.
   *
   * EMPTY STRING MEANS "CLEARED", NOT "UNCHANGED". A vendor deleting their
   * website must be able to actually delete it, so blanks are normalised to
   * NULL rather than stored as '' - otherwise the page would render an empty
   * link and the database would disagree with the screen.
   */
  saveMyCompanyProfile: approvedProviderProcedure
    .input(z.object({
      companyName: z.string().max(191).optional(),
      companyDescription: z.string().max(5000).optional(),
      primaryContactName: z.string().max(191).optional(),
      primaryContactPosition: z.string().max(120).optional(),
      // Validated as an email when present, because a contact address that is
      // not an address is a field that looks filled in and is not.
      primaryContactEmail: z.string().max(255).email().or(z.literal('')).optional(),
      primaryContactPhone: z.string().max(40).optional(),
      primaryContactMobile: z.string().max(40).optional(),
      addressLine: z.string().max(255).optional(),
      alternativeEmail: z.string().max(255).email().or(z.literal('')).optional(),
      city: z.string().max(120).optional(),
      country: z.string().max(120).optional(),
      website: z.string().max(255).optional(),
      tradingName: z.string().max(191).optional(),
      serviceCoverage: z.string().max(5000).optional(),
      specialties: z.string().max(5000).optional(),
      businessHours: z.string().max(2000).optional(),
      socialLinks: z.string().max(5000).optional(),
      registrationNumber: z.string().max(120).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const patch: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        const trimmed = String(value).trim();
        patch[key] = trimmed === '' ? null : trimmed;
      }
      if (Object.keys(patch).length === 0) return { success: true as const, changed: false };

      await saveOwnVendorProfile(db, ctx.user.id, patch);
      return { success: true as const, changed: true };
    }),

  myVendorNameChanges: approvedProviderProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db.select().from(vendorNameChangeRequests)
      .where(eq(vendorNameChangeRequests.userId, ctx.user.id))
      .orderBy(desc(vendorNameChangeRequests.createdAt))
      .limit(50);
  }),

  requestVendorNameChange: approvedProviderProcedure
    .input(z.object({
      field: z.enum(['companyName', 'tradingName']),
      requestedValue: z.string().trim().min(1).max(191),
      reason: z.string().trim().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const openStatuses = ['pending', 'under_review', 'needs_information'] as const;
      const [openRequest] = await db.select({ id: vendorNameChangeRequests.id })
        .from(vendorNameChangeRequests)
        .where(and(
          eq(vendorNameChangeRequests.userId, ctx.user.id),
          eq(vendorNameChangeRequests.field, input.field),
          inArray(vendorNameChangeRequests.status, openStatuses),
        ))
        .limit(1);
      if (openRequest) throw new TRPCError({ code: 'CONFLICT', message: 'An open name-change request already exists for this field' });

      const [profile] = await db.select({
        companyName: vendorProfiles.companyName,
        tradingName: vendorProfiles.tradingName,
      }).from(vendorProfiles).where(eq(vendorProfiles.userId, ctx.user.id)).limit(1);
      const currentValue = profile ? (profile as any)[input.field] ?? null : null;

      const result = await db.insert(vendorNameChangeRequests).values({
        userId: ctx.user.id,
        field: input.field,
        currentValue,
        requestedValue: input.requestedValue,
        reason: input.reason ?? null,
        status: 'pending',
        adminCorrection: false,
      });
      await recordAccountEvent(db, {
        userId: ctx.user.id,
        actorId: ctx.user.id,
        action: 'vendor_name_change_requested',
        source: 'vendor_name_change',
        note: `${input.field}: ${currentValue ?? '—'} -> ${input.requestedValue}`,
      });
      return { success: true, requestId: Number(result[0]?.insertId ?? 0) };
    }),

  // ── Vendor service categories (Phase 4B.3) ──────────────────────────────
  // A vendor declares which of the nine shared RFQ categories describe their
  // work. This is what makes RFQ targeting possible without BuildHub guessing
  // a role-to-category mapping. Self-scoped by construction: no userId input.
  myCategories: approvedProviderProcedure.query(async ({ ctx }) => {
    const [categories, resolution] = await Promise.all([
      getVendorCategories(ctx.user.id),
      resolveVendorEntitlements(ctx.user.id),
    ]);
    return {
      categories,
      available: RFQ_CATEGORIES,
      limit: resolution.entitlements.serviceCategoryLimit,
    };
  }),
  setMyCategories: approvedProviderProcedure
    .input(z.object({ categories: z.array(z.string()).max(RFQ_CATEGORIES.length) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      // Only values from the shared taxonomy - a client cannot invent one.
      const unique = Array.from(new Set(input.categories));
      const invalid = unique.filter(category => !isRfqCategory(category));
      if (invalid.length > 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown service category: ${invalid.join(', ')}` });
      }

      // The per-plan cap comes from the Phase 4B.2 resolver, never duplicated here.
      const resolution = await resolveVendorEntitlements(ctx.user.id);
      const limit = resolution.entitlements.serviceCategoryLimit;
      if (limit !== null && unique.length > limit) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Your plan allows up to ${limit} service categories. Upgrade to declare more.`,
        });
      }

      // Replace the vendor's own declarations only - scoped to ctx.user.id.
      await db.delete(vendorCategories).where(eq(vendorCategories.userId, ctx.user.id));
      if (unique.length > 0) {
        await db.insert(vendorCategories).values(unique.map(category => ({ userId: ctx.user.id, category })));
      }
      return { categories: unique };
    }),
  // Same self-only guarantee as update: writes only to ctx.user.id's row.
  uploadAvatar: protectedProcedure.input(z.object({
    contentType: z.string().refine(isAllowedAvatarType, 'Only image files are supported'),
    base64: z.string().min(1),
  })).mutation(async ({ ctx, input }) => {
    enforceUploadRateLimit(ctx.user.id);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_AVATAR_SIZE) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Avatar images must be between 1 byte and 2MB' });
    assertUploadedFileMatches(input.contentType, bytes, IMAGE_TYPES);
    const { url } = await storagePutOrUnavailable(`avatars/${ctx.user.id}/${Date.now()}-avatar`, bytes, input.contentType);
    await db.update(users).set({ avatar: url }).where(eq(users.id, ctx.user.id));
    return { url };
  }),
});

// ── Vendor Analytics Router ────────────────────────────────────────────────
// Phase 4A.6.3. Exactly 4 approved metrics, one self-scoped query, no
// vendorId/userId input field anywhere in this router (structural isolation,
// same pattern as profileRouter.getOwn/update - a client literally cannot
// name another vendor's account here). "RFQs received" is intentionally NOT
// implemented: rfq.list/rfqRouter has no per-vendor targeting (any provider
// can quote on any open RFQ), so there is no honest "received" count to
// report. Quotation acceptance has no timestamp of its own (quotations has
// only `createdAt`, no `updatedAt`/`acceptedAt`), so "time to acceptance"
// cannot be computed either - response time here is instead defined as the
// time between an RFQ being posted and this vendor's own quotation on it
// being submitted (rfqs.createdAt -> quotations.createdAt), which both
// existing NOT NULL/defaultNow() columns fully support.
const analyticsRouter = router({
  myStats: approvedProviderProcedure.query(async ({ ctx }) => {
    if (!providerRoles.includes(ctx.user.userRole as typeof providerRoles[number])) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Provider access required' });
    }
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

    // Single aggregate query, scoped to ctx.user.id only: submitted/accepted counts
    // and average response time in one pass, so there is exactly one definition of
    // "accepted" in this router (status = 'accepted', the only accepted state the
    // schema defines) rather than two calculations that could drift apart.
    const [row] = await db.select({
      submitted: sql<number>`count(*)`,
      accepted: sql<number>`sum(case when ${quotations.status} = 'accepted' then 1 else 0 end)`,
      avgResponseSeconds: sql<string | null>`avg(timestampdiff(second, ${rfqs.createdAt}, ${quotations.createdAt}))`,
    })
      .from(quotations)
      .innerJoin(rfqs, eq(quotations.rfqId, rfqs.id))
      .where(eq(quotations.providerId, ctx.user.id));

    const quotationsSubmitted = Number(row?.submitted ?? 0);
    const quotationsAccepted = Number(row?.accepted ?? 0);
    // Division-by-zero guard: 0 submitted -> null win rate, never NaN/Infinity/0-as-a-lie.
    const winRate = quotationsSubmitted > 0
      ? Math.round((quotationsAccepted / quotationsSubmitted) * 1000) / 10
      : null;
    // Every quotations/rfqs row has a NOT NULL defaultNow() createdAt, so a submitted
    // quotation can never be missing a timestamp - null here means zero data, not
    // missing data.
    const avgResponseTimeHours = quotationsSubmitted > 0 && row?.avgResponseSeconds != null
      ? Math.round((Number(row.avgResponseSeconds) / 3600) * 10) / 10
      : null;

    return { quotationsSubmitted, quotationsAccepted, winRate, avgResponseTimeHours };
  }),
});

// ── Admin Router ───────────────────────────────────────────────────────────
/**
 * Any administrator at all.
 *
 * TWO conditions, not one. `role === 'admin'` is the boundary the codebase has
 * always used; `adminRole` says WHICH administrator they are, and an admin row
 * without one has no permissions at all (hasAdminPermission fails closed). The
 * second check is here so such a row is refused at the door rather than passing
 * this tier and then being refused by every endpoint behind it - a difference
 * that matters when someone is trying to work out why their account is broken.
 *
 * Migration 0020 backfills every pre-existing admin to SUPER_ADMIN, so this
 * cannot lock out an administrator who already had access.
 */
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
  if (!isAdminRole(ctx.user.adminRole)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This administrator account has no role assigned.' });
  }
  return next({ ctx });
});

/**
 * An administrator holding a specific permission.
 *
 * Every sensitive admin endpoint is built on this rather than on adminProcedure,
 * so authority is decided per capability instead of by one all-or-nothing flag.
 * The permission is re-derived server-side from the role stored on the row, on
 * every request - never from the client, the URL, or anything in the session
 * token, so a stale or forged claim buys nothing.
 */
const adminWith = (permission: AdminPermission) =>
  adminProcedure.use(({ ctx, next }) => {
    if (!hasAdminPermission(ctx.user.adminRole, permission)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: NOT_ADMIN_ERR_MSG });
    }
    return next({ ctx });
  });

/**
 * A category refusal becomes a BAD_REQUEST carrying the SERVICE's message.
 *
 * The reasons - DUPLICATE, NO_DELETE, STALE_COUNT, CYCLE - are the whole value
 * of those refusals, and flattening them into "something went wrong" would put
 * the administrator in exactly the position the supplier was in when the
 * category error said nothing useful. Anything that is NOT a deliberate refusal
 * is rethrown untouched, so a genuine fault stays a 500 rather than being
 * reported to the caller as their mistake.
 */
async function asCategoryResult<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CategoryAdminError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error });
    }
    throw error;
  }
}

/** Only a Super Admin may touch the authority model itself. */
const superAdminProcedure = adminWith('admins.manage');

// SECURITY (Phase 4A.6.7): `users` also holds passwordHash, invitationToken, and
// other private/internal fields. admin.users MUST always use this explicit
// allowlist - never `select().from(users)` - so a future edit to this file
// cannot silently start leaking a private column to the admin User Management
// screen. Every field here is independently traced to real, current consumption
// in client/src/pages/AdminDashboard.tsx (row display, group filter/counts,
// frozen/verified/dummy/invite badges, and the freeze/audit/dummy-password
// dialogs) - see BUILDHUB_PHASE4A67_ADMIN_USER_DATA_SECURITY.md for the
// field-by-field trace. Adding a new users column later does NOT expose it here
// automatically; it must be added to this list deliberately.
// The people named in a dispute investigation. An explicit allowlist for the
// same reason ADMIN_DIRECTORY_COLUMNS (server/adminUserDirectory.ts) is one:
// `users` holds passwordHash and a
// live invitationToken, and Part 53 forbids surfacing either even to a Super
// Admin. Enough to identify a party and understand their standing; nothing that
// could be redeemed or replayed.
const INVESTIGATION_PARTY_COLUMNS = {
  id: users.id,
  name: users.name,
  username: users.username,
  email: users.email,
  userRole: users.userRole,
  verified: users.verified,
  accountStatus: users.accountStatus,
  onboardingStatus: users.onboardingStatus,
  createdAt: users.createdAt,
} as const;

const DEFAULT_ADMIN_SETTINGS: Record<string, string> = {
  maintenanceMode: 'false',
  registrationEnabled: 'true',
  emailNotifications: 'true',
  smsAlerts: 'false',
  autoVerifyKyc: 'false',
  manualReviewThreshold: '3',
  transactionFeePercent: '2.5',
  commissionPercent: '5',
  reviewApprovalRequired: 'true',
  spamSensitivity: 'medium',
  // Phase 4B.1: founder-offer cut-off, as an ISO date string. Empty = the
  // offer is closed, which is the safe default (getFounderOfferEndsAt treats
  // absent/unparseable as "no offer"). Listed here so an administrator can
  // actually set it through the existing admin.updateSetting endpoint, which
  // rejects any key not defined in this record - without this entry the
  // founder offer would not be configurable at all.
  [FOUNDER_OFFER_ENDS_AT_SETTING_KEY]: '',
};

// SECURITY (Phase 4A cumulative final audit): explicit allowlist for the
// Compliance Queue / Applicant Detail endpoints - see the comment above
// complianceQueue below for why this exists.
const COMPLIANCE_APPLICANT_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  userRole: users.userRole,
  onboardingStatus: users.onboardingStatus,
  onboardingReviewNotes: users.onboardingReviewNotes,
  onboardingReviewedAt: users.onboardingReviewedAt,
  isDummy: users.isDummy,
  createdAt: users.createdAt,
} as const;

const adminRouter = router({
  /**
   * ── THE PRODUCT TAXONOMY, ADMINISTERED ──────────────────────────────────
   *
   * Gated on `marketplace.manage`, which the roles table already describes as
   * "vendor directory, products, compliance review, marketplace content" - the
   * taxonomy is precisely marketplace content, and it is what a MARKETPLACE_ADMIN
   * exists to curate. A fresh eleventh permission for one table would cut
   * against this file's stated reason for having ten: "a permission per
   * endpoint would be 37 permissions nobody can reason about".
   *
   * Every mutation below records who did it. See server/categoryAdmin.ts for
   * which trail takes which kind of change, and why hiding a category never
   * touches a product.
   */
  categories: adminWith('marketplace.manage').query(async () => {
    const db = await getDb();
    // NOT an empty list. "The taxonomy has no categories" and "we could not
    // reach the database" are different facts and the screen must not render
    // the second as the first.
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'The category taxonomy is unavailable right now.' });
    return { categories: await listCategoriesForAdmin(db) };
  }),

  createCategory: adminWith('marketplace.manage')
    .input(z.object({
      slug: z.string().trim().min(3).max(60),
      nameEn: z.string().trim().min(1).max(120),
      nameAr: z.string().trim().min(1).max(120),
      scope: z.enum(CATEGORY_SCOPES),
      parentId: z.number().int().positive().nullable().optional(),
      sortOrder: z.number().int().min(0).max(9999).optional(),
      icon: z.string().max(64).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return asCategoryResult(() => createCategory(db, ctx.user.id, input));
    }),

  updateCategory: adminWith('marketplace.manage')
    .input(z.object({
      id: z.number().int().positive(),
      // `slug` is deliberately absent: it is half the stable identity, and a
      // category whose slug can move makes every URL and stored reference a
      // guess about when it was written.
      nameEn: z.string().trim().min(1).max(120).optional(),
      nameAr: z.string().trim().min(1).max(120).optional(),
      scope: z.enum(CATEGORY_SCOPES).optional(),
      parentId: z.number().int().positive().nullable().optional(),
      sortOrder: z.number().int().min(0).max(9999).optional(),
      icon: z.string().max(64).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return asCategoryResult(() => updateCategory(db, ctx.user.id, input));
    }),

  setCategoryStatus: adminWith('marketplace.manage')
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(CATEGORY_STATUSES),
      /**
       * The dependency confirmation. The screen shows the real product count
       * and echoes it back here, so an administrator who read "3 products" and
       * clicks Hide after somebody listed forty more is stopped rather than
       * surprised.
       */
      expectedProductCount: z.number().int().min(0).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return asCategoryResult(() => setCategoryStatus(db, ctx.user.id, input));
    }),

  addCategoryAlias: adminWith('marketplace.manage')
    .input(z.object({ categoryId: z.number().int().positive(), alias: z.string().trim().min(2).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return asCategoryResult(() => addCategoryAlias(db, ctx.user.id, input));
    }),

  removeCategoryAlias: adminWith('marketplace.manage')
    .input(z.object({ aliasId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return asCategoryResult(() => removeCategoryAlias(db, ctx.user.id, input.aliasId));
    }),

  stats: adminWith('users.read').query(async () => {
    // An all-zero admin dashboard is the most convincing lie on the platform.
    const db = await requireDb();
    const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.isDummy, false));
    const dummyRows = await db.select({ id: users.id }).from(users).where(eq(users.isDummy, true));
    const dummyIds = dummyRows.map(row => row.id);
    const [projectCount] = await db.select({ count: sql<number>`count(*)` }).from(projects).where(dummyIds.length ? notInArray(projects.ownerId, dummyIds) : undefined);
    const [productCount] = await db.select({ count: sql<number>`count(*)` }).from(products);
    const [rfqCount] = await db.select({ count: sql<number>`count(*)` }).from(rfqs).where(dummyIds.length ? notInArray(rfqs.requesterId, dummyIds) : undefined);
    const [disputeCount] = await db.select({ count: sql<number>`count(*)` }).from(disputes).where(eq(disputes.status, 'open'));
    return {
      users: Number(userCount?.count ?? 0),
      projects: Number(projectCount?.count ?? 0),
      products: Number(productCount?.count ?? 0),
      rfqs: Number(rfqCount?.count ?? 0),
      disputes: Number(disputeCount?.count ?? 0),
    };
  }),
  /**
   * THE USER DIRECTORY, PAGED AND COUNTED BY THE DATABASE.
   *
   * This was `.limit(250)` with no total and no indication that a limit had
   * been reached, and the screen then did its own searching, grouping, sorting
   * and pagination over whatever came back. Past 250 accounts that is not a
   * slow screen, it is a WRONG one: users become invisible to administration
   * with nothing to say so, search silently misses people who exist, and the
   * group tiles under "User Management by Group" report counts of a truncated
   * sample as though they were counts of the platform.
   *
   * Filtering, sorting and counting now happen where the rows are. The reply
   * carries `total` for the current filter and `counts` for the tiles, so the
   * screen never has to infer a population from a page of it.
   *
   * THE GROUP EXPRESSION IS `COALESCE(userRole, role)` because that is exactly
   * what the screen used to compute in JavaScript. It is reproduced rather than
   * improved on: changing which group an account falls into is a product
   * decision, and this change is about correctness at scale, not about that.
   */
  users: adminWith('users.read')
    .input(z.object({
      search: z.string().trim().max(MAX_SEARCH_LENGTH).optional(),
      /** A role key, or 'all'. Unknown values are treated as 'all' rather than matching nothing. */
      group: z.string().trim().max(40).default('all'),
      sort: z.enum(['newest', 'name', 'role']).default('newest'),
      page: z.number().int().min(0).max(100_000).default(0),
      /** Bounded: an administrator cannot ask for the whole table in one reply. */
      pageSize: z.number().int().min(1).max(100).default(10),
    }).optional())
    .query(async ({ input }) => {
      const { search, group, sort, page, pageSize } = {
        group: 'all', sort: 'newest' as const, page: 0, pageSize: 10, ...(input ?? {}),
      };
      // No "empty page" fallback. An administrator looking at a user directory
      // that reports zero accounts would conclude something very different from
      // "the directory could not be loaded".
      const db = await requireDb();
      return listAdminUsers(db, { search, group, sort, page, pageSize });
    }),
  // 'admin' is NOT creatable here. This endpoint is gated on `users.manage`,
  // which USER_ADMIN holds - but shared/adminRoles.ts states the invariant that
  // only SUPER_ADMIN (`admins.manage`) may create or re-role an administrator,
  // and this enum contradicted it. It never granted permissions, because
  // `adminRole` is left null and all 38 adminWith(...) endpoints fail closed on
  // a null role. What it DID produce was a row the platform treats as an
  // administrator everywhere it checks `role`: exempt from the frozen-account
  // check in _core/trpc.ts, rendering the full admin menu, and created outside
  // the invitation flow that records `admin_created` and an adminInvitations
  // row. Administrators are created by admin.createAdmin, under superAdminProcedure.
  createUser: adminWith('users.manage').input(z.object({
    username: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/),
    email: z.string().trim().email(),
    name: z.string().trim().min(1).max(255),
    phone: z.string().trim().max(32).optional(),
    userRole: z.enum(['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager']),
    note: z.string().trim().max(1000).optional(),
    sendInvitation: z.boolean().default(true),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const username = normalizeUsername(input.username)!;
    const email = normalizeEmail(input.email)!;
    if (await getUserByUsername(username)) throw new TRPCError({ code: 'CONFLICT', message: 'Username is already in use' });
    if (await getUserByEmail(email)) throw new TRPCError({ code: 'CONFLICT', message: 'Email is already in use' });
    const professional = isComplianceRole(input.userRole);
    const openId = `admin_${randomUUID()}`;
    const inviteToken = randomUUID() + '-' + randomUUID().slice(0, 8);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const result = await db.insert(users).values({
      openId, username, name: input.name, email, phone: input.phone || null, loginMethod: 'admin_created', role: 'user', userRole: input.userRole, accountSource: 'admin_created', isDummy: false, createdBy: ctx.user.id, creationNote: input.note || null, onboardingStatus: professional ? 'not_started' : 'approved', verified: !professional,
      invitationStatus: input.sendInvitation ? 'invitation_sent' : 'none',
      invitationToken: input.sendInvitation ? inviteToken : null,
      invitationExpiresAt: input.sendInvitation ? expiresAt : null,
      invitationSentAt: input.sendInvitation ? new Date() : null,
    });
    const userId = Number(result[0]?.insertId);
    await recordAccountEvent(db, { userId, actorId: ctx.user.id, action: input.sendInvitation ? 'admin_created_account_with_invite' : 'admin_created_account', source: 'admin_created', note: input.note || null });
    return { success: true, userId, invitationLink: input.sendInvitation ? `/auth/setup-password?token=${inviteToken}` : null };
  }),
  resendInvitation: adminWith('users.manage').input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select().from(users).where(eq(users.id, input.userId));
    if (!target || target.accountSource !== 'admin_created') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only admin-created accounts can be invited' });
    const inviteToken = randomUUID() + '-' + randomUUID().slice(0, 8);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.update(users).set({ invitationStatus: 'invitation_sent', invitationToken: inviteToken, invitationExpiresAt: expiresAt, invitationSentAt: new Date() }).where(eq(users.id, input.userId));
    await recordAccountEvent(db, { userId: input.userId, actorId: ctx.user.id, action: 'invitation_resent', source: 'admin_created', note: `Resent to ${target.email}` });
    return { success: true, invitationLink: `/auth/setup-password?token=${inviteToken}` };
  }),
  completeInvitation: publicProcedure.input(z.object({ token: z.string().min(10), password: z.string().min(6).max(128) })).mutation(async ({ ctx, input }) => {
    // Unauthenticated, and it sets a password from a bearer token - so the guess
    // rate has to be bounded. Keyed by IP only: the token is the thing being
    // guessed, so keying on it would bound nothing.
    enforceAuthRateLimit(ctx.req, null);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select().from(users).where(eq(users.invitationToken, input.token));
    if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invalid or expired invitation link' });
    if (target.invitationExpiresAt && new Date(target.invitationExpiresAt).getTime() < Date.now()) {
      await db.update(users).set({ invitationStatus: 'expired' }).where(eq(users.id, target.id));
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This invitation link has expired' });
    }
    if (target.invitationStatus === 'password_set') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This invitation link has already been used' });
    }
    const passwordHash = await hashPassword(input.password);
    await db.update(users).set({ invitationStatus: 'password_set', invitationToken: null, invitationExpiresAt: null, passwordSetAt: new Date(), passwordHash, verified: true, accountStatus: 'active' }).where(eq(users.id, target.id));
    await recordAccountEvent(db, { userId: target.id, actorId: target.id, action: 'password_set_via_invitation', source: 'admin_created', note: 'Password successfully configured by user' });
    return { success: true, username: target.username };
  }),
  fullAuditReport: adminWith('audit.read').query(async ({ ctx }) => {
    const db = await requireDb();
    const events = await db.select().from(userAccountAuditEvents).orderBy(desc(userAccountAuditEvents.createdAt)).limit(1000);
    // COLUMN LIST, not `select().from(users)`.
    //
    // Nothing leaked: the projection below is already an explicit allowlist, so
    // no private column ever reached the response. But this pulled EVERY column
    // of EVERY user - passwordHash, invitationToken, openId - into process
    // memory to build an audit export, and it is the precise pattern
    // ADMIN_DIRECTORY_COLUMNS exists to forbid, one endpoint over. The next
    // person to add `...targetUser` to the mapped object would have shipped the
    // leak without touching this line.
    const allUsersList = await db.select({
      id: users.id, name: users.name, email: users.email, isDummy: users.isDummy,
      accountSource: users.accountSource, userRole: users.userRole, role: users.role,
      accountStatus: users.accountStatus, invitationStatus: users.invitationStatus,
    }).from(users);
    const userMap = new Map(allUsersList.map(u => [u.id, u]));
    const adminMap = new Map(allUsersList.map(u => [u.id, u.name || u.email || `#${u.id}`]));
    return events.map(event => {
      const targetUser = event.userId != null ? userMap.get(event.userId) : undefined;
      const actorName = event.actorId ? (adminMap.get(event.actorId) ?? `Admin #${event.actorId}`) : 'System';
      return {
        id: event.id,
        userId: event.userId,
        userName: targetUser?.name || targetUser?.email || (event.userId != null ? `#${event.userId}` : 'Deleted user'),
        userEmail: targetUser?.email || '—',
        accountType: targetUser?.isDummy ? 'Dummy / Test' : targetUser?.accountSource === 'admin_created' ? 'Admin Created' : 'Self Registered',
        role: targetUser?.userRole || targetUser?.role || 'user',
        actorName,
        action: event.action,
        source: event.source || 'system',
        note: event.note || '—',
        createdAt: event.createdAt,
        accountStatus: targetUser?.accountStatus || 'active',
        invitationStatus: targetUser?.invitationStatus || 'none',
      };
    });
  }),
  createDummyUser: adminWith('qa.manage').input(z.object({
    name: z.string().trim().min(1).max(255).optional(),
    username: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    userRole: z.enum(['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager']),
    note: z.string().trim().max(1000).optional(),
    password: z.string().min(8).max(128).optional(),
  })).mutation(async ({ ctx, input }) => {
    assertTestLoginCapabilityEnabled();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const token = randomUUID().replace(/-/g, '').slice(0, 12);
    const passwordHash = input.password ? await hashPassword(input.password) : null;
    const username = normalizeUsername(input.username) ?? `dummy_${input.userRole}_${token}`;
    const email = `dummy+${token}@buildhub.test`;
    if (await getUserByUsername(username)) throw new TRPCError({ code: 'CONFLICT', message: 'Username is already in use' });
    const professional = isComplianceRole(input.userRole);
    const result = await db.insert(users).values({
      openId: `dummy_${randomUUID()}`, username, name: input.name?.trim() || `Dummy ${input.userRole}`, email, loginMethod: 'dummy', role: 'user', userRole: input.userRole, accountSource: 'admin_created', isDummy: true, createdBy: ctx.user.id, creationNote: input.note || 'Created for testing', accountStatus: 'frozen', frozenAt: new Date(), frozenReason: 'Dummy/test accounts are disabled by default', deactivatedAt: new Date(), onboardingStatus: professional ? 'not_started' : 'approved', verified: false, passwordHash, invitationStatus: passwordHash ? 'password_set' : 'none', passwordSetAt: passwordHash ? new Date() : null,
    });
    const userId = Number(result[0]?.insertId);
    await recordAccountEvent(db, { userId, actorId: ctx.user.id, action: 'dummy_user_created', source: 'dummy', note: input.note || 'Created for testing' });
    return { success: true, userId, username, email };
  }),
  userDetail: adminWith('users.read').input(z.object({ userId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [row] = await db.select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      phone: users.phone,
      role: users.role,
      userRole: users.userRole,
      accountStatus: users.accountStatus,
      frozenReason: users.frozenReason,
      verified: users.verified,
      isDummy: users.isDummy,
      accountSource: users.accountSource,
      invitationStatus: users.invitationStatus,
      onboardingStatus: users.onboardingStatus,
      location: users.location,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      companyName: vendorProfiles.companyName,
      tradingName: vendorProfiles.tradingName,
    }).from(users).leftJoin(vendorProfiles, eq(vendorProfiles.userId, users.id)).where(eq(users.id, input.userId)).limit(1);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    return row;
  }),
  updateUser: adminWith('users.manage').input(z.object({
    userId: z.number().int().positive(),
    name: z.string().trim().min(1).max(255).optional(),
    username: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().max(32).optional(),
    userRole: z.enum(['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager']).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    // THE THREE COLUMNS THIS MUTATION ACTUALLY CONSULTS, and no more: the
    // admin-tier check, and the two uniqueness comparisons below. A bare
    // `select()` pulled passwordHash, reset-token columns and every future
    // secret this table grows into a request handler that needs none of them.
    // Nothing here is returned to the client, so this is defence in depth
    // rather than a plugged leak - but the allowlist exists precisely so that
    // the next edit to this procedure cannot turn it into one.
    const [target] = await db
      .select({ role: users.role, username: users.username, email: users.email })
      .from(users)
      .where(eq(users.id, input.userId));
    if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    if (target.role === 'admin' && input.userRole) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Administrator roles are managed from Admin Management, not User Management' });
    }

    const patch: Record<string, string | null> = {};
    if (input.username !== undefined) {
      const username = normalizeUsername(input.username)!;
      if (username !== target.username && await getUserByUsername(username)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Username is already in use' });
      }
      patch.username = username;
    }
    if (input.email !== undefined) {
      const email = normalizeEmail(input.email)!;
      if (email !== target.email && await getUserByEmail(email)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Email is already in use' });
      }
      patch.email = email;
    }
    if (input.name !== undefined) patch.name = input.name;
    if (input.phone !== undefined) patch.phone = input.phone || null;
    if (input.userRole !== undefined) patch.userRole = input.userRole;

    if (Object.keys(patch).length === 0) return { success: true as const, changed: false };
    await db.update(users).set(patch).where(eq(users.id, input.userId));
    await recordAccountEvent(db, {
      userId: input.userId,
      actorId: ctx.user.id,
      action: 'admin_user_updated',
      source: 'admin',
      note: Object.keys(patch).join(', '),
    });
    return { success: true as const, changed: true };
  }),
  userNotes: adminWith('users.read').input(z.object({ userId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await requireDb();
    const rows = await db.select({
      id: adminNotes.id,
      note: adminNotes.note,
      createdAt: adminNotes.createdAt,
      authorName: users.name,
      authorEmail: users.email,
    }).from(adminNotes)
      .innerJoin(users, eq(users.id, adminNotes.authorId))
      .where(and(eq(adminNotes.subjectType, 'user'), eq(adminNotes.subjectId, input.userId)))
      .orderBy(desc(adminNotes.createdAt))
      .limit(100);
    return rows;
  }),
  addUserNote: adminWith('users.manage').input(z.object({
    userId: z.number().int().positive(),
    note: z.string().trim().min(1).max(5000),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const result = await db.insert(adminNotes).values({
      subjectType: 'user',
      subjectId: input.userId,
      note: input.note,
      authorId: ctx.user.id,
    });
    return { success: true, noteId: Number(result[0]?.insertId ?? 0) };
  }),
  referrals: adminWith('marketplace.manage').query(async () => {
    const db = await requireDb();
    const rows = await db.select({
      id: referrals.id,
      referrerId: referrals.referrerId,
      referredId: referrals.referredId,
      code: referrals.code,
      status: referrals.status,
      rewardType: referrals.rewardType,
      rewardValue: referrals.rewardValue,
      rewardExpiresAt: referrals.rewardExpiresAt,
      createdAt: referrals.createdAt,
      referrerName: users.name,
      referrerEmail: users.email,
    }).from(referrals)
      .innerJoin(users, eq(users.id, referrals.referrerId))
      .orderBy(desc(referrals.createdAt))
      .limit(250);
    return rows;
  }),
  referralCampaigns: adminWith('marketplace.manage').query(async () => {
    const db = await requireDb();
    return db.select().from(referralCampaigns).orderBy(desc(referralCampaigns.createdAt)).limit(100);
  }),
  createReferralCampaign: adminWith('marketplace.manage')
    .input(z.object({
      name: z.string().trim().min(1).max(120),
      status: z.enum(['draft', 'active', 'paused', 'ended']).default('draft'),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().optional(),
      eligibleInviterRoles: z.array(z.string()).min(1),
      eligibleReferredRoles: z.array(z.string()).min(1),
      qualificationType: z.enum(['ACCOUNT_VERIFIED', 'PROVIDER_APPROVED', 'PROFILE_COMPLETED', 'FIRST_VALID_RFQ', 'FIRST_VALID_QUOTATION_RESPONSE']),
      rewardType: z.enum(['EXTRA_QUALIFIED_ENQUIRIES', 'TEMPORARY_FEATURED', 'SUBSCRIPTION_EXTENSION']),
      rewardValue: z.string().trim().min(1).max(100),
      rewardDurationDays: z.number().int().positive().optional(),
      perInviterCap: z.number().int().positive().default(1),
      campaignCap: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const startsAt = input.startsAt ? new Date(input.startsAt) : null;
      const endsAt = input.endsAt ? new Date(input.endsAt) : null;
      if (startsAt && endsAt && endsAt <= startsAt) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Campaign end date must be after its start date' });
      const result = await db.insert(referralCampaigns).values({
        name: input.name,
        status: input.status,
        startsAt,
        endsAt,
        eligibleInviterRoles: JSON.stringify(input.eligibleInviterRoles),
        eligibleReferredRoles: JSON.stringify(input.eligibleReferredRoles),
        qualificationType: input.qualificationType,
        rewardType: input.rewardType,
        rewardValue: input.rewardValue,
        rewardDurationDays: input.rewardDurationDays ?? null,
        perInviterCap: input.perInviterCap,
        campaignCap: input.campaignCap ?? null,
        createdBy: ctx.user.id,
      });
      await recordAccountEvent(db, {
        userId: ctx.user.id,
        actorId: ctx.user.id,
        action: 'referral_campaign_created',
        source: 'referral',
        note: `${input.name} (${input.status})`,
      });
      return { success: true, campaignId: Number(result[0]?.insertId ?? 0) };
    }),
  updateReferralCampaign: adminWith('marketplace.manage')
    .input(z.object({
      campaignId: z.number().int().positive(),
      status: z.enum(['draft', 'active', 'paused', 'ended']).optional(),
      name: z.string().trim().min(1).max(120).optional(),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().optional(),
      perInviterCap: z.number().int().positive().optional(),
      campaignCap: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const patch: Record<string, string | number | Date | null> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.status !== undefined) patch.status = input.status;
      if (input.startsAt !== undefined) patch.startsAt = input.startsAt ? new Date(input.startsAt) : null;
      if (input.endsAt !== undefined) patch.endsAt = input.endsAt ? new Date(input.endsAt) : null;
      if (input.perInviterCap !== undefined) patch.perInviterCap = input.perInviterCap;
      if (input.campaignCap !== undefined) patch.campaignCap = input.campaignCap ?? null;
      if (Object.keys(patch).length === 0) return { success: true as const, changed: false };
      await db.update(referralCampaigns).set(patch).where(eq(referralCampaigns.id, input.campaignId));
      await recordAccountEvent(db, {
        userId: ctx.user.id,
        actorId: ctx.user.id,
        action: 'referral_campaign_updated',
        source: 'referral',
        note: Object.keys(patch).join(', '),
      });
      return { success: true as const, changed: true };
    }),
  referralRewards: adminWith('marketplace.manage').query(async () => {
    const db = await requireDb();
    return db.select({
      id: referralRewards.id,
      referralId: referralRewards.referralId,
      campaignId: referralRewards.campaignId,
      recipientUserId: referralRewards.recipientUserId,
      rewardType: referralRewards.rewardType,
      rewardValue: referralRewards.rewardValue,
      status: referralRewards.status,
      effectiveFrom: referralRewards.effectiveFrom,
      expiresAt: referralRewards.expiresAt,
      reversedAt: referralRewards.reversedAt,
      reversalReason: referralRewards.reversalReason,
      createdAt: referralRewards.createdAt,
      campaignName: referralCampaigns.name,
      recipientName: users.name,
    }).from(referralRewards)
      .innerJoin(referralCampaigns, eq(referralCampaigns.id, referralRewards.campaignId))
      .innerJoin(users, eq(users.id, referralRewards.recipientUserId))
      .orderBy(desc(referralRewards.createdAt))
      .limit(250);
  }),
  qualifyReferral: adminWith('marketplace.manage')
    .input(z.object({ referralId: z.number().int().positive(), qualificationType: z.enum(['ACCOUNT_VERIFIED', 'PROVIDER_APPROVED', 'PROFILE_COMPLETED', 'FIRST_VALID_RFQ', 'FIRST_VALID_QUOTATION_RESPONSE']).optional(), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [referral] = await db.select().from(referrals).where(eq(referrals.id, input.referralId));
      if (!referral) throw new TRPCError({ code: 'NOT_FOUND', message: 'Referral not found' });
      if (referral.status === 'revoked' || referral.status === 'expired') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Referral cannot be qualified' });
      /**
       * THE SAME ENGINE THE PRODUCT USES - not a second implementation.
       *
       * This wrote `status: 'qualified'` directly and granted nothing. An
       * administrator clicking Qualify moved a word in the database and the
       * inviter received no reward, no notification and no entitlement: a
       * permanent dead end, and one that looked like it had worked.
       *
       * Routing it through qualifyReferralEvent means the manual path resolves
       * a campaign, writes a reward, applies its effect and reports the truth,
       * under exactly the rules the automatic events follow. The note the
       * administrator wrote is preserved on the referral afterwards.
       */
      const qualificationType = input.qualificationType ?? 'ACCOUNT_VERIFIED';
      const eventKey = `admin:${referral.id}:${qualificationType}`;
      const result = await qualifyReferralEvent(db, referral.referredId, qualificationType, eventKey, new Date());

      if (input.note) {
        await db.update(referrals).set({ qualificationNote: input.note }).where(eq(referrals.id, input.referralId));
      }
      await recordAccountEvent(db, {
        userId: referral.referrerId,
        actorId: ctx.user.id,
        action: 'referral_qualified',
        source: 'referral',
        note: `referral ${referral.id} manually qualified as ${qualificationType}: ${result.outcome}`,
      });

      /*
       * The administrator is told what actually happened. "Qualified" when no
       * campaign was eligible would be the same dead end wearing a success
       * message.
       */
      if (result.outcome === 'granted') {
        return { success: true, status: 'rewarded' as const, outcome: result.outcome, rewardType: result.rewardType, rewardValue: result.rewardValue };
      }
      if (result.outcome === 'already_qualified') {
        return { success: true, status: 'qualified' as const, outcome: result.outcome };
      }
      if (result.outcome === 'reward_pending') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The referral qualified but its reward could not be applied. See the reward ledger for the reason.',
        });
      }
      if (result.outcome === 'cap_reached') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Every eligible campaign has reached its cap for this inviter.' });
      }
      if (result.outcome === 'no_referral') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That referral no longer exists.' });
      }
      // campaign_ineligible - and its `reason` is the useful half, so it is
      // passed through rather than flattened into "not eligible".
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `No campaign is currently eligible to reward this referral (${result.reason}).`,
      });
    }),
  reverseReferralReward: adminWith('marketplace.manage')
    .input(z.object({ rewardId: z.number().int().positive(), reason: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [reward] = await db.select().from(referralRewards).where(eq(referralRewards.id, input.rewardId));
      if (!reward) throw new TRPCError({ code: 'NOT_FOUND', message: 'Reward not found' });
      if (reward.status === 'REVERSED') return { success: true as const, changed: false };
      await db.update(referralRewards).set({
        status: 'REVERSED',
        reversedAt: new Date(),
        reversalReason: input.reason,
      }).where(eq(referralRewards.id, input.rewardId));
      await recordAccountEvent(db, {
        userId: reward.recipientUserId,
        actorId: ctx.user.id,
        action: 'referral_reward_reversed',
        source: 'referral',
        note: input.reason,
      });
      return { success: true as const, changed: true };
    }),
  placements: adminWith('marketplace.manage').query(async () => {
    const db = await requireDb();
    return db.select({
      id: vendorSponsorships.id,
      vendorId: vendorSponsorships.vendorId,
      productId: vendorSponsorships.productId,
      category: vendorSponsorships.category,
      kind: vendorSponsorships.kind,
      source: vendorSponsorships.source,
      package: vendorSponsorships.package,
      surface: vendorSponsorships.surface,
      entityType: vendorSponsorships.entityType,
      priority: vendorSponsorships.priority,
      startsAt: vendorSponsorships.startsAt,
      endsAt: vendorSponsorships.endsAt,
      revokedAt: vendorSponsorships.revokedAt,
      createdAt: vendorSponsorships.createdAt,
      vendorName: users.name,
      productName: products.name,
    }).from(vendorSponsorships)
      .leftJoin(users, eq(users.id, vendorSponsorships.vendorId))
      .leftJoin(products, eq(products.id, vendorSponsorships.productId))
      .orderBy(desc(vendorSponsorships.createdAt))
      .limit(250);
  }),
  /**
   * COMMERCIAL PLACEMENT PERFORMANCE, from real events only.
   *
   * Every figure is a COUNT of analytics rows that exist. A placement nobody
   * has seen reports zeros and NULL rates - null rather than 0%, because "0%
   * clicked" asserts that people saw it and did not click, while the truth is
   * that there is nothing to compute yet. The screen renders that as an empty
   * state, not as failure.
   *
   * There is no revenue, GMV or commission column, here or anywhere below it.
   * BuildHub observes none of those - payments are deferred - and a column is
   * an invitation to fill it in.
   */
  /**
   * THE VENDOR ENQUIRIES OVERVIEW.
   *
   * `marketplace.manage`, the same permission that governs every other view of
   * RFQ and vendor activity, decided server-side. It returns COUNTS ONLY - no
   * vendor identity, no RFQ content, no quotation figure - so the landing view
   * of the control plane discloses nothing beyond volume, and the drill-downs
   * that do show records carry their own checks.
   *
   * `states` travels with the counts so the screen renders every state,
   * including the ones sitting at zero. A dashboard that hides its empty
   * buckets reads as "no data" when it means "none in that state".
   */
  enquiryOverview: adminWith('marketplace.manage')
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return {
        ...(await enquiryOverview(db)),
        states: ENQUIRY_STATES,
        // AVAILABLE is a potential, not a record: it is every eligible vendor
        // against every open RFQ. It can never appear in these counts, and the
        // screen is told so rather than left to wonder why it is always zero.
        excludedFromCounts: ['AVAILABLE'] as const,
      };
    }),

  /**
   * THE VENDOR ENQUIRIES LIST.
   *
   * Same permission as the overview, decided server-side. The filters, the
   * sort and the page are all applied in the DATABASE - filtering a derived
   * state in Node would mean loading every enquiry on the platform to show
   * twenty of them.
   *
   * `sort` is an ENUM, not a string, because it reaches an ORDER BY and an
   * ORDER BY built from user input is an injection point like any other. Every
   * other filter value is bound as a parameter.
   *
   * NO QUOTATION FIGURE IS RETURNED. Whether a vendor answered is the state;
   * what they bid is theirs and the requester's. An administrator's list has no
   * business carrying the market's prices, and this endpoint is exactly where
   * they would all be in one response.
   */
  enquiryList: adminWith('marketplace.manage')
    .input(z.object({
      state: z.enum(ENQUIRY_STATES).optional(),
      rfqStatus: z.enum(RFQ_STATUSES).optional(),
      vendorId: z.number().int().positive().optional(),
      rfqId: z.number().int().positive().optional(),
      // null asks for the unassigned ones - a real question, and distinct from
      // omitting the filter entirely.
      assigneeId: z.number().int().positive().nullable().optional(),
      search: z.string().trim().max(200).optional(),
      sort: z.enum(['activity', 'rfq', 'vendor', 'state', 'assignee']).optional(),
      direction: z.enum(['asc', 'desc']).optional(),
      limit: z.number().int().min(1).max(ENQUIRY_LIST_MAX_LIMIT).optional(),
      offset: z.number().int().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      // The assignee comes from the query itself, not a merge afterwards -
      // that is what lets `assigneeId` be a FILTER rather than a decoration,
      // and it is one query rather than two.
      return enquiryList(db, input ?? {});
    }),

  /**
   * ONE ENQUIRY, IN FULL - for the value of "full" this permission earns.
   *
   * Accepts either the pair or the human reference, because an administrator
   * working from a support ticket has the reference and nothing else.
   *
   * The vendor's allowance comes from getEnquiryUsage - the SAME engine the
   * vendor's own usage screen reads. A second implementation of "how many are
   * left" is how the two screens end up disagreeing about the same month, and
   * the vendor is the one who notices.
   *
   * No quotation contents. See the note on enquiryDetail: bid prices are
   * superAdminProcedure territory in admin.rfqInvestigation, deliberately, and
   * this endpoint must not become a second door to them.
   */
  enquiryDetail: adminWith('marketplace.manage')
    .input(z.union([
      z.object({ rfqId: z.number().int().positive(), vendorId: z.number().int().positive() }),
      z.object({ reference: z.string().trim().min(5).max(64) }),
    ]))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const pair = 'reference' in input ? parseEnquiryReference(input.reference) : input;
      if (!pair) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That is not a valid enquiry reference.' });
      }

      const detail = await enquiryDetail(db, pair, async vendorId => {
        // Shaped down deliberately: the usage engine also returns limitReached,
        // which is the vendor's own UI concern and not a fact about this
        // enquiry.
        const usage = await getEnquiryUsage(vendorId);
        return {
          used: usage.used, allowance: usage.allowance, remaining: usage.remaining,
          periodKey: usage.periodKey, resetsAt: usage.resetsAt,
        };
      });
      if (!detail) {
        // A pasted reference that names a pair with no history is a real
        // answer, not a server error.
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No enquiry exists between that vendor and that request.' });
      }
      const assignment = await currentAssignment(db, pair);
      return {
        ...detail,
        // The whole row, including an unassignment: the screen shows who holds
        // it now AND that somebody deliberately let it go, which a bare id
        // cannot express.
        assignment: assignment && assignment.assigneeId != null ? assignment : null,
        lastAssignmentEvent: assignment,
      };
    }),

  /**
   * INTERNAL NOTES FOR AN ENQUIRY, WITHOUT INVENTING A PLACE TO PUT THEM.
   *
   * An enquiry is a PAIR, and `adminNotes` addresses a single subject id. The
   * options were to extend the table with a second subject column, or to accept
   * that a note about "this vendor on this RFQ" belongs to one of the two
   * things that actually exist. The second is honest and needs no migration:
   * the screen shows the RFQ's notes and the vendor's notes side by side, each
   * labelled with its scope, and adding one requires choosing.
   *
   * The vendor's notes are written with subjectType 'user', NOT 'vendor', so a
   * person's notes stay in one place - the same list their user detail page
   * shows. Splitting them across two subject types would mean an administrator
   * reading one screen could not see what a colleague wrote on the other.
   *
   * THE PERMISSION, AND WHY IT IS NOT JUST marketplace.manage. Notes on a
   * PERSON are user-directory material: `admin.userNotes` requires users.read
   * and `admin.addUserNote` requires users.manage. Returning them from a
   * marketplace endpoint would widen those permissions through a different
   * door - the same mistake as putting a bid price in the enquiry detail. So
   * the vendor half is gated on the permission it has always needed, and the
   * response SAYS SO when the caller lacks it rather than silently returning an
   * empty list that reads as "no notes".
   */
  enquiryNotes: adminWith('marketplace.manage')
    .input(z.object({ rfqId: z.number().int().positive(), vendorId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const columns = {
        id: adminNotes.id,
        note: adminNotes.note,
        createdAt: adminNotes.createdAt,
        authorName: users.name,
      };
      const notesFor = (subjectType: 'rfq' | 'user', subjectId: number) => db.select(columns)
        .from(adminNotes)
        .innerJoin(users, eq(users.id, adminNotes.authorId))
        .where(and(eq(adminNotes.subjectType, subjectType), eq(adminNotes.subjectId, subjectId)))
        .orderBy(desc(adminNotes.createdAt))
        .limit(100);

      const mayReadVendorNotes = mayReadPersonNotes(ctx.user.adminRole);
      const [rfq, vendor] = await Promise.all([
        notesFor('rfq', input.rfqId),
        mayReadVendorNotes ? notesFor('user', input.vendorId) : Promise.resolve([]),
      ]);
      return {
        rfq,
        vendor,
        // Not a boolean nobody reads: the screen must say "you do not have
        // permission to see these" rather than "there are none".
        vendorNotesVisible: mayReadVendorNotes,
      };
    }),

  /**
   * Add one internal note, to the RFQ or to the vendor.
   *
   * The scope is explicit and required. A note silently filed against whichever
   * subject the code happened to pick is a note nobody finds again.
   */
  addEnquiryNote: adminWith('marketplace.manage')
    .input(z.object({
      scope: z.enum(['rfq', 'vendor']),
      rfqId: z.number().int().positive(),
      vendorId: z.number().int().positive(),
      note: z.string().trim().min(1).max(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      // Writing on a PERSON needs the permission that governs the user
      // directory, exactly as admin.addUserNote does.
      if (input.scope === 'vendor' && !mayWritePersonNotes(ctx.user.adminRole)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: PERSON_NOTE_FORBIDDEN_MESSAGE });
      }

      // The subject must EXIST. Without this an administrator can file a note
      // against a typo, and it is never seen again by anyone.
      const [subject] = input.scope === 'rfq'
        ? await db.select({ id: rfqs.id }).from(rfqs).where(eq(rfqs.id, input.rfqId)).limit(1)
        : await db.select({ id: users.id }).from(users).where(eq(users.id, input.vendorId)).limit(1);
      if (!subject) throw new TRPCError({ code: 'NOT_FOUND', message: 'That subject does not exist.' });

      const result = await db.insert(adminNotes).values({
        subjectType: input.scope === 'rfq' ? 'rfq' : 'user',
        subjectId: input.scope === 'rfq' ? input.rfqId : input.vendorId,
        note: input.note,
        authorId: ctx.user.id,
      });
      return { success: true, noteId: Number(result[0]?.insertId ?? 0) };
    }),

  /** Administrators an enquiry may be handed to - those who could actually act. */
  assignableAdmins: adminWith('marketplace.manage').query(async () => {
    const db = await requireDb();
    return assignableAdmins(db);
  }),

  /**
   * ASSIGN AN ENQUIRY, OR TAKE IT BACK.
   *
   * An enquiry has no table because its state is derived; an assignment is not
   * derivable from anything, so it has one (see server/enquiryAssignment.ts for
   * why those two decisions are consistent).
   *
   * The new assignee is NOTIFIED through the existing engine - the same
   * notifyUser every other event uses, with a messageKey so the sentence is
   * translated rather than an English string stored in the row. Unassignment
   * notifies nobody: there is no one to tell, and messaging the previous
   * assignee is a behaviour the owner has not asked for.
   */
  assignEnquiry: adminWith('marketplace.manage')
    .input(z.object({
      rfqId: z.number().int().positive(),
      vendorId: z.number().int().positive(),
      assigneeId: z.number().int().positive().nullable(),
      note: z.string().trim().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      // The pair must be a real enquiry. Without this an administrator can
      // assign a typo, and it sits in a queue pointing at nothing.
      const existing = await enquiryDetail(db, { rfqId: input.rfqId, vendorId: input.vendorId });
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No enquiry exists between that vendor and that request.' });
      }

      const { assignmentId, notify } = await assignEnquiry({
        db, rfqId: input.rfqId, vendorId: input.vendorId,
        assigneeId: input.assigneeId, actorId: ctx.user.id, note: input.note ?? null,
      });

      if (notify) {
        await notifyUser(db, {
          userId: notify.userId,
          title: 'An enquiry was assigned to you',
          body: `${notify.reference} - ${existing.rfq.title ?? `RFQ #${input.rfqId}`}`,
          type: 'info',
          // THE ENQUIRY ITSELF, not the list it sits in. An existing guard
          // (server/notificationDestinations.test.ts) rejected the hardcoded
          // '/admin/enquiries', and it was right: a notification about ENQ-501-10
          // that lands on a list leaves the recipient hunting for the row. The
          // reference is exactly what makes a per-enquiry route possible without
          // a table, so the screen now reads it from the URL.
          link: `/admin/enquiries/${notify.reference}`,
          messageKey: 'notif.enquiry.assigned',
          messageParams: { reference: notify.reference, request: existing.rfq.title ?? `RFQ #${input.rfqId}` },
        });
      }
      return { success: true, assignmentId, notified: notify !== null };
    }),

  /**
   * BULK ASSIGNMENT - AND ONLY BULK ASSIGNMENT (§17).
   *
   * The brief asks for bulk actions. Most of the verbs on this screen must
   * never be bulk:
   *
   *   CLOSING is an RFQ-level act affecting every vendor on it, so a bulk close
   *     of twenty enquiries could close twenty RFQs and end hundreds of other
   *     vendors' work. There is no undo.
   *   INVITING in bulk would notify vendors who were never chosen by the
   *     requester, on the requester's behalf.
   *   ADJUSTING ALLOWANCES in bulk is a Super Admin action with a per-vendor
   *     consumption check that cannot be answered in aggregate.
   *
   * Assignment is different in every way that matters: it is reversible, it is
   * append-only so nothing is destroyed, it touches no customer or vendor
   * state, and it is the one action an operations lead genuinely performs on
   * twenty rows at once. So it is the only one offered, and the ceiling is low
   * enough that a mistaken click is a minute's work to undo.
   */
  bulkAssignEnquiries: adminWith('marketplace.manage')
    .input(z.object({
      pairs: z.array(z.object({
        rfqId: z.number().int().positive(),
        vendorId: z.number().int().positive(),
      })).min(1).max(BULK_ASSIGN_LIMIT),
      assigneeId: z.number().int().positive().nullable(),
      note: z.string().trim().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      // Eligibility is checked ONCE, before anything is written. Checking it
      // per pair would let the first fifteen succeed and the sixteenth fail on
      // a rule that was already false for all of them.
      if (input.assigneeId != null && !(await isAssignable(db, input.assigneeId))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: ASSIGNEE_INELIGIBLE_MESSAGE });
      }

      let assigned = 0;
      let unchanged = 0;
      const skipped: string[] = [];
      for (const pair of input.pairs) {
        // Each pair must be a real enquiry. A bulk action is exactly where a
        // stale selection turns into rows pointing at nothing.
        const exists = await enquiryDetail(db, pair);
        if (!exists) { skipped.push(enquiryReference(pair.rfqId, pair.vendorId)); continue; }
        const { assignmentId } = await assignEnquiry({
          db, ...pair, assigneeId: input.assigneeId, actorId: ctx.user.id, note: input.note ?? null,
        });
        if (assignmentId === 0) unchanged += 1; else assigned += 1;
      }

      // ONE notification for the batch, not one per row. Twenty notifications
      // saying the same thing is a notification nobody reads, and the
      // destination is genuinely the filtered queue rather than any single
      // enquiry - built from the assignee's own id, so it is still a record.
      if (input.assigneeId != null && assigned > 0) {
        await notifyUser(db, {
          userId: input.assigneeId,
          title: 'Enquiries were assigned to you',
          body: `${assigned} ${assigned === 1 ? 'enquiry' : 'enquiries'}`,
          type: 'info',
          link: `/admin/enquiries/assignee/${input.assigneeId}`,
          messageKey: 'notif.enquiry.assigned.bulk',
          messageParams: { count: assigned },
        });
      }
      // Honest counts: what changed, what was already so, and what could not be
      // found. A bare "success" would hide all three.
      return { success: true, assigned, unchanged, skipped };
    }),

  /**
   * EXPORT (§18).
   *
   * The same filters as the list, the same authorization, and the same columns
   * the screen shows - a CSV that contains a bid price would be the whole
   * market's bids in one file, which is precisely why the list does not carry
   * one either.
   *
   * Capped. An unbounded export is a denial-of-service against your own
   * database and a single file containing everything, and the response says
   * plainly when it was truncated rather than handing over a quiet subset.
   */
  exportEnquiries: adminWith('marketplace.manage')
    .input(z.object({
      state: z.enum(ENQUIRY_STATES).optional(),
      rfqStatus: z.enum(RFQ_STATUSES).optional(),
      vendorId: z.number().int().positive().optional(),
      rfqId: z.number().int().positive().optional(),
      assigneeId: z.number().int().positive().nullable().optional(),
      search: z.string().trim().max(200).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const page = await enquiryList(db, { ...(input ?? {}), limit: ENQUIRY_EXPORT_LIMIT, offset: 0 });

      const header = [
        'reference', 'rfqId', 'rfqTitle', 'rfqStatus', 'vendorId', 'vendor',
        'state', 'allowanceUsage', 'assignee', 'invitedAt', 'viewedAt',
        'consumedAt', 'respondedAt', 'declinedAt',
      ];
      const rows = page.rows.map(row => [
        row.reference, row.rfqId, row.rfqTitle ?? '', row.rfqStatus ?? '',
        row.vendorId, row.vendorCompany || row.vendorName || '',
        row.state, row.usageReason, row.assigneeName ?? '',
        iso(row.invitedAt), iso(row.viewedAt), iso(row.consumedAt),
        iso(row.respondedAt), iso(row.declinedAt),
      ]);

      // WHO EXPORTED WHAT, WHEN. An export is a copy of operational data
      // leaving the platform, and a trail that records reads is the only way to
      // answer that afterwards.
      //
      // NOT in commercialAuditEvents. That trail's rule - enforced by
      // server/commercialAudit.test.ts - is that subjectId always names a row in
      // the table subjectType names. An export is about no single RFQ, so the
      // only way to fit it there was `subjectId: 0`, which names nothing. The
      // guard rejected exactly that, and it was right.
      //
      // It belongs here instead, on the ADMINISTRATOR'S OWN activity, which is
      // the shape userAccountAuditEvents already uses for 'admin_signed_in':
      // userId and actorId are both the administrator, because the event is
      // something they did rather than something done to somebody.
      await recordAccountEvent(db, {
        userId: ctx.user.id,
        actorId: ctx.user.id,
        action: 'enquiries_exported',
        source: 'admin_export',
        note: `${rows.length} row(s)${page.total > rows.length ? ` of ${page.total} (truncated)` : ''}`
          + `${input?.state ? `, state=${input.state}` : ''}`
          + `${input?.vendorId ? `, vendor=${input.vendorId}` : ''}`
          + `${input?.rfqId ? `, rfq=${input.rfqId}` : ''}`,
      });

      return {
        csv: [header, ...rows].map(toCsvRow).join('\n'),
        rowCount: rows.length,
        total: page.total,
        // Named, not inferred from a length comparison the caller has to make.
        truncated: page.total > rows.length,
        limit: ENQUIRY_EXPORT_LIMIT,
      };
    }),

  placementPerformance: adminWith('marketplace.manage')
    .query(async () => ({
      rows: await placementPerformance(),
      formulas: PLACEMENT_METRIC_FORMULAS,
    })),

  bookPlacement: adminWith('marketplace.manage')
    .input(z.object({
      entityType: z.enum(['PROVIDER', 'PRODUCT']),
      entityId: z.number().int().positive(),
      package: z.enum(['BOOST', 'SPOTLIGHT', 'PREMIER']),
      surface: z.enum(['MASTER_DISCOVERY', 'TYPE_CATEGORY_SPOTLIGHT', 'SEARCH_RESULTS_BOOST']),
      source: z.enum(['PAID_SPONSORSHIP', 'ADMIN_EDITORIAL', 'REFERRAL_REWARD', 'PROMOTIONAL_COMP']),
      category: z.string().trim().min(1).max(100),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime().nullable(),
      priority: z.number().int().optional(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const result = await bookPlacement(db, {
        entityType: input.entityType,
        entityId: input.entityId,
        package: input.package,
        surface: input.surface,
        source: input.source,
        category: input.category,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        priority: input.priority,
        grantedBy: ctx.user.id,
        reason: input.reason,
      });
      if (result.outcome === 'rejected') throw new TRPCError({ code: 'CONFLICT', message: result.reason });
      await recordAccountEvent(db, {
        userId: input.entityType === 'PROVIDER' ? input.entityId : ctx.user.id,
        actorId: ctx.user.id,
        action: 'placement_booked',
        source: input.source,
        note: `${input.package} / ${input.surface} / ${input.category}`,
      });
      return { success: true, placementId: result.placementId };
    }),
  // ── QA sign-in links ────────────────────────────────────────────────────
  issueTestLoginLink: adminWith('qa.manage').input(z.object({
    userId: z.number().int().positive(),
    expiresInMinutes: z.number().int().min(1).max(TEST_LOGIN_TTL_MINUTES_MAX).default(TEST_LOGIN_TTL_MINUTES_DEFAULT),
  })).mutation(async ({ ctx, input }) => {
    assertTestLoginCapabilityEnabled();
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

    // QA personas only. A link that could sign in as a real user would be a
    // password-less backdoor into a real account, which is the entire thing
    // this design exists to avoid.
    const [target] = await db.select().from(users).where(eq(users.id, input.userId));
    if (!target?.isDummy) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sign-in links can only be issued for test accounts' });
    }
    if (target.accountStatus !== 'active' || target.deactivatedAt) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This test account is not active' });
    }

    const raw = randomBytes(TEST_LOGIN_TOKEN_BYTES).toString('base64url');
    await db.insert(testLoginTokens).values({
      tokenHash: hashTestLoginToken(raw),
      userId: target.id,
      issuedBy: ctx.user.id,
      expiresAt: new Date(Date.now() + input.expiresInMinutes * 60_000),
    });
    await recordAccountEvent(db, {
      userId: target.id, actorId: ctx.user.id, action: 'test_login_link_issued', source: 'admin',
      note: `Expires in ${input.expiresInMinutes} minute(s)`,
    });

    // The only time the raw token ever leaves this function. Not logged, not
    // stored, not recoverable - reissue if it is lost.
    return { token: raw, expiresInMinutes: input.expiresInMinutes } as const;
  }),

  testLoginLinks: adminWith('qa.manage').input(z.object({ userId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    // Explicit column list: tokenHash must never reach a client. Selecting the
    // whole row would ship it to every admin screen that renders this.
    return db.select({
      id: testLoginTokens.id,
      createdAt: testLoginTokens.createdAt,
      expiresAt: testLoginTokens.expiresAt,
      usedAt: testLoginTokens.usedAt,
      revokedAt: testLoginTokens.revokedAt,
      issuedBy: testLoginTokens.issuedBy,
    }).from(testLoginTokens)
      .where(eq(testLoginTokens.userId, input.userId))
      .orderBy(desc(testLoginTokens.createdAt))
      .limit(50);
  }),

  revokeTestLoginLink: adminWith('qa.manage').input(z.object({ tokenId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [row] = await db.select().from(testLoginTokens).where(eq(testLoginTokens.id, input.tokenId));
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such sign-in link' });
    await db.update(testLoginTokens)
      .set({ revokedAt: new Date(), revokedBy: ctx.user.id })
      .where(eq(testLoginTokens.id, input.tokenId));
    await recordAccountEvent(db, {
      userId: row.userId, actorId: ctx.user.id, action: 'test_login_link_revoked', source: 'admin',
    });
    return { success: true } as const;
  }),

  setDummyUserPassword: adminWith('qa.manage').input(z.object({
    userId: z.number().int().positive(),
    password: z.string().min(8).max(128),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select().from(users).where(eq(users.id, input.userId));
    if (!target?.isDummy) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only dummy users can have a manually managed password' });
    const passwordHash = await hashPassword(input.password);
    await db.update(users).set({ passwordHash, invitationStatus: 'password_set', invitationToken: null, invitationExpiresAt: null, passwordSetAt: new Date() }).where(eq(users.id, input.userId));
    await recordAccountEvent(db, { userId: input.userId, actorId: ctx.user.id, action: 'dummy_user_password_changed', source: 'dummy', note: 'Password updated by an administrator' });
    return { success: true };
  }),
  setDummyUserActive: adminWith('qa.manage').input(z.object({ userId: z.number().int().positive(), active: z.boolean(), note: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select().from(users).where(eq(users.id, input.userId));
    if (!target?.isDummy) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only dummy users can be changed here' });
    await db.update(users).set({ accountStatus: input.active ? 'active' : 'frozen', deactivatedAt: input.active ? null : new Date(), frozenAt: input.active ? null : new Date(), frozenReason: input.active ? null : (input.note || 'Disabled by an administrator') }).where(eq(users.id, input.userId));
    await recordAccountEvent(db, { userId: input.userId, actorId: ctx.user.id, action: input.active ? 'dummy_user_activated' : 'dummy_user_deactivated', source: 'dummy', note: input.note });
    return { success: true, active: input.active };
  }),
  deleteDummyUser: adminWith('qa.manage').input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select().from(users).where(eq(users.id, input.userId));
    if (!target?.isDummy) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only dummy users can be deleted' });
    await recordAccountEvent(db, { userId: input.userId, actorId: ctx.user.id, action: 'dummy_user_deleted', source: 'dummy', note: target.creationNote });
    try {
      await db.delete(users).where(eq(users.id, input.userId));
    } catch (err) {
      if ((err as { cause?: { code?: string } })?.cause?.code === 'ER_ROW_IS_REFERENCED_2') {
        throw new TRPCError({ code: 'CONFLICT', message: 'This dummy user still has related records (projects, quotations, messages, reviews, etc.) and cannot be deleted. Reassign or remove those records first.' });
      }
      throw err;
    }
    return { success: true };
  }),
  // Phase 4B.1 minimal administrative billing visibility. Deliberately a
  // single-vendor lookup, not a dashboard - §10 of the phase brief. Returns the
  // explicit ADMIN_SUBSCRIPTION_COLUMNS allowlist (no provider references, and
  // BuildHub stores no card/token/credential data anywhere to begin with).
  vendorBilling: adminWith('billing.read').input(z.object({ userId: z.number().int().positive() })).query(async ({ input }) => {
    // null reads as "this vendor has no subscription", which is a billing
    // statement an administrator acts on.
    const db = await requireDb();
    const [row] = await db
      .select(ADMIN_SUBSCRIPTION_COLUMNS)
      .from(vendorSubscriptions)
      .where(eq(vendorSubscriptions.userId, input.userId))
      .limit(1);
    const full = await getSubscription(input.userId);
    const state = deriveBillingState(full);
    return {
      subscription: row ?? null,
      effectivePlan: state.effectivePlan,
      storedPlan: state.storedPlan,
      isPaid: state.isPaid,
      inTrial: state.inTrial,
      trialEndsAt: state.trialEndsAt,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      currentPeriodEnd: state.currentPeriodEnd,
      inGracePeriod: state.inGracePeriod,
      gracePeriodEndsAt: state.gracePeriodEndsAt,
      founderPriceActive: state.founderPriceActive,
      founderPriceEndsAt: state.founderPriceEndsAt,
      awaitingRenewalSync: state.awaitingRenewalSync,
      // Surfaced so support can SEE a corrupt row rather than being silently
      // told the vendor is on FREE with no explanation.
      dataIntegrityIssue: state.dataIntegrityIssue,
      events: await getBillingEvents(input.userId, 50),
    };
  }),
  // Phase 4B.3: troubleshooting view for vendor targeting - declared
  // categories, and which RFQs consumed a qualified-enquiry credit. Contains
  // no payment information of any kind.
  // ── Subscription lifecycle, admin-authorized (Phase 4B.4) ──────────────
  //
  // Payment OUTCOMES are recorded here rather than by the vendor, because a
  // vendor must never be able to declare their own payment succeeded. Until
  // Phase 4B.5 wires the provider, an administrator is the only trusted
  // observer of a payment result; when the provider arrives it becomes the
  // observer and calls the very same idempotent lifecycle functions.
  //
  // These are lifecycle operations, not a billing dashboard, and they expose
  // no provider handle, price reference, or credential.

  vendorLifecycle: adminWith('billing.read')
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => getLifecycleSnapshot(input.userId)),

  // ── Qualified-enquiry allowance (Part 45) ────────────────────────────────
  //
  // Before this, a vendor's monthly lead allowance came from the plan constant
  // and there was no way to move it for one vendor. An administrator wanting to
  // grant a struggling supplier ten more leads had exactly one lever: change
  // their plan - which rewrites what they are recorded as having agreed to pay
  // and hands them every other capability of that tier.
  //
  // READ is billing.read, like every other billing view. WRITE is Super Admin
  // alone, because it is the one operation here that changes what a vendor may
  // consume. A vendor cannot reach either: they are on the admin router, and
  // vendorEntitlementOverrides has no vendor-facing write anywhere in this file.
  /**
   * ── ONE RFQ, RECONSTRUCTED (Parts 41 and 52) ────────────────────────────
   *
   * "Who did what, when, to which record, from what value to what value."
   * BuildHub could already answer each fragment of that separately - the
   * commercial audit here, the notifications there, the quotations somewhere
   * else - and could not answer the question, which is what an administrator
   * actually has in front of them when a customer and a supplier disagree.
   *
   * SUPER ADMIN ONLY. Part 41 names Super Admin, Part 51 warns against
   * sub-admins acquiring Super Admin reach, and this read deliberately crosses
   * every ownership boundary in the product at once: two parties' messages,
   * every competing bid's price, the whole audit trail. Widening it to a
   * sub-admin role is a decision for the owner, not a default.
   *
   * PART 53 IS ENFORCED BY CONSTRUCTION, not by care: every user this returns
   * goes through PARTY_COLUMNS, an explicit allowlist. `select().from(users)`
   * would carry passwordHash and a live invitationToken into an administrator's
   * browser, which is precisely the leak that allowlist exists to have already
   * prevented twice in this file.
   */
  rfqInvestigation: superAdminProcedure
    .input(z.object({ rfqId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const [rfq] = await db.select().from(rfqs).where(eq(rfqs.id, input.rfqId)).limit(1);
      if (!rfq) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });

      const bids = await db.select({
        id: quotations.id,
        providerId: quotations.providerId,
        price: quotations.price,
        currency: quotations.currency,
        timeline: quotations.timeline,
        warranty: quotations.warranty,
        validUntil: quotations.validUntil,
        commercialTerms: quotations.commercialTerms,
        paymentTerms: quotations.paymentTerms,
        notes: quotations.notes,
        status: quotations.status,
        attachments: quotations.attachments,
        createdAt: quotations.createdAt,
      }).from(quotations).where(eq(quotations.rfqId, input.rfqId)).orderBy(quotations.id);

      const enquiries = await db.select({
        id: qualifiedEnquiries.id,
        userId: qualifiedEnquiries.userId,
        yearMonth: qualifiedEnquiries.yearMonth,
        planAtConsumption: qualifiedEnquiries.planAtConsumption,
        matchedCategory: qualifiedEnquiries.matchedCategory,
        createdAt: qualifiedEnquiries.createdAt,
      }).from(qualifiedEnquiries).where(eq(qualifiedEnquiries.rfqId, input.rfqId)).orderBy(qualifiedEnquiries.id);

      const bidIds = bids.map(bid => bid.id);
      const [rfqAudit, quotationAudit, rfqHistory, quotationHistory] = await Promise.all([
        db.select().from(commercialAuditEvents)
          .where(and(eq(commercialAuditEvents.subjectType, 'rfq'), eq(commercialAuditEvents.subjectId, input.rfqId)))
          .orderBy(commercialAuditEvents.id),
        bidIds.length === 0 ? Promise.resolve([]) : db.select().from(commercialAuditEvents)
          .where(and(eq(commercialAuditEvents.subjectType, 'quotation'), inArray(commercialAuditEvents.subjectId, bidIds)))
          .orderBy(commercialAuditEvents.id),
        readFieldHistory(db, 'rfq', [input.rfqId]),
        bidIds.length === 0 ? Promise.resolve([]) : readFieldHistory(db, 'quotation', bidIds),
      ]);

      // The people involved, and only them. Not "every user", and not the
      // whole row for any of them.
      const partyIds = Array.from(new Set([rfq.requesterId, ...bids.map(b => b.providerId), ...enquiries.map(e => e.userId)]
        .filter((id): id is number => typeof id === 'number')));
      const parties = partyIds.length === 0 ? [] : await db.select(INVESTIGATION_PARTY_COLUMNS)
        .from(users).where(inArray(users.id, partyIds));

      // The conversation between the parties, and the notifications this
      // request generated - who was told what, and where the link pointed.
      const [conversation, notified] = await Promise.all([
        partyIds.length < 2 ? Promise.resolve([]) : db.select({
          id: messages.id,
          senderId: messages.senderId,
          receiverId: messages.receiverId,
          type: messages.type,
          content: messages.content,
          quotationId: messages.quotationId,
          createdAt: messages.createdAt,
        }).from(messages)
          .where(and(inArray(messages.senderId, partyIds), inArray(messages.receiverId, partyIds)))
          .orderBy(messages.id),
        partyIds.length === 0 ? Promise.resolve([]) : db.select({
          id: notifications.id,
          userId: notifications.userId,
          type: notifications.type,
          messageKey: notifications.messageKey,
          link: notifications.link,
          read: notifications.read,
          createdAt: notifications.createdAt,
        }).from(notifications)
          .where(and(
            inArray(notifications.userId, partyIds),
            sql`(${notifications.link} = ${`/rfq/${input.rfqId}`} OR ${notifications.link} IN (${bidIds.length ? sql.join(bidIds.map(id => sql`${`/quotations/${id}`}`), sql`, `) : sql`''`}))`,
          ))
          .orderBy(notifications.id),
      ]);

      return {
        rfq,
        parties,
        enquiries,
        quotations: bids,
        // OLD -> NEW, from the table that keeps values, for the request and
        // for every bid on it.
        history: { rfq: rfqHistory, quotations: quotationHistory },
        audit: [...rfqAudit, ...quotationAudit].sort((a, b) => a.id - b.id),
        messages: conversation,
        notifications: notified,
        // The commercial figures, computed here rather than in a dashboard, so
        // "what was at stake" travels with the timeline.
        commercial: {
          budget: rfq.budget,
          bidCount: bids.length,
          lowestBid: bids.length ? bids.reduce((low, bid) => Number(bid.price) < Number(low.price) ? bid : low).price : null,
          highestBid: bids.length ? bids.reduce((high, bid) => Number(bid.price) > Number(high.price) ? bid : high).price : null,
          acceptedValue: bids.find(bid => bid.status === 'accepted')?.price ?? null,
        },
      };
    }),

  vendorEnquiryAllowance: adminWith('billing.read')
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const now = new Date();
      const usage = await getEnquiryUsage(input.userId, now);
      const resolution = await resolveVendorEntitlements(input.userId, now);
      const view = await readEnquiryAllowance(db as never, input.userId, resolution.effectivePlan, usage.used, usage.periodKey, now);
      const actorIds = Array.from(new Set(view.history.map(entry => entry.actorId).filter((id): id is number => Number.isInteger(id) && id! > 0)));
      const actorRows = actorIds.length
        ? await db.select({ id: users.id, name: users.name, email: users.email, adminRole: users.adminRole })
            .from(users).where(inArray(users.id, actorIds))
        : [];
      const actorMap = new Map(actorRows.map(row => [row.id, row]));
      return {
        ...view,
        history: view.history.map(entry => {
          const actor = entry.actorId ? actorMap.get(entry.actorId) : undefined;
          return {
            ...entry,
            actorName: actor?.name ?? null,
            actorEmail: actor?.email ?? null,
            actorRole: actor?.adminRole ?? null,
          };
        }),
      };
    }),

  setVendorEnquiryLimit: superAdminProcedure
    .input(z.object({
      userId: z.number().int().positive(),
      // null = unlimited. The bounds are asserted again in setEnquiryAllowance
      // rather than trusted from here: zod guards the transport, the service
      // guards the rule, and the service is what a future caller might reach
      // by another route.
      limit: z.number().int().min(0).max(MAX_ENQUIRY_ALLOWANCE).nullable(),
      reason: z.string().max(500).optional(),
      endsAt: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const target = await db.select({ id: users.id, userRole: users.userRole })
        .from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor not found' });
      if (!providerRoles.includes(target[0].userRole as typeof providerRoles[number])) {
        // A homeowner has no enquiry allowance to raise. Refusing here keeps
        // the override table free of rows that could never take effect.
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Qualified enquiries apply to provider accounts only' });
      }

      const result = await setEnquiryAllowance({
        db: db as never,
        userId: input.userId,
        limit: input.limit,
        reason: input.reason ?? null,
        actorId: ctx.user.id,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
      });

      if (!result.ok) {
        if (result.reason === 'below_usage') {
          // THE OWNER'S DECISION, NAMED IN THE ERROR. Refusing rather than
          // accepting means an administrator cannot create an over-consumed
          // state, and the message tells them the number that made it
          // impossible instead of leaving them to guess.
          throw new TRPCError({
            code: 'CONFLICT',
            message: `This vendor has already used ${result.used} qualified ${result.used === 1 ? 'enquiry' : 'enquiries'} in ${result.periodKey}. A limit of ${result.requested} would be below what they have already consumed. Consumed enquiries are never revoked - choose ${result.used} or higher, or wait for the period to reset.`,
          });
        }
        if (result.reason === 'overflow') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `The maximum allowance is ${result.max}` });
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'A qualified-enquiry limit must be zero or a positive whole number' });
      }

      await recordAccountEvent(db, {
        userId: input.userId, actorId: ctx.user.id, action: 'enquiry_allowance_changed', source: 'admin',
        note: `${result.previous ?? 'plan default'} -> ${input.limit ?? 'unlimited'}${input.reason ? ` (${input.reason})` : ''}`,
      });
      await recordFieldChange(db, {
        subjectType: 'user', subjectId: input.userId, ownerId: input.userId, actorId: ctx.user.id,
        field: 'qualifiedEnquiriesPerMonth',
        oldValue: result.previous === null ? null : String(result.previous),
        newValue: input.limit === null ? 'unlimited' : String(input.limit),
        reason: input.reason ?? null,
      });
      return { overrideId: result.overrideId, previous: result.previous, limit: input.limit };
    }),

  // ── The operations desk (Parts 48, 49, 50) ───────────────────────────────
  //
  // Three reads that answer the questions an operator has BEFORE anything has
  // gone wrong, and the first question they have after: where is this record,
  // what is inconsistent in the data, and is this deployment actually working.
  //
  // Each was absent. The console had a Fraud Detection tab that could never
  // show anything and no way at all to turn a customer's name into the record
  // id every other admin screen demands.

  /**
   * FIND THE RECORD (Part 48).
   *
   * Per-segment permissions, decided inside runPlatformSearch from the role on
   * the row - not here, and not by the client. `audit.read` is the floor to
   * reach the endpoint at all, because an administrator holding none of the
   * five segment permissions has no business issuing the query; one holding
   * some gets exactly those segments and is TOLD which ones were withheld.
   */
  platformSearch: adminProcedure
    .input(z.object({ query: z.string().min(1).max(MAX_SEARCH_LENGTH) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return runPlatformSearch(db, ctx.user.adminRole, input.query);
    }),

  /**
   * VENDOR LOOKUP BY BUSINESS IDENTITY, not by remembered database id.
   *
   * An administrator taking a billing or support action has a name, a company
   * or an email - not a row id. This returns provider accounts matching any of
   * those, with enough identity to disambiguate and no credential column.
   */
  vendorSearch: adminProcedure
    .input(z.object({ query: z.string().min(1).max(MAX_SEARCH_LENGTH) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const canRead = hasAdminPermission(ctx.user.adminRole, 'users.read')
        || hasAdminPermission(ctx.user.adminRole, 'billing.read');
      if (!canRead) return [];
      const term = containsTerm(input.query.trim());
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          userRole: users.userRole,
          location: users.location,
          verified: users.verified,
          accountStatus: users.accountStatus,
          companyName: vendorProfiles.companyName,
          tradingName: vendorProfiles.tradingName,
        })
        .from(users)
        .leftJoin(vendorProfiles, eq(vendorProfiles.userId, users.id))
        .where(and(
          inArray(users.userRole, providerRoles),
          or(
            like(users.name, term),
            like(users.email, term),
            like(vendorProfiles.companyName, term),
            like(vendorProfiles.tradingName, term),
          ),
        ))
        .orderBy(desc(users.id))
        .limit(10);
      return rows.map(row => ({
        id: row.id,
        name: row.name ?? `#${row.id}`,
        email: row.email ?? null,
        userRole: row.userRole ?? null,
        location: row.location ?? null,
        verified: row.verified ?? null,
        accountStatus: row.accountStatus ?? null,
        companyName: row.companyName ?? null,
        tradingName: row.tradingName ?? null,
      }));
    }),

  projects: adminWith('users.read').query(async () => {
    const db = await requireDb();
    const rows = await db.select({
      id: projects.id,
      title: projects.title,
      type: projects.type,
      status: projects.status,
      location: projects.location,
      progress: projects.progress,
      ownerId: projects.ownerId,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    }).from(projects).orderBy(desc(projects.updatedAt)).limit(250);
    const ownerIds = Array.from(new Set(rows.map(row => row.ownerId).filter((id): id is number => Number.isInteger(id) && id > 0)));
    const ownerRows = ownerIds.length
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ownerIds))
      : [];
    const ownerNames = new Map(ownerRows.map(row => [row.id, row.name]));
    return rows.map(row => ({ ...row, ownerName: ownerNames.get(row.ownerId) ?? null }));
  }),

  products: adminWith('marketplace.manage').query(async () => {
    const db = await requireDb();
    const rows = await db.select({
      id: products.id,
      name: products.name,
      brand: products.brand,
      category: products.category,
      active: products.active,
      featured: products.featured,
      price: products.price,
      stock: products.stock,
      supplierId: products.supplierId,
      createdAt: products.createdAt,
    }).from(products).orderBy(desc(products.createdAt)).limit(250);
    const supplierIds = Array.from(new Set(rows.map(row => row.supplierId).filter((id): id is number => Number.isInteger(id) && id > 0)));
    const supplierRows = supplierIds.length
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, supplierIds))
      : [];
    const supplierNames = new Map(supplierRows.map(row => [row.id, row.name]));
    return rows.map(row => ({ ...row, supplierName: supplierNames.get(row.supplierId) ?? null }));
  }),

  projectDetail: adminWith('users.read').input(z.object({ projectId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [project] = await db.select({
      id: projects.id,
      title: projects.title,
      description: projects.description,
      type: projects.type,
      status: projects.status,
      location: projects.location,
      budget: projects.budget,
      progress: projects.progress,
      ownerId: projects.ownerId,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
    if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });

    const [ownerRows] = await Promise.all([
      project.ownerId
        ? db.select({ id: users.id, name: users.name, email: users.email, userRole: users.userRole })
            .from(users).where(eq(users.id, project.ownerId)).limit(1)
        : Promise.resolve([]),
    ]);
    const members = await db.select({
      id: projectMembers.id,
      userId: projectMembers.userId,
      projectRole: projectMembers.projectRole,
      assignedAt: projectMembers.assignedAt,
      name: users.name,
      userRole: users.userRole,
      verified: users.verified,
    }).from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(and(eq(projectMembers.projectId, input.projectId), isNull(projectMembers.removedAt)));

    const [rfqRows, documentRows, disputeRows] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(rfqs).where(eq(rfqs.projectId, input.projectId)),
      db.select({ count: sql<number>`count(*)` }).from(documents).where(eq(documents.projectId, input.projectId)),
      db.select({ count: sql<number>`count(*)` }).from(disputes).where(eq(disputes.projectId, input.projectId)),
    ]);

    return {
      ...project,
      owner: ownerRows[0] ?? null,
      members,
      counts: {
        rfqs: Number(rfqRows[0]?.count ?? 0),
        documents: Number(documentRows[0]?.count ?? 0),
        disputes: Number(disputeRows[0]?.count ?? 0),
      },
    };
  }),

  vendorNameChanges: adminWith('marketplace.manage').query(async () => {
    const db = await requireDb();
    const rows = await db.select({
      id: vendorNameChangeRequests.id,
      userId: vendorNameChangeRequests.userId,
      field: vendorNameChangeRequests.field,
      currentValue: vendorNameChangeRequests.currentValue,
      requestedValue: vendorNameChangeRequests.requestedValue,
      reason: vendorNameChangeRequests.reason,
      status: vendorNameChangeRequests.status,
      reviewerId: vendorNameChangeRequests.reviewerId,
      reviewerNote: vendorNameChangeRequests.reviewerNote,
      reviewedAt: vendorNameChangeRequests.reviewedAt,
      adminCorrection: vendorNameChangeRequests.adminCorrection,
      createdAt: vendorNameChangeRequests.createdAt,
      userName: users.name,
      userEmail: users.email,
      companyName: vendorProfiles.companyName,
      tradingName: vendorProfiles.tradingName,
    }).from(vendorNameChangeRequests)
      .innerJoin(users, eq(users.id, vendorNameChangeRequests.userId))
      .leftJoin(vendorProfiles, eq(vendorProfiles.userId, vendorNameChangeRequests.userId))
      .orderBy(desc(vendorNameChangeRequests.createdAt))
      .limit(250);
    return rows;
  }),

  reviewVendorNameChange: adminWith('marketplace.manage')
    .input(z.object({
      requestId: z.number().int().positive(),
      status: z.enum(['under_review', 'needs_information', 'approved', 'rejected']),
      reviewerNote: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [request] = await db.select().from(vendorNameChangeRequests).where(eq(vendorNameChangeRequests.id, input.requestId));
      if (!request) throw new TRPCError({ code: 'NOT_FOUND', message: 'Name change request not found' });
      if (['approved', 'rejected'].includes(request.status)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This request has already been decided' });
      }

      if (input.status === 'approved') {
        const patch = request.field === 'companyName'
          ? { companyName: request.requestedValue }
          : { tradingName: request.requestedValue };
        const [profile] = await db.select({ id: vendorProfiles.id })
          .from(vendorProfiles).where(eq(vendorProfiles.userId, request.userId)).limit(1);
        if (profile) {
          await db.update(vendorProfiles).set(patch).where(eq(vendorProfiles.userId, request.userId));
        } else {
          await db.insert(vendorProfiles).values({ userId: request.userId, ...patch });
        }
      }

      await db.update(vendorNameChangeRequests).set({
        status: input.status,
        reviewerId: ctx.user.id,
        reviewerNote: input.reviewerNote ?? null,
        reviewedAt: new Date(),
      }).where(eq(vendorNameChangeRequests.id, input.requestId));
      await recordAccountEvent(db, {
        userId: request.userId,
        actorId: ctx.user.id,
        action: `vendor_name_change_${input.status}`,
        source: 'vendor_name_change',
        note: `${request.field}: ${request.currentValue ?? '—'} -> ${request.requestedValue}${input.reviewerNote ? ` (${input.reviewerNote})` : ''}`,
      });
      await notifyUser(db, {
        userId: request.userId,
        title: input.status === 'approved' ? 'Vendor name change approved' : 'Vendor name change update',
        body: input.reviewerNote || `Your name change request is now ${input.status.replaceAll('_', ' ')}`,
        type: 'admin',
        // The decision is ABOUT the request, and the request is rendered in
        // one place. Bare '/settings' landed the vendor at the top of a long
        // page with no indication of what had been decided.
        link: '/settings#settings-name-change',
        // Approved is its own sentence: it names the value now in force, which
        // is the fact the vendor actually wants. The other outcomes report the
        // status instead, because there is no new value to report.
        messageKey: input.status === 'approved' ? 'notif.vendorName.approved' : 'notif.vendorName.reviewed',
        messageParams: input.status === 'approved'
          ? { fieldKey: `vendorField.${request.field}`, value: request.requestedValue }
          : { fieldKey: `vendorField.${request.field}`, statusKey: `vendorNameStatus.${input.status}` },
      });
      return { success: true, status: input.status };
    }),

  directVendorNameCorrection: adminWith('marketplace.manage')
    .input(z.object({
      userId: z.number().int().positive(),
      field: z.enum(['companyName', 'tradingName']),
      requestedValue: z.string().trim().min(1).max(191),
      reason: z.string().trim().min(1).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [target] = await db.select({ id: users.id, userRole: users.userRole })
        .from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor not found' });
      if (!providerRoles.includes(target.userRole as typeof providerRoles[number])) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only provider accounts have vendor names' });
      }

      const [profile] = await db.select({
        id: vendorProfiles.id,
        companyName: vendorProfiles.companyName,
        tradingName: vendorProfiles.tradingName,
      }).from(vendorProfiles).where(eq(vendorProfiles.userId, input.userId)).limit(1);
      const currentValue = profile ? (profile as any)[input.field] ?? null : null;
      const patch = input.field === 'companyName'
        ? { companyName: input.requestedValue }
        : { tradingName: input.requestedValue };
      if (profile) {
        await db.update(vendorProfiles).set(patch).where(eq(vendorProfiles.userId, input.userId));
      } else {
        await db.insert(vendorProfiles).values({ userId: input.userId, ...patch });
      }

      const result = await db.insert(vendorNameChangeRequests).values({
        userId: input.userId,
        field: input.field,
        currentValue,
        requestedValue: input.requestedValue,
        reason: input.reason,
        status: 'approved',
        reviewerId: ctx.user.id,
        reviewerNote: input.reason,
        reviewedAt: new Date(),
        adminCorrection: true,
      });
      await recordAccountEvent(db, {
        userId: input.userId,
        actorId: ctx.user.id,
        action: 'vendor_name_direct_correction',
        source: 'vendor_name_change',
        note: `${input.field}: ${currentValue ?? '—'} -> ${input.requestedValue} (${input.reason})`,
      });
      await notifyUser(db, {
        userId: input.userId,
        title: 'Vendor name corrected',
        body: `Your ${input.field === 'companyName' ? 'company name' : 'trading name'} was corrected by an administrator.`,
        type: 'admin',
        // A correction changed the COMPANY RECORD, so the destination is the
        // company details section that now shows the corrected value - not the
        // request form, which the vendor never submitted here.
        link: '/settings#settings-company',
        messageKey: 'notif.vendorName.corrected',
        messageParams: { fieldKey: `vendorField.${input.field}`, value: input.requestedValue },
      });
      return { success: true, requestId: Number(result[0]?.insertId ?? 0) };
    }),

  /**
   * WHAT IS WRONG WITH THE DATA (Part 49).
   *
   * `audit.read`, the permission that already governs the platform-wide
   * analytics and the commercial audit feed. The response carries record IDS
   * and counts and no field values at all - see server/admin/dataQuality.ts for
   * why that boundary is where it is.
   */
  dataQuality: adminWith('audit.read')
    .input(z.object({ includeDummy: z.boolean().default(false) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const checks = await runDataQualityChecks(db, input?.includeDummy ?? false);
      return { includeDummy: input?.includeDummy ?? false, checks };
    }),

  /**
   * IS THIS DEPLOYMENT WORKING (Part 50).
   *
   * Every dependency is a BOOLEAN. No host, bucket, region, key, URL or driver
   * error string crosses this boundary, and the screen says NOT CONFIGURED
   * rather than showing a green tick for the SMTP and object storage that are
   * genuinely unset on staging.
   */
  operationalHealth: adminWith('audit.read').query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    return readOperationalHealth(db);
  }),

  startVendorTrial: adminWith('billing.manage')
    .input(z.object({
      userId: z.number().int().positive(),
      plan: z.enum(['professional', 'premium']),
      interval: z.enum(['month', 'year']),
    }))
    .mutation(async ({ ctx, input }) => lifecycleResult(await startPaidTrial({
      userId: input.userId, planId: input.plan, interval: input.interval,
      source: 'admin', actorId: ctx.user.id,
    }))),

  changeVendorPlan: adminWith('billing.manage')
    .input(z.object({ userId: z.number().int().positive(), plan: z.enum(['professional', 'premium']) }))
    .mutation(async ({ ctx, input }) => lifecycleResult(await changeVendorPlan({
      userId: input.userId, targetPlan: input.plan, source: 'admin', actorId: ctx.user.id,
    }))),

  /**
   * ── SUPER ADMIN MANUAL PLAN / MEMBERSHIP CHANGE ─────────────────────────
   *
   * PERMISSION IS `billing.manage`, which SUPER_ADMIN and BILLING_ADMIN hold
   * and USER_ADMIN, MARKETPLACE_ADMIN and SUPPORT_ADMIN do not. That is a
   * deliberate reading of the existing model rather than a new rule: granting
   * a paid plan IS a billing operation, and the role whose whole purpose is
   * billing already carries the permission to perform one. A support admin who
   * can read a vendor's billing state still cannot change it.
   *
   * IT DOES NOT TOUCH `users.userRole`. A membership is a subscription. The
   * temptation - make the vendor a "premium role" - would conflate what
   * someone IS with what they have paid for, and every entitlement check in
   * this codebase reads the subscription, so the role edit would grant nothing
   * while corrupting the account.
   *
   * IT DOES NOT TOUCH USAGE. Qualified enquiries already consumed this period
   * stay consumed: `qualifiedEnquiries` rows are never written here, so a
   * vendor who used 7 of 20 and is moved to a 50-lead plan has 43 remaining,
   * not 50. Revoking or resetting consumption would rewrite history the vendor
   * already acted on.
   *
   * THREE RECORDS, EACH ANSWERING A DIFFERENT QUESTION:
   *   billingEvents          the commercial trail - what the engine did
   *   userAccountAuditEvents the account trail - what an administrator did
   *   fieldValueHistory      the value trail - old -> new, with the reason
   */
  /**
   * ── SPONSORSHIP AS AN ADMINISTRATIVE ACT ────────────────────────────────
   *
   * `marketplace.manage`, which SUPER_ADMIN and MARKETPLACE_ADMIN hold. That
   * is a reading of the existing role model rather than a new rule: a
   * sponsored slot is a placement decision in the marketplace, and the role
   * whose purpose is the marketplace already carries the permission to make
   * one. Billing, user and support admins cannot.
   *
   * A REASON IS REQUIRED. A sponsored slot is a commercial arrangement, and
   * one with no recorded justification is exactly the unauditable favour this
   * table exists to prevent.
   */
  grantSponsorship: adminWith('marketplace.manage')
    .input(z.object({
      vendorId: z.number().int().positive(),
      category: z.string().min(1).max(100),
      reason: z.string().trim().min(1).max(500),
      priority: z.number().int().min(0).max(100).optional(),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const result = await grantSponsorship({
        db,
        vendorId: input.vendorId,
        category: input.category,
        grantedBy: ctx.user.id,
        reason: input.reason,
        priority: input.priority,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
      });
      if (result.outcome === 'rejected') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
      }

      // The account trail, alongside the sponsorship row itself: one records
      // the arrangement, the other records that an administrator made it.
      await recordAccountEvent(db, {
        userId: input.vendorId, actorId: ctx.user.id,
        action: 'sponsorship_granted', source: 'admin',
        note: `${input.category}${input.endsAt ? ` until ${input.endsAt}` : ' (open-ended)'} (${input.reason})`,
      });
      return result;
    }),

  revokeSponsorship: adminWith('marketplace.manage')
    .input(z.object({ sponsorshipId: z.number().int().positive(), reason: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      // Read the vendor BEFORE revoking, so the audit event can name them even
      // though the revocation itself only needs the sponsorship id.
      const [row] = await db.select({ vendorId: vendorSponsorships.vendorId, category: vendorSponsorships.category })
        .from(vendorSponsorships).where(eq(vendorSponsorships.id, input.sponsorshipId)).limit(1);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sponsorship not found' });

      const revoked = await revokeSponsorship(db, input.sponsorshipId, ctx.user.id);
      if (!revoked) {
        // Already revoked. Reported rather than silently re-stamped, so the
        // moment the decision was taken survives.
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That sponsorship is already revoked.' });
      }

      await recordAccountEvent(db, {
        userId: row.vendorId, actorId: ctx.user.id,
        action: 'sponsorship_revoked', source: 'admin',
        note: `${row.category}${input.reason ? ` (${input.reason})` : ''}`,
      });
      return { success: true as const };
    }),

  /**
   * Which vendors are sponsored, in which category, for what period, and by
   * what action - the whole question, which is why revoked and elapsed grants
   * are included rather than filtered out. `live` says which is which.
   */
  sponsorships: adminWith('marketplace.manage').query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    return listSponsorships(db);
  }),

  /**
   * ── EDITORIAL FEATURED PROVIDERS, AS AN ADMIN ACT ───────────────────────
   *
   * Featured is distinct from sponsorship: no commercial reason is required
   * because nothing is being sold - an administrator is choosing what the
   * marketplace showcases. The same `marketplace.manage` permission applies.
   */
  featureVendor: adminWith('marketplace.manage')
    .input(z.object({
      vendorId: z.number().int().positive(),
      category: z.string().min(1).max(100),
      priority: z.number().int().min(0).max(100).optional(),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const result = await featureVendor({
        db,
        vendorId: input.vendorId,
        category: input.category,
        featuredBy: ctx.user.id,
        priority: input.priority,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
      });
      if (result.outcome === 'rejected') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.reason });
      }
      await recordAccountEvent(db, {
        userId: input.vendorId, actorId: ctx.user.id,
        action: 'featured_granted', source: 'admin',
        note: input.category,
      });
      return result;
    }),

  unfeatureVendor: adminWith('marketplace.manage')
    .input(z.object({ placementId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [row] = await db
        .select({ vendorId: vendorSponsorships.vendorId, category: vendorSponsorships.category, kind: vendorSponsorships.kind })
        .from(vendorSponsorships).where(eq(vendorSponsorships.id, input.placementId)).limit(1);
      if (!row || row.kind !== 'featured') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Featured placement not found' });
      }
      const removed = await revokeSponsorship(db, input.placementId, ctx.user.id);
      if (!removed) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That featured placement is already removed.' });
      }
      await recordAccountEvent(db, {
        userId: row.vendorId, actorId: ctx.user.id,
        action: 'featured_removed', source: 'admin',
        note: row.category,
      });
      return { success: true as const };
    }),

  featuredProviders: adminWith('marketplace.manage').query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    return listFeaturedPlacements(db);
  }),

  /**
   * EDITORIAL / ADMIN-CURATED FEATURED PRODUCT.
   *
   * `products.featured` existed and the marketplace sorted by it, but nothing
   * could ever set it, so no product was ever actually featured. Featured is a
   * marketplace curation decision (distinct from sponsorship, which is paid
   * placement), so it sits behind `marketplace.manage` - the same permission
   * grantSponsorship already uses - and never changes product ownership.
   */
  setProductFeatured: adminWith('marketplace.manage')
    .input(z.object({ productId: z.number().int().positive(), featured: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [product] = await db
        .select({ id: products.id, supplierId: products.supplierId, featured: products.featured })
        .from(products).where(eq(products.id, input.productId)).limit(1);
      if (!product) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
      if (product.featured === input.featured) {
        return { productId: input.productId, featured: input.featured };
      }

      await db.update(products).set({ featured: input.featured }).where(eq(products.id, input.productId));
      await recordFieldChange(db, {
        subjectType: 'product', subjectId: input.productId,
        ownerId: product.supplierId, actorId: ctx.user.id,
        field: 'featured', oldValue: String(product.featured), newValue: String(input.featured),
      });
      await recordCommercialEvent(db, {
        actorId: ctx.user.id, ownerId: product.supplierId,
        subjectType: 'product', subjectId: input.productId,
        action: input.featured ? 'product_featured' : 'product_unfeatured',
      });
      return { productId: input.productId, featured: input.featured };
    }),

  /**
   * The catalogue rows a marketplace admin may curate, with enough identity to
   * act (supplier name, active, featured) but no credentials or private buyer
   * data. Featured first, so the list is ordered the same way the public
   * marketplace shows them.
   */
  marketplaceProducts: adminWith('marketplace.manage').query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    return db.select({
      id: products.id,
      name: products.name,
      nameAr: products.nameAr,
      category: products.category,
      active: products.active,
      featured: products.featured,
      supplierId: products.supplierId,
      supplierName: users.name,
    }).from(products)
      .leftJoin(users, eq(products.supplierId, users.id))
      .orderBy(desc(products.featured), desc(products.createdAt))
      .limit(200);
  }),

  setVendorPlanManually: adminWith('billing.manage')
    .input(z.object({
      userId: z.number().int().positive(),
      // FREE is accepted here, unlike `changeVendorPlan`. The engine turns it
      // into the cancellation it actually is; see setVendorPlanManually.
      plan: z.enum(['free', 'professional', 'premium']),
      interval: z.enum(['month', 'year']).optional(),
      // REQUIRED, and non-empty after trimming. An unexplained manual grant is
      // the thing this whole capability was built to avoid being.
      reason: z.string().trim().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      const [target] = await db.select({ id: users.id, userRole: users.userRole })
        .from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor not found' });
      if (!providerRoles.includes(target.userRole as typeof providerRoles[number])) {
        // A homeowner has no vendor subscription and no entitlement that a plan
        // would change. Refusing keeps subscription rows off accounts that can
        // never use one, rather than creating a plan nobody can consume.
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Plans apply to provider accounts only' });
      }

      const outcome = await setVendorPlanManually({
        userId: input.userId,
        targetPlan: input.plan,
        interval: input.interval,
        reason: input.reason,
        actorId: ctx.user.id,
      });

      if (outcome.outcome === 'rejected') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: outcome.reason });
      }

      // NOTHING CHANGED, SO NOTHING IS RECORDED AND NOBODY IS TOLD. Selecting
      // the plan a vendor already has must not write an audit event describing
      // a change that did not happen, and must not send them a notification
      // about it. This is the single branch that guarantees both.
      if (outcome.outcome === 'noop') {
        return { ...lifecycleResult(outcome), notified: false };
      }

      const from = outcome.previousPlan ?? 'free';
      const to = outcome.state.storedPlan;

      await recordAccountEvent(db, {
        userId: input.userId,
        actorId: ctx.user.id,
        action: 'plan_changed_manually',
        source: 'admin',
        note: `${from} -> ${to} (${input.reason})`,
      });
      await recordFieldChange(db, {
        subjectType: 'subscription',
        subjectId: input.userId,
        ownerId: input.userId,
        actorId: ctx.user.id,
        field: 'plan',
        oldValue: from,
        newValue: to,
        reason: input.reason,
      });

      // ── THE MESSAGE, BUILT FROM WHAT ACTUALLY HAPPENED ──────────────────
      //
      // Three outcomes, three sentences, and the plan is never hard-coded into
      // any of them: `planKey` names the plan and the reader's own client
      // resolves it, so an Arabic-speaking vendor reads an Arabic plan name.
      //
      // WHICH of the three is the ENGINE's answer, not one derived here. An
      // earlier version compared plan strings in this file - and comparing
      // plans outside the engine is exactly what billingAuthorization's
      // "no scattered plan checks" rule forbids. The engine knows which branch
      // it took; there is nothing for the router to work out.
      //
      // `scheduled_end` is not a cosmetic variant. Selecting FREE while paid
      // access is live does NOT end it today - the vendor keeps the period they
      // paid for - and telling them their plan is now Free would be false.
      const direction = outcome.planChange === 'scheduled_end' ? 'scheduled' : outcome.planChange ?? 'downgraded';

      await notifyUser(db, {
        userId: input.userId,
        // English prose for a client too old to know the key. The plan name is
        // resolved from the same value the key-form uses, never from a literal.
        title: direction === 'scheduled' ? 'Your plan will end' : `Your plan is now ${to}`,
        body: direction === 'scheduled'
          ? 'Your paid plan will not renew. You keep it until the end of the period you have paid for.'
          : `An administrator changed your plan from ${from} to ${to}.`,
        type: 'billing',
        // Deep link to the Plan & Billing section itself, not to the top of a
        // settings page the vendor then has to hunt through.
        link: '/settings#settings-billing',
        messageKey: `notif.billing.plan.${direction}`,
        messageParams: {
          planKey: `billing.plan.${to}`,
          fromPlanKey: `billing.plan.${from}`,
        },
      });

      return { ...lifecycleResult(outcome), notified: true };
    }),

  recordVendorPaymentSucceeded: adminWith('billing.manage')
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => lifecycleResult(await recordPaymentSucceeded({
      userId: input.userId, source: 'admin', actorId: ctx.user.id,
    }))),

  recordVendorPaymentFailed: adminWith('billing.manage')
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => lifecycleResult(await recordPaymentFailure({
      userId: input.userId, source: 'admin', actorId: ctx.user.id,
    }))),

  recordVendorPaymentRecovered: adminWith('billing.manage')
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => lifecycleResult(await recordPaymentRecovery({
      userId: input.userId, source: 'admin', actorId: ctx.user.id,
    }))),

  reconcileVendorBilling: adminWith('billing.manage')
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => lifecycleResult(await reconcileSubscription({
      userId: input.userId, source: 'admin', actorId: ctx.user.id,
    }))),

  // The sweep's manual trigger. BuildHub has no job runner, so this is not
  // scheduled - and deliberately does not need to be: entitlements already
  // lapse on time without it (Phase 4B.4 §3).
  reconcileDueBilling: adminWith('billing.manage').mutation(async () => reconcileDueSubscriptions({})),

  vendorTargeting: adminWith('marketplace.manage').input(z.object({ userId: z.number().int().positive() })).query(async ({ input }) => {
    const [diagnostics, usage] = await Promise.all([
      getVendorTargetingDiagnostics(input.userId),
      getEnquiryUsage(input.userId),
    ]);
    return { ...diagnostics, usage };
  }),
  accountAudit: adminWith('users.read').input(z.object({ userId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await requireDb();
    return db.select().from(userAccountAuditEvents).where(eq(userAccountAuditEvents.userId, input.userId)).orderBy(desc(userAccountAuditEvents.createdAt)).limit(100);
  }),
  analyticsSummary: adminWith('audit.read').input(z.object({ includeDummy: z.boolean().default(false) }).optional()).query(async ({ input }) => {
    const db = await requireDb();
    const dummyRows = await db.select({ id: users.id }).from(users).where(eq(users.isDummy, true));
    const dummyIds = dummyRows.map(row => row.id);
    const userRows = await db.select({ createdAt: users.createdAt, isDummy: users.isDummy }).from(users).where(input?.includeDummy ? undefined : eq(users.isDummy, false));
    const projectRows = await db.select({ createdAt: projects.createdAt, ownerId: projects.ownerId }).from(projects).where(input?.includeDummy || !dummyIds.length ? undefined : notInArray(projects.ownerId, dummyIds));
    
    const monthlyMap: Record<string, { users: number; projects: number }> = {};
    for (const u of userRows) {
      const month = new Date(u.createdAt).toISOString().slice(0, 7);
      if (!monthlyMap[month]) monthlyMap[month] = { users: 0, projects: 0 };
      monthlyMap[month].users += 1;
    }
    for (const p of projectRows) {
      const month = new Date(p.createdAt).toISOString().slice(0, 7);
      if (!monthlyMap[month]) monthlyMap[month] = { users: 0, projects: 0 };
      monthlyMap[month].projects += 1;
    }
    const sortedMonths = Object.keys(monthlyMap).sort();
    // Slice 7: this used to return a single row labelled '2026-07' - a
    // hardcoded month that no data supported - whenever there was nothing to
    // aggregate. With the invented MONTHLY_USERS fallback removed in Slice 4,
    // that fabricated label became the visible thing. An empty result is the
    // honest answer, and the dashboard renders an explicit empty state for it.
    if (sortedMonths.length === 0) return [];
    return sortedMonths.map(month => ({
      month,
      users: monthlyMap[month].users,
      projects: monthlyMap[month].projects,
    }));
  }),
  /**
   * Product analytics (Slice 7). Admin-only, no input beyond a window, and it
   * returns aggregates - never a per-user event list, which would be a
   * behavioural dossier on identifiable people with no operational purpose.
   */
  productAnalytics: adminWith('marketplace.manage')
    .input(z.object({
      includeDummy: z.boolean().default(false),
      windowDays: z.number().int().min(1).max(365).default(30),
    }).optional())
    .query(async ({ input }) => {
      const includeDummy = input?.includeDummy ?? false;
      const windowDays = input?.windowDays ?? 30;
      const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

      const [funnel, eventCounts, daysToVerified, daysToFirstQuotation] = await Promise.all([
        getVendorFunnel({ includeDummy }),
        getEventCounts({ since }),
        getMedianDaysToMilestone(ANALYTICS_EVENTS.VENDOR_VERIFIED, { includeDummy }),
        getMedianDaysToMilestone(ANALYTICS_EVENTS.QUOTATION_SUBMITTED, { includeDummy }),
      ]);

      return {
        windowDays,
        funnel,
        eventCounts,
        // null means nobody has completed the milestone yet, which is a
        // different statement from "it takes zero days".
        medianDaysToVerified: daysToVerified,
        medianDaysToFirstQuotation: daysToFirstQuotation,
      };
    }),

  /**
   * Commercial KPIs. Computed from vendorSubscriptions and priced from
   * shared/billing.ts - never from the event stream, and never hardcoded.
   */
  commercialKpis: adminWith('billing.read')
    .input(z.object({
      includeDummy: z.boolean().default(false),
      churnWindowDays: z.number().int().min(7).max(365).default(30),
    }).optional())
    .query(async ({ input }) => {
      const includeDummy = input?.includeDummy ?? false;
      const churnWindowDays = input?.churnWindowDays ?? 30;
      const to = new Date();
      const from = new Date(to.getTime() - churnWindowDays * 24 * 60 * 60 * 1000);

      const [kpis, churn] = await Promise.all([
        getCommercialKpis({ includeDummy }),
        getChurn({ from, to, includeDummy }),
      ]);

      return { ...kpis, churn: { ...churn, windowDays: churnWindowDays } };
    }),

  // SECURITY (Phase 4A cumulative final audit): same passwordHash/invitationToken
  // exposure risk as ADMIN_DIRECTORY_COLUMNS, found independently in the
  // two Compliance Queue endpoints below - both previously did a bare
  // `select().from(users)` and spread the full row (including passwordHash and
  // the live, still-usable invitationToken bearer credential) into the admin
  // dashboard's Compliance Queue / Applicant Detail response. Every field here
  // is traced to real consumption in client/src/pages/AdminDashboard.tsx's
  // compliance queue list, registration CSV export (shared/registrationMetrics.ts),
  // and the applicant detail dialog.
  complianceQueue: adminWith('marketplace.manage').input(z.object({ includeDummy: z.boolean().default(false) }).optional()).query(async ({ input }) => {
    const db = await requireDb();
    const applicantFilter = input?.includeDummy ? inArray(users.userRole, providerRoles) : and(inArray(users.userRole, providerRoles), eq(users.isDummy, false));
    const applicants = await db.select(COMPLIANCE_APPLICANT_COLUMNS).from(users).where(applicantFilter);
    const docs = await db.select().from(registrationDocuments).orderBy(desc(registrationDocuments.createdAt));
    return applicants.map(applicant => ({
      ...applicant,
      requirements: getComplianceRequirements(applicant.userRole),
      documents: docs.filter(document => document.userId === applicant.id),
    })).filter(applicant => applicant.onboardingStatus !== 'approved' || applicant.documents.length > 0);
  }),
  complianceApplicant: adminWith('marketplace.manage').input(z.object({ userId: z.number() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [applicant] = await db.select(COMPLIANCE_APPLICANT_COLUMNS).from(users).where(eq(users.id, input.userId));
    if (!applicant || !isComplianceRole(applicant.userRole)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Compliance applicant not found' });
    const docs = await db.select().from(registrationDocuments).where(eq(registrationDocuments.userId, input.userId)).orderBy(desc(registrationDocuments.createdAt));
    const history = await db.select().from(registrationDocumentSubmissions).where(eq(registrationDocumentSubmissions.userId, input.userId)).orderBy(desc(registrationDocumentSubmissions.createdAt)).limit(100);
    const events = await db.select().from(registrationReviewEvents).where(eq(registrationReviewEvents.userId, input.userId)).orderBy(desc(registrationReviewEvents.createdAt)).limit(100);
    return { applicant, requirements: getComplianceRequirements(applicant.userRole), documents: docs, history, events };
  }),
  reviewComplianceDocument: adminWith('marketplace.manage').input(z.object({
    documentId: z.number(),
    status: z.enum(['under_review', 'approved', 'rejected', 'update_required']),
    reviewerNote: z.string().max(2000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [document] = await db.select().from(registrationDocuments).where(eq(registrationDocuments.id, input.documentId));
    if (!document) throw new TRPCError({ code: 'NOT_FOUND', message: 'Registration document not found' });
    const [applicant] = await db.select().from(users).where(eq(users.id, document.userId));
    if (!applicant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Applicant not found' });
    await db.update(registrationDocuments).set({ status: input.status, reviewerNote: input.reviewerNote ?? null, reviewedBy: ctx.user.id, reviewedAt: new Date() }).where(eq(registrationDocuments.id, input.documentId));
    await db.update(registrationDocumentSubmissions).set({ status: input.status }).where(eq(registrationDocumentSubmissions.documentId, input.documentId));
    const allDocs = await db.select({ documentType: registrationDocuments.documentType, status: registrationDocuments.status }).from(registrationDocuments).where(eq(registrationDocuments.userId, applicant.id));
    const overallStatus = getOverallComplianceStatus(applicant.userRole, allDocs, input.status);
    await db.update(users).set({ onboardingStatus: overallStatus, onboardingReviewNotes: input.reviewerNote ?? null, onboardingReviewedAt: new Date(), onboardingReviewedBy: ctx.user.id, verified: overallStatus === 'approved' }).where(eq(users.id, applicant.id));
    await db.insert(registrationReviewEvents).values({ userId: applicant.id, documentId: document.id, actorId: ctx.user.id, action: 'document_reviewed', status: input.status, note: input.reviewerNote });
    const title = input.status === 'approved' ? 'Registration document approved' : input.status === 'update_required' ? 'Registration document update required' : input.status === 'rejected' ? 'Registration document rejected' : 'Registration document under review';
    const body = input.reviewerNote ? `${document.displayName}: ${input.reviewerNote}` : `${document.displayName} status changed to ${input.status.replace('_', ' ')}`;
    await notifyUser(db, { userId: applicant.id, title, body, type: 'compliance', link: '/compliance', messageKey: `notif.compliance.document.${input.status}`, messageParams: { document: document.displayName, ...(input.reviewerNote ? { note: input.reviewerNote } : {}) } });
    return { success: true, documentStatus: input.status, onboardingStatus: overallStatus };
  }),
  updateApplicantStatus: adminWith('marketplace.manage').input(z.object({
    userId: z.number(),
    status: z.enum(['under_review', 'approved', 'rejected', 'update_required']),
    note: z.string().max(2000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [applicant] = await db.select().from(users).where(eq(users.id, input.userId));
    if (!applicant || !isComplianceRole(applicant.userRole)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Compliance applicant not found' });
    await db.update(users).set({ onboardingStatus: input.status, onboardingReviewNotes: input.note ?? null, onboardingReviewedAt: new Date(), onboardingReviewedBy: ctx.user.id, verified: input.status === 'approved' }).where(eq(users.id, input.userId));
    if (input.status === 'approved') {
      // PROVIDER_APPROVED. The event key names the USER, not this review, so a
      // second approval after a later re-review cannot pay twice.
      await qualifyReferralEvent(db, input.userId, 'PROVIDER_APPROVED', `approved:${input.userId}`, new Date());
    }
    // Part 42 names supplier approval explicitly. registrationReviewEvents
    // already records the new status; what it cannot answer is what the
    // status was before, which is the question asked when a vendor says they
    // were approved and then were not.
    await recordFieldChanges(db, {
      subjectType: 'user', subjectId: input.userId, ownerId: input.userId, actorId: ctx.user.id,
      reason: input.note ?? null,
    }, [
      { field: 'onboardingStatus', oldValue: applicant.onboardingStatus, newValue: input.status },
      { field: 'verified', oldValue: applicant.verified, newValue: input.status === 'approved' },
    ]);
    await db.insert(registrationReviewEvents).values({ userId: input.userId, actorId: ctx.user.id, action: 'applicant_status_updated', status: input.status, note: input.note });
    await notifyUser(db, { userId: input.userId, title: 'Registration status updated', body: input.note || `Your registration is now ${input.status.replace('_', ' ')}`, type: 'compliance', link: '/compliance', messageKey: `notif.compliance.applicant.${input.status}`, messageParams: (input.note ? { note: input.note } : {}) as Record<string, string> });
    // Verification is the gate for appearing in the directory at all, so it is
    // the funnel stage where a vendor becomes able to earn anything. The
    // reviewer's note is not recorded - it is free text about a real person.
    recordEventAsync({
      type: input.status === 'approved' ? ANALYTICS_EVENTS.VENDOR_VERIFIED : ANALYTICS_EVENTS.VENDOR_REVIEW_REJECTED,
      userId: input.userId,
      metadata: { status: input.status, role: applicant.userRole ?? undefined },
    });
    return { success: true, onboardingStatus: input.status };
  }),
  bulkUpdateApplicantStatus: adminWith('marketplace.manage').input(z.object({
    userIds: z.array(z.number().int().positive()).min(1).max(100),
    status: z.enum(['approved', 'rejected']),
    note: z.string().max(2000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const userIds = Array.from(new Set(input.userIds));
    const applicants = await db.select().from(users).where(and(inArray(users.id, userIds), inArray(users.userRole, providerRoles)));
    if (applicants.length !== userIds.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'One or more compliance applicants could not be found' });
    if (applicants.some(applicant => !['under_review', 'update_required', 'not_started'].includes(applicant.onboardingStatus))) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bulk decisions may only include pending applicants' });
    const reviewedAt = new Date();
    await db.update(users).set({ onboardingStatus: input.status, onboardingReviewNotes: input.note ?? null, onboardingReviewedAt: reviewedAt, onboardingReviewedBy: ctx.user.id, verified: input.status === 'approved' }).where(inArray(users.id, userIds));
    if (input.status === 'approved') {
      // The SAME event as the single review above. A bulk approval that paid no
      // referrals while a one-by-one approval did would make the reward depend
      // on which button an administrator happened to use.
      for (const approvedId of userIds) {
        await qualifyReferralEvent(db, approvedId, 'PROVIDER_APPROVED', `approved:${approvedId}`, reviewedAt);
      }
    }
    await db.insert(registrationReviewEvents).values(applicants.map(applicant => ({ userId: applicant.id, actorId: ctx.user.id, action: 'bulk_applicant_status_updated', status: input.status, note: input.note })));
    await notifyUsers(db, applicants.map(applicant => ({ userId: applicant.id, title: input.status === 'approved' ? 'Registration approved' : 'Registration rejected', body: input.note || `Your registration is ${input.status}`, type: 'compliance', link: '/compliance', messageKey: `notif.compliance.applicant.${input.status}`, messageParams: (input.note ? { note: input.note } : {}) as Record<string, string> })));
    return { success: true, updatedCount: applicants.length, onboardingStatus: input.status };
  }),
  verifyUser: adminWith('users.manage').input(z.object({ userId: z.number(), verified: z.boolean() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    // Same rule as setUserFrozen: the user directory does not administer
    // administrators, even for a change that removes no access.
    const [verifyTarget] = await db
      .select({ id: users.id, role: users.role, adminRole: users.adminRole })
      .from(users).where(eq(users.id, input.userId));
    if (!verifyTarget) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such user' });
    await assertUserDirectoryMutationAllowed({
      db, actorAdminRole: ctx.user.adminRole, target: verifyTarget, removesAccess: false,
    });
    await db.update(users).set({ verified: input.verified }).where(eq(users.id, input.userId));
    if (input.verified) {
      await qualifyReferralEvent(db, input.userId, 'ACCOUNT_VERIFIED', `verified:${input.userId}`, new Date());
    }
    return { success: true };
  }),
  setUserFrozen: adminWith('users.manage').input(z.object({ userId: z.number(), frozen: z.boolean(), reason: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.user.id) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Administrators cannot freeze their own account' });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    /**
     * THE TARGET DECIDES WHICH AUTHORITY THIS NEEDS.
     *
     * `users.manage` runs the USER directory. It is not authority over the
     * platform's own operators, and this endpoint previously accepted any
     * userId with only a self-check - so a USER_ADMIN could freeze every Super
     * Admin in turn and leave nobody able to unfreeze them or create another.
     * Freezing an administrator now requires `admins.manage`, and freezing the
     * last usable Super Admin is refused outright.
     */
    const [frozenTarget] = await db
      .select({ id: users.id, role: users.role, adminRole: users.adminRole })
      .from(users).where(eq(users.id, input.userId));
    if (!frozenTarget) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such user' });
    await assertUserDirectoryMutationAllowed({
      db, actorAdminRole: ctx.user.adminRole, target: frozenTarget,
      removesAccess: input.frozen,
    });
    const action = input.frozen ? 'account_frozen' : 'account_unfrozen';
    const reasonText = input.frozen ? (input.reason || 'Suspended by an administrator') : 'Account unfrozen by administrator';
    await db.update(users).set({
      accountStatus: input.frozen ? 'frozen' : 'active',
      frozenAt: input.frozen ? new Date() : null,
      frozenReason: input.frozen ? reasonText : null,
    }).where(eq(users.id, input.userId));
    await recordAccountEvent(db, {
      userId: input.userId,
      actorId: ctx.user.id,
      action,
      note: reasonText,
    });
    return { success: true, status: input.frozen ? 'frozen' : 'active' };
  }),
  disputes: adminWith('support.manage').query(async () => {
    const db = await requireDb();
    const rows = await db.select().from(disputes).orderBy(desc(disputes.createdAt));
    const userRows = await db.select({ id: users.id, name: users.name }).from(users);
    const names = new Map(userRows.map(row => [row.id, row.name]));
    return rows.map(row => ({
      ...row,
      reporterName: names.get(row.reporterId) ?? null,
      respondentName: row.respondentId ? names.get(row.respondentId) ?? null : null,
    }));
  }),
  updateDispute: adminWith('support.manage').input(z.object({
    disputeId: z.number(),
    status: z.enum(['open', 'investigating', 'resolved', 'rejected']),
    resolutionNotes: z.string().max(2000).optional(),
  })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    await db.update(disputes).set({ status: input.status, resolutionNotes: input.resolutionNotes }).where(eq(disputes.id, input.disputeId));
    return { success: true };
  }),
  settings: adminWith('settings.manage').query(async () => {
    // Showing the DEFAULTS as though they were the stored settings invites an
    // administrator to save them over the real ones.
    const db = await requireDb();
    const rows = await db.select({ settingKey: adminSettings.settingKey, value: adminSettings.value }).from(adminSettings);
    return { ...DEFAULT_ADMIN_SETTINGS, ...Object.fromEntries(rows.map(row => [row.settingKey, row.value])) };
  }),
  updateSetting: adminWith('settings.manage').input(z.object({ key: z.string().min(1).max(120), value: z.string().max(2000) })).mutation(async ({ ctx, input }) => {
    if (!(input.key in DEFAULT_ADMIN_SETTINGS)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown setting key' });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [existing] = await db.select({ id: adminSettings.id }).from(adminSettings).where(eq(adminSettings.settingKey, input.key));
    if (existing) {
      await db.update(adminSettings).set({ value: input.value, updatedBy: ctx.user.id }).where(eq(adminSettings.id, existing.id));
    } else {
      await db.insert(adminSettings).values({ settingKey: input.key, value: input.value, updatedBy: ctx.user.id });
    }
    return { success: true };
  }),

  // ── Administrator management ───────────────────────────────────────────
  //
  // Every procedure below is superAdminProcedure - that is, gated on
  // `admins.manage`, which is the ONE permission held by SUPER_ADMIN alone.
  // That single fact is what makes privilege escalation impossible for every
  // other role: there is no capability they hold that reaches the authority
  // model at all, so there is nothing for them to escalate through.

  /**
   * Who am I, and what may I do?
   *
   * adminProcedure, not superAdminProcedure: every administrator needs this to
   * render their own dashboard. Permissions are DERIVED from the stored role on
   * each call rather than read from the session, so a role change takes effect
   * on the next request instead of whenever the token happens to expire.
   */
  me: adminProcedure.query(({ ctx }) => ({
    id: ctx.user.id,
    name: ctx.user.name,
    username: ctx.user.username,
    email: ctx.user.email,
    adminRole: ctx.user.adminRole as AdminRole,
    permissions: permissionsForAdminRole(ctx.user.adminRole),
  })),

  /**
   * The administrator directory.
   *
   * An explicit column allowlist, exactly as ADMIN_USER_COLUMNS does for normal
   * users. `users` also holds passwordHash, invitationToken and
   * passwordResetToken; a `select().from(users)` here would put all three on the
   * Admin Management screen.
   */
  admins: superAdminProcedure.query(async () => {
    const db = await requireDb();
    return db.select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      adminRole: users.adminRole,
      accountStatus: users.accountStatus,
      deactivatedAt: users.deactivatedAt,
      invitationStatus: users.invitationStatus,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
      passwordSetAt: users.passwordSetAt,
    }).from(users).where(eq(users.role, 'admin')).orderBy(desc(users.createdAt));
  }),

  /**
   * Create a Sub-Admin, and issue a one-time invitation link.
   *
   * The new account is created WITHOUT a password. It cannot sign in until the
   * invitee redeems the link and chooses one, which is what keeps the Super
   * Admin from ever knowing another administrator's credential - there is no
   * moment at which one exists for them to see.
   *
   * The raw token is returned exactly once, here, and never stored. SMTP is not
   * configured on this deployment, so the caller hands the link over out of
   * band; when mail exists this is the value it would send. Storing it would
   * defeat the point of hashing it.
   */
  createAdmin: superAdminProcedure.input(z.object({
    name: z.string().trim().min(1).max(255),
    email: z.string().trim().email().max(320),
    username: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, underscores, or hyphens only'),
    adminRole: z.enum(ADMIN_ROLES),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const username = normalizeUsername(input.username)!;
    const email = normalizeEmail(input.email)!;
    if (await getUserByUsername(username)) throw new TRPCError({ code: 'CONFLICT', message: 'Username is already in use' });
    if (await getUserByEmail(email)) throw new TRPCError({ code: 'CONFLICT', message: 'Email is already in use' });

    const result = await db.insert(users).values({
      openId: `local_${randomUUID()}`,
      username, email, name: input.name,
      // role and adminRole are set now so the directory shows them immediately,
      // but with no passwordHash the account cannot authenticate: adminSignIn
      // treats a null hash as no account at all.
      role: 'admin',
      adminRole: input.adminRole,
      userRole: 'admin',
      loginMethod: 'password',
      accountSource: 'admin_created',
      isDummy: false,
      accountStatus: 'active',
      onboardingStatus: 'approved',
      verified: true,
      createdBy: ctx.user.id,
      invitationStatus: 'invitation_sent',
      invitationSentAt: new Date(),
    });
    const userId = Number(result[0]?.insertId);

    const rawToken = randomBytes(ADMIN_TOKEN_BYTES).toString('base64url');
    await db.insert(adminInvitations).values({
      tokenHash: hashAdminToken(rawToken),
      userId,
      adminRole: input.adminRole,
      invitedBy: ctx.user.id,
      expiresAt: new Date(Date.now() + ADMIN_INVITE_TTL_HOURS * 60 * 60 * 1000),
    });
    await recordAccountEvent(db, {
      userId, actorId: ctx.user.id, action: 'admin_created', source: 'admin_invite',
      note: `Administrator ${username} created with role ${input.adminRole}`,
    });
    return {
      success: true,
      userId,
      // Shown once, to be delivered out of band. Never persisted.
      invitationLink: `/admin/accept-invitation?token=${rawToken}`,
      expiresAt: new Date(Date.now() + ADMIN_INVITE_TTL_HOURS * 60 * 60 * 1000),
    };
  }),

  /**
   * Change another administrator's role.
   *
   * Refuses to act on the caller's own account. Without that check a
   * SUPER_ADMIN could demote themselves and leave the platform with no one able
   * to manage administrators - an unrecoverable state reachable by one misclick.
   * It also means "modify your own permissions" is impossible for everybody, not
   * only for sub-admins.
   */
  setAdminRole: superAdminProcedure.input(z.object({
    userId: z.number().int().positive(),
    adminRole: z.enum(ADMIN_ROLES),
  })).mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.user.id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot change your own administrator role.' });
    }
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select({ id: users.id, role: users.role, adminRole: users.adminRole, username: users.username })
      .from(users).where(eq(users.id, input.userId));
    if (!target || target.role !== 'admin') throw new TRPCError({ code: 'NOT_FOUND', message: 'No such administrator' });

    // Demoting the last usable Super Admin empties the one role that can
    // create administrators or restore anybody's access. The self-check above
    // stops the obvious single-account case; this stops the two-account case
    // where each demotes the other in turn.
    if (input.adminRole !== 'SUPER_ADMIN') await assertSuperAdminSurvives(db, target);

    await db.update(users).set({ adminRole: input.adminRole }).where(eq(users.id, input.userId));
    await recordAccountEvent(db, {
      userId: input.userId, actorId: ctx.user.id, action: 'admin_role_changed', source: 'admin_management',
      note: `Role changed from ${target.adminRole} to ${input.adminRole}`,
    });
    return { success: true } as const;
  }),

  /**
   * Deactivate or reactivate an administrator.
   *
   * Deactivation revokes every live session as well as barring sign-in.
   * Flipping a flag alone would leave whoever is currently signed in with a
   * working session for up to a year, which is not what "deactivate" means to
   * the person clicking it.
   */
  setAdminActive: superAdminProcedure.input(z.object({
    userId: z.number().int().positive(),
    active: z.boolean(),
  })).mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.user.id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot deactivate your own account.' });
    }
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select({ id: users.id, role: users.role, adminRole: users.adminRole })
      .from(users).where(eq(users.id, input.userId));
    if (!target || target.role !== 'admin') throw new TRPCError({ code: 'NOT_FOUND', message: 'No such administrator' });

    // Same invariant as demotion: deactivating is a different word for the same
    // consequence when it lands on the last one.
    if (!input.active) await assertSuperAdminSurvives(db, target);

    await db.update(users).set({
      accountStatus: input.active ? 'active' : 'frozen',
      deactivatedAt: input.active ? null : new Date(),
      // Kills every existing session for this account when deactivating.
      ...(input.active ? {} : { sessionsInvalidBefore: revocationCutoff() }),
    }).where(eq(users.id, input.userId));

    await recordAccountEvent(db, {
      userId: input.userId, actorId: ctx.user.id,
      action: input.active ? 'admin_reactivated' : 'admin_deactivated',
      source: 'admin_management',
      note: input.active ? 'Administrator reactivated' : 'Administrator deactivated and sessions revoked',
    });
    return { success: true } as const;
  }),

  /** Sign an administrator out of every device, without deactivating them. */
  revokeAdminSessions: superAdminProcedure.input(z.object({
    userId: z.number().int().positive(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, input.userId));
    if (!target || target.role !== 'admin') throw new TRPCError({ code: 'NOT_FOUND', message: 'No such administrator' });

    await db.update(users).set({ sessionsInvalidBefore: revocationCutoff() }).where(eq(users.id, input.userId));
    await recordAccountEvent(db, {
      userId: input.userId, actorId: ctx.user.id, action: 'admin_sessions_revoked', source: 'admin_management',
      note: 'All sessions revoked',
    });
    return { success: true } as const;
  }),

  /**
   * Issue a password-reset link for another administrator.
   *
   * The Super Admin never learns the resulting password: this mints a one-time
   * token, and the administrator chooses their own password when they redeem it.
   * Reusing the invitation table rather than adding a second token mechanism -
   * an invitation and a reset are the same object here, "a one-time link that
   * lets this person set a password".
   *
   * Existing sessions are revoked at the same time. A reset usually means the
   * credential is suspect, and leaving live sessions running would defeat it.
   */
  resetAdminPassword: superAdminProcedure.input(z.object({
    userId: z.number().int().positive(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select({ id: users.id, role: users.role, adminRole: users.adminRole, username: users.username })
      .from(users).where(eq(users.id, input.userId));
    if (!target || target.role !== 'admin' || !isAdminRole(target.adminRole)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'No such administrator' });
    }

    const rawToken = randomBytes(ADMIN_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + ADMIN_INVITE_TTL_HOURS * 60 * 60 * 1000);
    await db.insert(adminInvitations).values({
      tokenHash: hashAdminToken(rawToken),
      userId: input.userId,
      adminRole: target.adminRole,
      invitedBy: ctx.user.id,
      expiresAt,
    });
    await db.update(users).set({ sessionsInvalidBefore: revocationCutoff() }).where(eq(users.id, input.userId));
    await recordAccountEvent(db, {
      userId: input.userId, actorId: ctx.user.id, action: 'admin_password_reset_requested', source: 'admin_management',
      note: 'One-time password reset link issued; existing sessions revoked',
    });
    return { success: true, resetLink: `/admin/accept-invitation?token=${rawToken}`, expiresAt };
  }),

  /** Live invitation/reset links for one administrator. Hashes are never returned. */
  adminInvitations: superAdminProcedure.input(z.object({
    userId: z.number().int().positive(),
  })).query(async ({ input }) => {
    const db = await requireDb();
    return db.select({
      id: adminInvitations.id,
      adminRole: adminInvitations.adminRole,
      invitedBy: adminInvitations.invitedBy,
      createdAt: adminInvitations.createdAt,
      expiresAt: adminInvitations.expiresAt,
      usedAt: adminInvitations.usedAt,
      revokedAt: adminInvitations.revokedAt,
    }).from(adminInvitations)
      .where(eq(adminInvitations.userId, input.userId))
      .orderBy(desc(adminInvitations.createdAt));
  }),

  /** Kill an outstanding invitation or reset link before it is redeemed. */
  revokeAdminInvitation: superAdminProcedure.input(z.object({
    invitationId: z.number().int().positive(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [row] = await db.select().from(adminInvitations).where(eq(adminInvitations.id, input.invitationId));
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such invitation' });
    if (row.usedAt) throw new TRPCError({ code: 'BAD_REQUEST', message: 'That link has already been used' });

    await db.update(adminInvitations)
      .set({ revokedAt: new Date(), revokedBy: ctx.user.id })
      .where(eq(adminInvitations.id, input.invitationId));
    await recordAccountEvent(db, {
      userId: row.userId, actorId: ctx.user.id, action: 'admin_invitation_revoked', source: 'admin_management',
      note: 'Outstanding administrator link revoked',
    });
    return { success: true } as const;
  }),

  /**
   * Change your OWN password.
   *
   * adminProcedure, not superAdminProcedure - every administrator may do this
   * for themselves and for nobody else. The target is ctx.user.id and there is
   * no userId input, so there is no parameter to point at another account.
   * Requires the current password, so a borrowed session cannot lock the real
   * owner out.
   */
  changeOwnPassword: adminProcedure.input(z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(ADMIN_PASSWORD_MIN_LENGTH).max(128),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [self] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, ctx.user.id));
    if (!await verifyPassword(input.currentPassword, self?.passwordHash)) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current password is incorrect.' });
    }
    await db.update(users).set({
      passwordHash: await hashPassword(input.newPassword),
      passwordSetAt: new Date(),
      // Every OTHER session is invalidated; this request re-cookies below.
      sessionsInvalidBefore: new Date(),
    }).where(eq(users.id, ctx.user.id));

    // Without this the administrator changing their password would be logged
    // out by their own action, because the token they are holding predates
    // sessionsInvalidBefore.
    const sessionToken = await sdk.createSessionToken(ctx.user.openId, {
      name: ctx.user.name || ctx.user.username || 'BuildHub administrator',
    });
    ctx.res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(ctx.req) });

    await recordAccountEvent(db, {
      userId: ctx.user.id, actorId: ctx.user.id, action: 'admin_password_changed', source: 'admin_management',
      note: 'Administrator changed their own password; other sessions revoked',
    });
    return { success: true } as const;
  }),
});

// ── AI Router ──────────────────────────────────────────────────────────────
const MAX_AI_MESSAGES = 40;
const MAX_AI_MESSAGE_LENGTH = 6000;

const aiChatProcedure = protectedProcedure.use(({ ctx, next }) => {
  const now = Date.now();
  const userKey = String(ctx.user.id);
  const ip = getClientIp(ctx.req);
  const results = [
    aiChatLimiters.userBurst.check(userKey, now),
    aiChatLimiters.userSustained.check(userKey, now),
    ...(ip ? [aiChatLimiters.ipBurst.check(ip, now), aiChatLimiters.ipSustained.check(ip, now)] : []),
  ];
  const blocked = results.find(result => !result.allowed);
  if (blocked) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: `Too many AI requests. Try again in ${Math.ceil(blocked.retryAfterMs / 1000)}s.` });
  }
  return next({ ctx });
});

/**
 * What the visitor is told, and with what HTTP shape.
 *
 * Every message here is written FOR the caller: no variable name, no provider,
 * no endpoint, no status code, no request id. They are server-authored
 * TRPCError messages for expected conditions, so the error formatter passes
 * them through untouched while still masking genuine internal errors. The
 * operator gets the real classification from the server log; the browser gets
 * a sentence it can act on.
 */
function aiErrorCode(category: AiFailureCategory): 'SERVICE_UNAVAILABLE' | 'TOO_MANY_REQUESTS' | 'TIMEOUT' | 'INTERNAL_SERVER_ERROR' {
  switch (category) {
    case 'provider-rate-limit':
    case 'provider-quota':
      return 'TOO_MANY_REQUESTS';
    case 'provider-timeout':
      return 'TIMEOUT';
    case 'config-missing':
    case 'provider-auth':
    case 'provider-unavailable':
    case 'provider-network':
      return 'SERVICE_UNAVAILABLE';
    // A malformed, empty or refused request is OUR bug or the provider's, not
    // something the visitor can fix or should be told the details of.
    case 'provider-bad-request':
    case 'response-empty':
    case 'response-parse':
      return 'INTERNAL_SERVER_ERROR';
  }
}

function aiErrorMessage(category: AiFailureCategory): string {
  switch (category) {
    case 'config-missing':
    case 'provider-auth':
      return 'The AI assistant is not available on this deployment.';
    case 'provider-rate-limit':
      return 'The AI assistant is busy right now. Please try again in a moment.';
    case 'provider-quota':
      return 'The AI assistant is temporarily unavailable. Please try again later.';
    case 'provider-timeout':
      return 'The AI assistant took too long to answer. Please try again.';
    case 'provider-unavailable':
    case 'provider-network':
      return 'The AI assistant is temporarily unreachable. Please try again shortly.';
    case 'provider-bad-request':
    case 'response-empty':
    case 'response-parse':
      return 'The AI assistant could not answer that. Please try rephrasing.';
  }
}

const aiRouter = router({
  chat: aiChatProcedure
    .input(z.object({
      messages: z.array(z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1).max(MAX_AI_MESSAGE_LENGTH),
      })).min(1).max(MAX_AI_MESSAGES),
      // The website's selected language decides the ANSWER's language. It does
      // not decide what the assistant knows - the BuildHub briefing is the same
      // in both languages, because a rule is not a translation.
      lang: z.enum(['en', 'ar']).optional(),
      /**
       * Files this person already uploaded via ai.uploadAttachment. IDs only -
       * never a URL and never bytes. Ownership is re-checked below against the
       * database, so possession of an id is not possession of the file.
       */
      attachmentIds: z.array(z.number().int().positive()).max(MAX_AI_ATTACHMENTS_PER_MESSAGE).optional(),
      /**
       * The project this question is about, when the person has said which.
       *
       * A SELECTOR, not an authorization claim. resolveProjectContext re-derives
       * what this caller may see from the session and picks among THAT - naming
       * somebody else's project id yields "not among the ones you may see", not
       * their project. Same discipline as attachmentIds above.
       */
      projectId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Deliberate, client-safe refusal for a KNOWN condition. Without it the
      // provider layer throws, tRPC classifies that as INTERNAL_SERVER_ERROR,
      // and the error formatter - correctly - replaces the message with
      // "Something went wrong. Please try again.". That is the right thing to
      // do with an unexpected internal error and the wrong thing to say about
      // a deployment that was simply never given a credential.
      if (!isAiConfigured()) {
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'The AI assistant is not available on this deployment.',
        });
      }
      // THE SERVER OWNS THE SYSTEM PROMPT.
      //
      // Client-supplied `system` messages are DISCARDED, not merged. The
      // assistant's grounding - the source hierarchy, the BuildHub briefing,
      // the refusal to invent policy - would otherwise be editable by anyone
      // who can post to this endpoint, which makes "BuildHub content is the
      // source of truth" a suggestion rather than a property. The caller
      // contributes the conversation; the server contributes the rules.
      const conversation = input.messages.filter(message => message.role !== 'system');
      if (conversation.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ask a question to start.' });
      }
      const lang: KnowledgeLanguage = input.lang ?? 'en';
      const systemPrompt = buildSystemPrompt(lang, {
        // The caller's OWN role, read from their session server-side - never
        // from the request body, which they could set to anything.
        userRole: ctx.user.userRole ?? null,
      });

      // ROUTING, decided in code. See server/_core/aiIntent.ts for why the
      // model is not asked to make this call.
      const lastQuestion = [...conversation].reverse().find(m => m.role === 'user')?.content ?? '';
      const intent = detectIntent(lastQuestion);

      // BUILDHUB IS SEARCHED FIRST for a provider request - before the model
      // sees the question - so the answer is drawn from listed, approved
      // providers rather than from whatever companies the model can recall.
      // Reference knowledge for the question, ranked by relevance then by
      // authority tier. Empty when nothing in the corpus matches, which is the
      // common case and costs nothing.
      // SEMANTIC retrieval, with a lexical floor and metadata ranking. Async
      // because it may embed the question; it never throws - when embeddings
      // are unavailable it degrades to lexical scoring and still returns.
      // Retrieval improves an answer, it is not a precondition for one.
      const retrieved = formatRetrievalForModel(
        await retrieveSemantic(lastQuestion, { jurisdiction: intent.jurisdiction }),
        lang,
      );
      const referenceBlock = retrieved ? `\n\n${retrieved}` : '';

      // REGULATORY. Separate from the corpus because it is a different KIND of
      // answer: pointers to instruments and their editions, with an explicit
      // instruction not to reconstruct clause text. A code question answered
      // from model memory is the most dangerous output this assistant can
      // produce, because it is precisely the kind a person acts on unchecked.
      const regulatory = formatRegulatoryForModel(findRegulatory(lastQuestion, intent.jurisdiction), lang);
      const regulatoryBlock = regulatory ? `\n\n${regulatory}` : '';

      // ATTACHMENTS. Authorization happens HERE, before a byte reaches the
      // model: each id is re-read from the database and must belong to the
      // caller and still be live. An id from another user's conversation
      // resolves to nothing and the request is refused - the id is not a
      // capability.
      const requestedIds = input.attachmentIds ?? [];
      let attachments: { name: string; contentType: string; bytes: Buffer }[] = [];
      let attachmentBlock = '';
      if (requestedIds.length > 0) {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
        const rows = await db.select({
          id: aiAttachments.id,
          name: aiAttachments.name,
          contentType: aiAttachments.contentType,
          fileKey: aiAttachments.fileKey,
        })
          .from(aiAttachments)
          .where(and(
            inArray(aiAttachments.id, requestedIds),
            eq(aiAttachments.userId, ctx.user.id),
            isNull(aiAttachments.deletedAt),
          ));

        if (rows.length !== requestedIds.length) {
          // Deliberately the same refusal whether the id never existed, belongs
          // to someone else, or was deleted. Distinguishing them would turn
          // this endpoint into an oracle for which attachment ids exist.
          throw new TRPCError({ code: 'NOT_FOUND', message: 'That attachment is no longer available.' });
        }

        try {
          attachments = await Promise.all(rows.map(async row => ({
            name: row.name,
            contentType: row.contentType,
            bytes: await getObjectStorage().get(row.fileKey),
          })));
        } catch {
          // The bytes are gone or storage is down. Say so rather than silently
          // answering the question WITHOUT the file the person asked about -
          // an answer that ignores the attachment is worse than an error,
          // because it looks like it worked.
          throw new TRPCError({
            code: 'SERVICE_UNAVAILABLE',
            message: 'That attachment could not be read. Please try uploading it again.',
          });
        }

        attachmentBlock = `\n\n${attachmentInstruction(rows.map(row => row.name), lang)}`;
      }

      // PROJECT CONTEXT. Costs no query at all unless the question bears on a
      // project or one was explicitly chosen - the brief's "retrieve only
      // relevant authorized context", enforced by not asking otherwise.
      let projectBlock = '';
      {
        const db = await getDb();
        if (db) {
          const projectContext = await resolveProjectContext({
            db,
            userId: ctx.user.id,
            userRole: ctx.user.userRole,
            question: lastQuestion,
            selectedProjectId: input.projectId,
          });
          projectBlock = formatProjectContext(projectContext, lang);
        }
      }

      let candidateBlock = '';
      if (intent.wantsProviderRecommendation) {
        const outcome = await recommendProviders({
          role: intent.role,
          category: intent.category,
          location: intent.location,
          unmatchedQualifiers: intent.unmappedQualifiers,
        });
        candidateBlock = `\n\n${formatCandidatesForModel(outcome, lang, intent.unmappedQualifiers)}`;
      }

      // TRANSACTION OPPORTUNITIES. The other side of the marketplace: a
      // provider looking for work rather than a customer looking for a
      // provider. Costs no query unless the question asks for work AND the
      // caller holds a role for which work is an opportunity - findRfqOpportunities
      // refuses any other role before it queries, so a homeowner asking about
      // "available projects" gets nothing rather than a lead feed.
      //
      // Nothing here executes anything. The block carries PREPARED actions and
      // says outright that no enquiry was opened and no credit was spent.
      let opportunityBlock = '';
      if (intent.wantsOpportunities && isRfqSeekingRole(ctx.user.userRole)) {
        const db = await getDb();
        if (db) {
          const opportunities = await findRfqOpportunities({
            db,
            userId: ctx.user.id,
            userRole: ctx.user.userRole,
            requestedCategory: intent.category,
            requestedLocation: intent.location,
          });
          opportunityBlock = `\n\n${formatOpportunitiesForModel(opportunities, lang)}`;
        }
      }

      try {
        const { text } = await generateAIResponse({
          messages: [
            { role: 'system', content: systemPrompt + attachmentBlock + projectBlock + regulatoryBlock + referenceBlock + candidateBlock + opportunityBlock },
            ...conversation,
          ],
          webSearch: intent.wantsCurrentInformation,
          attachments,
        });
        // The application's contract, not the provider's. No SDK object, no
        // usage figures, no model name, no request id - only what the chat
        // window renders.
        return { content: text };
      } catch (error) {
        if (error instanceof AiError) {
          throw new TRPCError({ code: aiErrorCode(error.category), message: aiErrorMessage(error.category) });
        }
        throw error;
      }
    }),

  /**
   * Accept one file for use in an AI conversation.
   *
   * Order is deliberate: rate limit, size, then VALIDATE THE BYTES, and only
   * then store. Nothing unvalidated reaches the bucket, so a refused file never
   * exists anywhere in BuildHub.
   *
   * Returns an id and the display metadata the composer needs - deliberately
   * NOT a URL. The RFQ uploader returns `/manus-storage/{key}` because RFQ
   * attachments are rendered back to the browser; an AI attachment is read by
   * the SERVER on the next chat request, so the browser never needs a path to
   * it and is not given one.
   */
  uploadAttachment: protectedProcedure
    .input(z.object({
      fileName: z.string().min(1).max(255),
      contentType: z.string().min(1).max(100),
      base64: z.string().min(1).max(11_000_000, 'File too large (max ~8MB)'),
    }))
    .mutation(async ({ ctx, input }) => {
      enforceUploadRateLimit(ctx.user.id);

      const bytes = Buffer.from(input.base64, 'base64');
      const validated = validateAiAttachment({
        name: input.fileName,
        declaredType: input.contentType,
        bytes,
      });
      if ('code' in validated) {
        // The validator's own message: specific, already user-safe, and it
        // names what to do instead. There is no internal detail in it.
        throw new TRPCError({ code: 'BAD_REQUEST', message: validated.message });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      // A deployment with no bucket is a KNOWN condition, not an unexpected
      // one. Without this the adapter throws, tRPC classifies it as
      // INTERNAL_SERVER_ERROR, and the error formatter - correctly - replaces
      // the message with "Something went wrong. Please try again.". That is
      // the right thing to say about a genuine internal fault and the wrong
      // thing to say about an operator who has not configured storage yet: it
      // sends them looking for a bug instead of a setting. This is the same
      // masking that made the original AI outage take a day to diagnose.
      // The unconfigured-storage case is handled by storagePutOrUnavailable,
      // which is where it now lives for all seven upload sites rather than
      // only this one.
      const { key } = await storagePutOrUnavailable(
        `ai-attachments/user-${ctx.user.id}/${validated.name}`,
        validated.bytes,
        validated.contentType,
      );
      const inserted = await db.insert(aiAttachments).values({
        userId: ctx.user.id,
        name: validated.name,
        contentType: validated.contentType,
        size: validated.bytes.length,
        fileKey: key,
      });

      return {
        id: Number((inserted as unknown as { insertId: number | string }).insertId),
        name: validated.name,
        contentType: validated.contentType,
        size: validated.bytes.length,
      };
    }),

  /**
   * Remove an attachment the person no longer wants to send.
   *
   * Soft delete: the row stays so the removal is auditable and so a replayed id
   * cannot resurrect the file. Scoped by userId in the WHERE clause, so this
   * cannot delete anyone else's row even if handed their id - and it reports
   * success either way, for the same reason the chat path does.
   */
  deleteAttachment: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await db.update(aiAttachments)
        .set({ deletedAt: new Date() })
        .where(and(
          eq(aiAttachments.id, input.id),
          eq(aiAttachments.userId, ctx.user.id),
          isNull(aiAttachments.deletedAt),
        ));
      return { ok: true };
    }),
});

// ── Billing Router (Phase 4B.1) ────────────────────────────────────────────
// READ-ONLY by design. There is deliberately no vendor-callable mutation that
// changes a plan, price, or subscription status anywhere in this router: plan
// changes are driven by verified payment-provider events (Phase 4B.5), never
// by a client request. That is what structurally prevents a vendor from
// upgrading themselves by manipulating a payload - there is no such endpoint
// to manipulate, not merely a check that could be bypassed.
/**
 * Turn a lifecycle outcome into an HTTP-shaped result.
 *
 * `noop` is a SUCCESS, not an error: repeating a transition the vendor already
 * completed is exactly the idempotent behaviour Phase 4B.4 requires, and the
 * client should see the settled state rather than a failure. Only a genuinely
 * illegal transition is an error, and it carries the server's own reason.
 */
function lifecycleResult(outcome: LifecycleOutcome) {
  if (outcome.outcome === 'rejected') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: outcome.reason });
  }
  return {
    outcome: outcome.outcome,
    action: outcome.action,
    lifecycleState: outcome.lifecycleState,
    plan: outcome.state.effectivePlan,
    status: outcome.state.status,
    isPaid: outcome.state.isPaid,
    inTrial: outcome.state.inTrial,
    trialEndsAt: outcome.state.trialEndsAt,
    currentPeriodEnd: outcome.state.currentPeriodEnd,
    cancelAtPeriodEnd: outcome.state.cancelAtPeriodEnd,
    inGracePeriod: outcome.state.inGracePeriod,
    gracePeriodEndsAt: outcome.state.gracePeriodEndsAt,
    founderPriceActive: outcome.state.founderPriceActive,
    founderPriceEndsAt: outcome.state.founderPriceEndsAt,
    entitlements: outcome.state.entitlements,
  };
}

/**
 * READING THE COMMERCIAL TRAIL.
 *
 * Audit records are themselves permission-scoped, which is the part most audit
 * features get wrong: a log of who did what to whose money is MORE sensitive
 * than the records it describes, not less, because it aggregates across
 * everyone in one place.
 *
 * Two reads, and no third:
 *
 *   mine   - the caller's own trail, as actor or as owner. A supplier sees
 *            what they did and what was done to their products; a customer
 *            sees their RFQs and the quotations against them.
 *   all    - administrators only, gated on the existing audit permission.
 *
 * There is deliberately NO "trail for subject X" endpoint. It would need its
 * own authorization rule per subject type - four of them, each able to drift -
 * and the two reads above already answer the questions anyone actually has.
 */
/**
 * Who owns the record a history read is asking about, resolved from the live
 * row. Returns null when the record does not exist, which the caller treats
 * the same as "not yours".
 */
async function resolveSubjectOwner(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  subjectType: 'rfq' | 'quotation' | 'product' | 'user' | 'subscription',
  subjectId: number,
): Promise<number | null> {
  switch (subjectType) {
    case 'rfq': {
      const [row] = await db.select({ ownerId: rfqs.requesterId }).from(rfqs).where(eq(rfqs.id, subjectId)).limit(1);
      return row?.ownerId ?? null;
    }
    case 'quotation': {
      const [row] = await db.select({ ownerId: quotations.providerId }).from(quotations).where(eq(quotations.id, subjectId)).limit(1);
      return row?.ownerId ?? null;
    }
    case 'product': {
      const [row] = await db.select({ ownerId: products.supplierId }).from(products).where(eq(products.id, subjectId)).limit(1);
      return row?.ownerId ?? null;
    }
    case 'user':
    case 'subscription': {
      // A person's own account and subscription history belongs to them.
      const [row] = await db.select({ ownerId: users.id }).from(users).where(eq(users.id, subjectId)).limit(1);
      return row?.ownerId ?? null;
    }
    default:
      return null;
  }
}

const auditRouter = router({
  mine: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      return db.select({
        id: commercialAuditEvents.id,
        subjectType: commercialAuditEvents.subjectType,
        subjectId: commercialAuditEvents.subjectId,
        action: commercialAuditEvents.action,
        detail: commercialAuditEvents.detail,
        createdAt: commercialAuditEvents.createdAt,
        // actorId is returned ONLY when it is the caller. Whose account
        // performed an action on somebody else's record is not the caller's
        // business, and returning it here would make this a way to learn which
        // accounts touched which records.
      })
        .from(commercialAuditEvents)
        .where(sql`${commercialAuditEvents.actorId} = ${ctx.user.id} OR ${commercialAuditEvents.ownerId} = ${ctx.user.id}`)
        .orderBy(desc(commercialAuditEvents.createdAt))
        .limit(input?.limit ?? 50);
    }),
  all: adminWith('audit.read')
    .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      return db.select()
        .from(commercialAuditEvents)
        .orderBy(desc(commercialAuditEvents.createdAt))
        .limit(input?.limit ?? 100);
    }),

  /**
   * OLD -> NEW for one record (Parts 42, 43, 44).
   *
   * SEPARATE FROM `mine` AND `all` ON PURPOSE. Those return the audit trail,
   * which deliberately carries field NAMES and never values, and is read by a
   * wider audience. Values are a narrower disclosure - a competitor's
   * historical pricing is exactly the thing a marketplace must not hand out -
   * so they get their own procedure with their own authorization.
   *
   * WHO MAY READ IT: the record's own owner, and any administrator - Super
   * Admin and sub-admins alike. That is the owner's decision, asked and
   * answered explicitly rather than inferred; the narrower reading
   * (audit.read only, which would exclude Support and Billing) was offered and
   * not chosen. Everyone else keeps the existing field-names-only audit view.
   *
   * OWNERSHIP IS RESOLVED FROM THE SUBJECT ROW, NOT FROM THE HISTORY ROW.
   * fieldValueHistory.ownerId records who owned the record AT THE TIME, which
   * is right for the audit but wrong for authorization: a product sold to
   * another supplier would otherwise keep letting its previous owner read
   * changes made after they lost it.
   */
  recordHistory: protectedProcedure
    .input(z.object({
      subjectType: z.enum(['rfq', 'quotation', 'product', 'user', 'subscription']),
      subjectId: z.number().int().positive(),
      limit: z.number().int().min(1).max(200).default(100),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

      // Any administrator with a real admin role. `adminRole` null means no
      // permissions at all everywhere else in this file (hasAdminPermission
      // fails closed), and it must mean the same here - a role='admin' row
      // with no adminRole is not an administrator.
      const isAdmin = ctx.user.role === 'admin'
        && isAdminRole((ctx.user as { adminRole?: string }).adminRole);

      if (!isAdmin) {
        const ownerId = await resolveSubjectOwner(db, input.subjectType, input.subjectId);
        // NOT_FOUND rather than FORBIDDEN for a record they do not own: telling
        // an attacker that quotation 412 exists but is not theirs is itself a
        // disclosure, and every other read in this file answers the same way.
        if (ownerId === null || ownerId !== ctx.user.id) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'No history for this record' });
        }
      }

      return readFieldHistory(db, input.subjectType, [input.subjectId], input.limit);
    }),
});

const billingRouter = router({
  // The public commercial catalogue, straight from shared/billing.ts - the one
  // source of truth. Prices are never duplicated into the client bundle.
  plans: publicProcedure.query(() => ({
    currency: BILLING_CURRENCY,
    trialDays: TRIAL_DAYS,
    gracePeriodDays: GRACE_PERIOD_DAYS,
    founderOfferMonths: FOUNDER_OFFER_MONTHS,
    plans: PLAN_IDS.map(id => ({
      id,
      paid: PLANS[id].paid,
      standard: PLANS[id].standard,
      founder: PLANS[id].founder,
      entitlements: PLANS[id].entitlements,
      annualSavings: annualSavings(id),
    })),
    // Which entitlements BuildHub actually enforces TODAY, derived from the
    // Phase 4B.1 honesty ledger - whose stated purpose is that "no report, UI,
    // or plan-comparison page can claim a capability works when nothing
    // enforces it". The pricing page badges everything false as "coming soon"
    // rather than advertising it as included.
    //
    // Computed here rather than in the client so the catalogue stays
    // server-owned and shared/billing.ts's PLANS table is never pulled into the
    // browser bundle.
    entitlementAvailability: Object.fromEntries(
      (Object.keys(ENTITLEMENT_ENFORCEMENT) as (keyof PlanEntitlements)[])
        .map(key => [key, isEntitlementEnforced(key)]),
    ) as Record<keyof PlanEntitlements, boolean>,
    // Whether self-service checkout can actually run. Public because the
    // PRICING page needs it and that page must work for signed-out visitors -
    // reading it from the protected mySubscription instead made an anonymous
    // visit throw UNAUTHORIZED, which the client's global handler turns into a
    // redirect to /auth. It reveals nothing: it is one boolean about BuildHub's
    // own configuration, not about any vendor.
    checkoutAvailable: isPaymentProviderConfigured(),
  })),

  // A vendor's own billing state. Self-scoped by construction: there is no
  // userId input, so there is no field a caller could populate to read another
  // vendor's billing information.
  mySubscription: protectedProcedure.query(async ({ ctx }) => {
    const [state, founderEligible] = await Promise.all([
      getBillingState(ctx.user.id),
      checkFounderEligibility(ctx.user.id),
    ]);
    return {
      plan: state.effectivePlan,
      status: state.status,
      isPaid: state.isPaid,
      inTrial: state.inTrial,
      trialEndsAt: state.trialEndsAt,
      inGracePeriod: state.inGracePeriod,
      gracePeriodEndsAt: state.gracePeriodEndsAt,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      currentPeriodEnd: state.currentPeriodEnd,
      founderPriceActive: state.founderPriceActive,
      founderPriceEndsAt: state.founderPriceEndsAt,
      founderEligible,
      entitlements: state.entitlements,
      // Phase 4B.1 has no payment provider wired; the vendor-facing upgrade
      // flow arrives with it in Phase 4B.5. Surfaced honestly rather than
      // rendering a purchase button that cannot work.
      checkoutAvailable: isPaymentProviderConfigured(),
    };
  }),

  // Phase 4B.2: the vendor's full effective entitlement set, resolved through
  // the one central engine. Self-scoped by construction - no input at all, so
  // no request shape can name another vendor.
  myEntitlements: protectedProcedure.query(async ({ ctx }) => {
    const resolution = await resolveVendorEntitlements(ctx.user.id);
    return toVendorEntitlementResponse(resolution);
  }),

  // Just the effective plan id, for callers that need nothing else.
  myPlan: protectedProcedure.query(async ({ ctx }) => {
    const resolution = await resolveVendorEntitlements(ctx.user.id);
    return { plan: resolution.effectivePlan, isPaid: resolution.isPaid };
  }),

  // Phase 4B.3: the vendor's own qualified-enquiry consumption this month.
  // Self-scoped - no input, reads ctx.user.id only.
  myEnquiryUsage: protectedProcedure.query(async ({ ctx }) => {
    return getEnquiryUsage(ctx.user.id);
  }),

  // ── Subscription lifecycle (Phase 4B.4) ─────────────────────────────────
  //
  // The first mutations the billing router has ever carried. Every one of them
  // is self-scoped: the vendor is identified by ctx.user.id, and no procedure
  // below accepts a userId, plan status, price, trial, entitlement, or
  // subscription state from the caller. The only thing a client may choose is
  // WHICH transition to request and, where a plan is genuinely a choice, which
  // plan - validated against the shared catalogue.
  //
  // None of this collects payment. Phase 4B.5 connects the provider.

  myLifecycle: protectedProcedure.query(async ({ ctx }) => getLifecycleSnapshot(ctx.user.id)),

  // The vendor-facing lifecycle rights, and deliberately ONLY these two.
  //
  // Both are subtractive-or-restorative: cancelling gives up a future renewal,
  // resuming puts back what the vendor already had. Neither can grant access,
  // so neither takes a plan, an interval, a price, or a status - there is no
  // field here a client could manipulate into an upgrade.
  //
  // Choosing or changing a PLAN is deliberately not exposed to vendors in this
  // phase. No payment can be collected until Phase 4B.5, so a self-service
  // subscribe or upgrade call would hand out real paid entitlements - a
  // 30-day trial, or PREMIUM's unlimited enquiries - for nothing. The
  // transitions exist and are fully tested (server/billing/lifecycle.ts); they
  // are reachable only by an administrator until the provider can charge for
  // them, at which point Phase 4B.5 connects checkout to the same functions.

  cancelSubscription: approvedProviderProcedure.mutation(async ({ ctx }) =>
    lifecycleResult(await requestCancellation({ userId: ctx.user.id, source: 'vendor', actorId: ctx.user.id }))),

  resumeSubscription: approvedProviderProcedure.mutation(async ({ ctx }) =>
    lifecycleResult(await resumeSubscription({ userId: ctx.user.id, source: 'vendor', actorId: ctx.user.id }))),
});

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  projects: projectsRouter,
  marketplace: marketplaceRouter,
  rfq: rfqRouter,
  messages: messagesRouter,
  notifications: notificationsRouter,
  reviews: reviewsRouter,
  profile: profileRouter,
  portfolio: portfolioRouter,
  disputes: disputesRouter,
  analytics: analyticsRouter,
  admin: adminRouter,
  compliance: registrationRouter,
  billing: billingRouter,
  ai: aiRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;
