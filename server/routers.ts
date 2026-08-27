import { z } from 'zod';
import { COOKIE_NAME, NOT_ADMIN_ERR_MSG } from '@shared/const';
import {
  ADMIN_ROLES, isAdminRole, hasAdminPermission, permissionsForAdminRole,
  type AdminPermission, type AdminRole,
} from '@shared/adminRoles';
import { getSessionCookieOptions } from './_core/cookies';
import { systemRouter } from './_core/systemRouter';
import { publicProcedure, protectedProcedure, router } from './_core/trpc';
import type { TrpcContext } from './_core/context';
import { TRPCError } from '@trpc/server';
import { getDb, getUserByEmail, getUserByUsername, normalizeEmail, normalizeUsername, revokeSession } from './db';
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
import { acceptQuotationSecure, rejectQuotationSecure } from './quotationWorkflow';
import { aiChatLimiters, authLimiters, contentLimiters, getClientIp } from './_core/rateLimit';
import { recordEventAsync } from './analytics/events';
import { ANALYTICS_EVENTS } from '@shared/analyticsEvents';
import { getEventCounts, getMedianDaysToMilestone, getVendorFunnel } from './analytics/events';
import { getChurn, getCommercialKpis } from './analytics/kpis';
import { ENV, isTestLoginEnabled } from './_core/env';
import { getMailer, isMailerConfigured } from './_core/mailer';
import { notifyUser, notifyUsers } from './notifications';
import { containsTerm, MAX_SEARCH_LENGTH } from './_core/searchTerms';
import { isAllowedProjectDocumentType, clampProjectProgress } from '../shared/projectFeatures';
import {
  projects, milestones, tasks, documents, products,
  rfqs, quotations, messages, notifications, reviews,
  dailyLogs, expenses, users, disputes, adminSettings, progressReports, productQuestions,
  registrationDocuments, registrationDocumentSubmissions, registrationReviewEvents, testLoginTokens, adminInvitations, userAccountAuditEvents,
  aiAttachments,
} from '../drizzle/schema';
import { and, desc, eq, inArray, isNull, like, notInArray, or, sql } from 'drizzle-orm';
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
  startPaidTrial,
  type LifecycleOutcome,
} from './billing/lifecycle';
import { resolveVendorEntitlements, toVendorEntitlementResponse } from './billing/entitlements';
import { isPaymentProviderConfigured } from './billing/provider';
import {
  getEnquiryUsage, getVendorCategories, listEligibleRfqs, openQualifiedEnquiry,
} from './billing/enquiries';
import {
  FEATURED_PLACEMENT_SLOTS, getVendorTargetingDiagnostics, listDirectoryCategories,
  listDirectoryVendors, listFeaturedVendors,
} from './vendorDirectory';
import { RFQ_CATEGORIES, isRfqCategory } from '@shared/rfqCategories';
import { vendorCategories, vendorSubscriptions } from '../drizzle/schema';

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

// Administrator invitation and reset tokens. Same reasoning as the QA links
// above: 32 bytes of CSPRNG output is not a human-chosen secret, so sha256 with
// no salt is correct and scrypt would only slow down redemption. Only the hash
// is ever stored, so the database holds nothing redeemable.
const ADMIN_TOKEN_BYTES = 32;
const ADMIN_INVITE_TTL_HOURS = 48;
/** Longer than a customer's 8. One of these reaches the whole admin surface. */
const ADMIN_PASSWORD_MIN_LENGTH = 12;
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
    await db.insert(userAccountAuditEvents).values({ userId: target.id, actorId: target.id, action: 'dummy_user_signed_in', source: 'dummy', note: 'Dummy user signed in with a locally managed password' });
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
    await db.insert(userAccountAuditEvents).values({
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

    const [created] = await db.select({ openId: users.openId }).from(users).where(eq(users.id, userId));
    const sessionToken = await sdk.createSessionToken(created.openId, { name: input.name });
    ctx.res.cookie(COOKIE_NAME, sessionToken, { ...getSessionCookieOptions(ctx.req) });
    await db.insert(userAccountAuditEvents).values({
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
    await db.insert(userAccountAuditEvents).values({
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
    await db.insert(userAccountAuditEvents).values({
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

    await db.insert(userAccountAuditEvents).values({
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
      const token = `${randomUUID()}-${randomUUID().slice(0, 8)}`;
      await db.update(users).set({
        passwordResetToken: token,
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
      await db.insert(userAccountAuditEvents).values({
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

    const [target] = await db.select().from(users).where(eq(users.passwordResetToken, input.token));
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

    await db.insert(userAccountAuditEvents).values({
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
      await db.insert(userAccountAuditEvents).values({ userId: ctx.user.id, actorId: ctx.user.id, action: 'profile_role_completed', source: 'self_registered', note: `Role selected: ${input.userRole}` });
      recordEventAsync({
        type: ANALYTICS_EVENTS.VENDOR_PROFILE_COMPLETED,
        userId: ctx.user.id,
        metadata: { role: input.userRole, professional: isComplianceRole(input.userRole) },
      });
      return { success: true };
    }),
});

// ── Registration Compliance Router ─────────────────────────────────────────
const complianceProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isComplianceRole(ctx.user.userRole)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Professional onboarding is required for this role' });
  return next({ ctx });
});

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
    const { key, url } = await storagePut(`registration/${ctx.user.id}/${Date.now()}-${safeName}`, bytes, input.contentType);
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
    const db = await getDb();
    if (!db) return [];
    return db.select().from(projects).where(eq(projects.ownerId, ctx.user.id)).orderBy(desc(projects.createdAt));
  }),
  directory: approvedProviderProcedure.query(async ({ ctx }) => {
    if (!providerRoles.includes(ctx.user.userRole as typeof providerRoles[number])) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Provider access required' });
    }
    const db = await getDb();
    if (!db) return [];
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
    const [project] = await db.select().from(projects).where(and(eq(projects.id, input.id), eq(projects.ownerId, ctx.user.id)));
    if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
    return project;
  }),
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
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const result = await db.insert(projects).values({
        ...input,
        ownerId: ctx.user.id,
        budget: input.budget != null ? String(input.budget) : undefined,
      });
      return { id: Number(result[0].insertId) };
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
      await db.update(projects).set({
        ...rest,
        budget: budget != null ? String(budget) : undefined,
        spent: spent != null ? String(spent) : undefined,
      }).where(and(eq(projects.id, id), eq(projects.ownerId, ctx.user.id)));
      return { success: true };
    }),
  milestones: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
    if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
    return db.select().from(milestones).where(eq(milestones.projectId, input.projectId)).orderBy(milestones.dueDate);
  }),
  addMilestone: protectedProcedure
    .input(z.object({ projectId: z.number(), title: z.string(), dueDate: z.date().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
      if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
      await db.insert(milestones).values(input);
      return { success: true };
    }),
  tasks: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
    if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
    return db.select().from(tasks).where(eq(tasks.projectId, input.projectId)).orderBy(desc(tasks.createdAt));
  }),
  addTask: protectedProcedure
    .input(z.object({ projectId: z.number(), title: z.string(), description: z.string().optional(), priority: z.enum(['low', 'medium', 'high']).optional(), dueDate: z.date().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
      if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
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
    const db = await getDb();
    if (!db) return [];
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
    if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
    return db.select().from(expenses).where(eq(expenses.projectId, input.projectId)).orderBy(desc(expenses.date));
  }),
  addExpense: protectedProcedure
    .input(z.object({ projectId: z.number(), category: z.string().optional(), description: z.string().optional(), amount: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
      if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
      await db.insert(expenses).values({ ...input, amount: String(input.amount) });
      return { success: true };
    }),
  dailyLogs: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
    if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
    return db.select().from(dailyLogs).where(eq(dailyLogs.projectId, input.projectId)).orderBy(desc(dailyLogs.date));
  }),
  addDailyLog: protectedProcedure
    .input(z.object({ projectId: z.number(), description: z.string(), weather: z.string().optional(), workers: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
      if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
      await db.insert(dailyLogs).values({ ...input, authorId: ctx.user.id });
      return { success: true };
    }),
  documents: protectedProcedure.input(z.object({ projectId: z.number(), type: z.enum(['drawing', 'boq', 'photo', 'contract', 'invoice', 'other']).optional() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
    if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
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
      const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
      if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
      const buffer = Buffer.from(input.base64, 'base64');
      if (buffer.length > 8 * 1024 * 1024) throw new TRPCError({ code: 'BAD_REQUEST', message: 'File too large (max 8MB)' });
      assertUploadedFileMatches(input.contentType, buffer, DOCUMENT_TYPES);
      const safeName = input.name.replace(/[^\w.-]+/g, '_');
      const { key, url } = await storagePut(`project-documents/user-${ctx.user.id}/project-${input.projectId}/${safeName}`, buffer, input.contentType);
      const result = await db.insert(documents).values({ projectId: input.projectId, uploaderId: ctx.user.id, name: input.name, type: input.type, url, fileKey: key, size: buffer.length });
      return { id: Number(result[0].insertId), key, url, name: input.name, type: input.type, size: buffer.length };
    }),
  progressReports: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
    if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
    return db.select().from(progressReports).where(eq(progressReports.projectId, input.projectId)).orderBy(desc(progressReports.createdAt));
  }),
  addProgressReport: protectedProcedure.input(z.object({ projectId: z.number(), title: z.string().min(1), summary: z.string().min(1), progress: z.number().int().min(0).max(100) })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
    if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
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
    .query(async ({ input }) => listDirectoryVendors(input ?? {})),
  vendorCategories: publicProcedure.query(async () => listDirectoryCategories()),

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
      const db = await getDb();
      if (!db) return [];
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
      return db.select().from(products)
        .where(and(...conditions))
        .orderBy(desc(products.featured), desc(products.createdAt))
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
    return product;
  }),
  myProducts: approvedProviderProcedure.query(async ({ ctx }) => {
    if (ctx.user.userRole !== 'supplier') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Supplier access required' });
    }
    const db = await getDb();
    if (!db) return [];
    return db.select().from(products).where(eq(products.supplierId, ctx.user.id)).orderBy(desc(products.createdAt));
  }),
  create: approvedProviderProcedure
    .input(z.object({
      name: z.string().min(1),
      nameAr: z.string().optional(),
      description: z.string().optional(),
      category: z.string().min(1),
      brand: z.string().optional(),
      price: z.number().optional(),
      stock: z.number().int().min(0).optional(),
      unit: z.string().optional(),
      deliveryDays: z.number().int().min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.userRole !== 'supplier') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Supplier access required' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const result = await db.insert(products).values({
        ...input,
        supplierId: ctx.user.id,
        price: input.price != null ? String(input.price) : undefined,
      });
      return { id: Number(result[0].insertId) };
    }),
  categories: publicProcedure.query(async () => {
    return [
      'Materials', 'Furniture', 'Lighting', 'Electrical', 'Plumbing',
      'HVAC', 'Paint', 'Ceramics', 'Granite', 'Marble', 'Wood',
      'Doors', 'Windows', 'Roofing', 'Glass', 'Steel', 'Concrete',
      'Waterproofing', 'Solar', 'Smart Home', 'Pools', 'Landscaping',
      'Security', 'Fire Fighting', 'Cleaning', 'Maintenance', 'Moving',
    ];
  }),
  questions: publicProcedure.input(z.object({ productId: z.number() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];
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
    const [product] = await db.select({ id: products.id }).from(products)
      .where(and(eq(products.id, input.productId), eq(products.active, true)));
    if (!product) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    const result = await db.insert(productQuestions).values({ productId: input.productId, askerId: ctx.user.id, question: input.question });
    return { id: Number(result[0].insertId) };
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
  list: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
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
    }).from(rfqs).orderBy(desc(rfqs.createdAt)).limit(50);
  }),
  myList: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(rfqs).where(eq(rfqs.requesterId, ctx.user.id)).orderBy(desc(rfqs.createdAt));
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
    return rfq;
  }),
  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      category: z.string().optional(),
      budget: z.number().optional(),
      location: z.string().optional(),
      deadline: z.date().optional(),
      projectId: z.number().optional(),
      productReference: z.object({ productId: z.number(), variantId: z.string().min(1), variantLabel: z.string().min(1) }).optional(),
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
        const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
        if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
      }
      const { attachments, productReference, ...rest } = input;
      const result = await db.insert(rfqs).values({
        ...rest,
        requesterId: ctx.user.id,
        budget: input.budget != null ? String(input.budget) : undefined,
        attachments: attachments && attachments.length > 0 ? JSON.stringify(attachments) : undefined,
        productReference: productReference ?? undefined,
      });
      const rfqId = Number(result[0].insertId);
      recordEventAsync({
        type: ANALYTICS_EVENTS.RFQ_POSTED,
        userId: ctx.user.id,
        subjectType: 'rfq',
        subjectId: rfqId,
        metadata: { category: rest.category ?? undefined },
      });
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
      const { key, url } = await storagePut(
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
    const db = await getDb();
    if (!db) return [];
    return db.select({
      id: quotations.id,
      rfqId: quotations.rfqId,
      price: quotations.price,
      timeline: quotations.timeline,
      status: quotations.status,
      createdAt: quotations.createdAt,
      rfqTitle: rfqs.title,
      rfqStatus: rfqs.status,
    }).from(quotations).leftJoin(rfqs, eq(quotations.rfqId, rfqs.id)).where(eq(quotations.providerId, ctx.user.id)).orderBy(desc(quotations.createdAt));
  }),
  // SECURITY (Phase 4A final gate): quotations on an RFQ include each bidding
  // vendor's email, exact price, timeline, and notes - competitive-intelligence
  // and contact-info exposure if any authenticated user (including a rival
  // vendor) could pull them for an RFQ they don't own, not just the homeowner
  // legitimately comparing bids on their own request. This ownership check
  // matches the same pattern already used by every other project/RFQ-scoped
  // query in this file (projects.get, projects.expenses, projects.dailyLogs).
  quotations: protectedProcedure.input(z.object({ rfqId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
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
        paymentTerms:     quotations.paymentTerms,
        notes:            quotations.notes,
        status:           quotations.status,
        createdAt:        quotations.createdAt,
        providerName:     users.name,
        providerEmail:    users.email,
        providerVerified: users.verified,
        providerRole:     users.userRole,
        providerLocation: users.location,
      })
      .from(quotations)
      .leftJoin(users, eq(quotations.providerId, users.id))
      .where(eq(quotations.rfqId, input.rfqId))
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
          return { rfq: result.rfq, alreadyConsumed: result.alreadyConsumed, usage: result.usage };
      }
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
      timeline: z.number().int().positive().max(3650).optional(),
      warranty: z.string().max(100).optional(),
      paymentTerms: z.string().max(2000).optional(),
      notes: z.string().max(4000).optional(),
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
      // KNOWN GAP, deliberately not decided here: nothing stops the same
      // provider submitting several quotations on one RFQ, and each one
      // notifies the requester again. Whether a second submission should be
      // refused, or should REPLACE the first as a revision, is a product
      // decision about how bidding works on BuildHub - not something to infer
      // from the schema. Recorded in the Phase 1B handoff for the owner.
      await db.insert(quotations).values({
        ...input,
        providerId: ctx.user.id,
        price: String(input.price),
      });
      await notifyUser(db, { userId: rfq.requesterId, title: 'New quotation received', body: `You received a new quotation for "${rfq.title}"`, type: 'quotation', link: '/rfq', messageKey: 'notif.quotation.received', messageParams: { rfqTitle: rfq.title } });
      // Funnel milestone: a vendor responding is the point at which the
      // marketplace has produced value for both sides.
      recordEventAsync({
        type: ANALYTICS_EVENTS.QUOTATION_SUBMITTED,
        userId: ctx.user.id,
        subjectType: 'rfq',
        subjectId: input.rfqId,
      });
      return { success: true };
    }),
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
      return accepted;
    }),
  rejectQuotation: protectedProcedure
    .input(z.object({ quotationId: z.number(), rfqId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return rejectQuotationSecure(input.rfqId, input.quotationId, ctx.user.id);
    }),
});

// ── Messages Router ─────────────────────────────────────────────────────────
const messagesRouter = router({
  conversations: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select({ senderId: messages.senderId, receiverId: messages.receiverId, content: messages.content, createdAt: messages.createdAt }).from(messages).where(sql`${messages.senderId} = ${ctx.user.id} OR ${messages.receiverId} = ${ctx.user.id}`).orderBy(desc(messages.createdAt));
    const otherIds = Array.from(new Set(rows.map(row => row.senderId === ctx.user.id ? row.receiverId : row.senderId)));
    if (!otherIds.length) return [];
    const people = await db.select({ id: users.id, name: users.name, userRole: users.userRole }).from(users).where(inArray(users.id, otherIds));
    return people.map(person => {
      const latest = rows.find(row => row.senderId === person.id || row.receiverId === person.id);
      const name = person.name || 'BuildHub user';
      return { id: person.id, name, initials: name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase(), lastMessage: latest?.content ?? '', time: latest?.createdAt ? new Date(latest.createdAt).toLocaleDateString() : '', unread: 0, online: false, role: person.userRole || 'Member' };
    });
  }),
  list: protectedProcedure.input(z.object({ otherUserId: z.number().optional() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
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
    const result = await db.insert(messages).values({ ...input, senderId: ctx.user.id });
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
    const { key, url } = await storagePut(`message-attachments/user-${ctx.user.id}/${Date.now()}-${safeName}`, buffer, input.contentType);
    return { key, url, name: input.fileName, size: buffer.length, type: input.contentType };
  }),
});

// ── Notifications Router ───────────────────────────────────────────────────
const notificationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(notifications).where(eq(notifications.userId, ctx.user.id)).orderBy(desc(notifications.createdAt)).limit(50);
  }),
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { count: 0 };
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
    const db = await getDb();
    if (!db) return [];
    return db.select().from(reviews).where(and(eq(reviews.revieweeId, input.userId), eq(reviews.verified, true))).orderBy(desc(reviews.createdAt));
  }),
  // Dynamic/computed rating (Phase 4A.4 decision): always derived live from the
  // reviews table, never a stored aggregate - so it can never drift out of sync
  // the way users.rating/reviewCount already have. Same access level and same
  // `verified: true` filter as `forUser` above, since this is an aggregate over
  // exactly the same public-by-design data, not a new/competing calculation.
  statsForUser: publicProcedure.input(z.object({ userId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return { averageRating: null as number | null, reviewCount: 0 };
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
    const db = await getDb();
    if (!db) return [];
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
      await notifyUser(db, { userId: input.revieweeId, title: 'New review received', body: `You received a new ${input.rating}-star review.`, type: 'review', link: '/provider', messageKey: 'notif.review.received', messageParams: { rating: input.rating } });
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

const profileRouter = router({
  // Public vendor profile. Requires authentication (the safer of the two options
  // left open by Phase 4A.5 - fully logged-out access was explicitly flagged as
  // an unresolved owner decision and is deliberately NOT chosen here; see
  // BUILDHUB_PHASE4A61_VENDOR_PROFILE_IMPLEMENTATION.md). Scoped to provider-role
  // accounts only - this endpoint answers "what does this vendor look like,"
  // not "what does any BuildHub user look like."
  getPublic: protectedProcedure.input(z.object({ userId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select(PUBLIC_PROFILE_COLUMNS).from(users).where(eq(users.id, input.userId));
    if (!target || !providerRoles.includes(target.userRole as typeof providerRoles[number])) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor profile not found' });
    }
    return { ...target, completedProjects: await completedProjectCount(db, target.id) };
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
    const { url } = await storagePut(`avatars/${ctx.user.id}/${Date.now()}-avatar`, bytes, input.contentType);
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
const ADMIN_USER_LIST_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  username: users.username,
  role: users.role,
  userRole: users.userRole,
  accountStatus: users.accountStatus,
  frozenReason: users.frozenReason,
  verified: users.verified,
  isDummy: users.isDummy,
  accountSource: users.accountSource,
  invitationStatus: users.invitationStatus,
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
  stats: adminWith('users.read').query(async () => {
    const db = await getDb();
    if (!db) return { users: 0, projects: 0, products: 0, rfqs: 0, disputes: 0 };
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
  users: adminWith('users.read').query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select(ADMIN_USER_LIST_COLUMNS).from(users).orderBy(desc(users.createdAt)).limit(250);
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
    await db.insert(userAccountAuditEvents).values({ userId, actorId: ctx.user.id, action: input.sendInvitation ? 'admin_created_account_with_invite' : 'admin_created_account', source: 'admin_created', note: input.note || null });
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
    await db.insert(userAccountAuditEvents).values({ userId: input.userId, actorId: ctx.user.id, action: 'invitation_resent', source: 'admin_created', note: `Resent to ${target.email}` });
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
    await db.insert(userAccountAuditEvents).values({ userId: target.id, actorId: target.id, action: 'password_set_via_invitation', source: 'admin_created', note: 'Password successfully configured by user' });
    return { success: true, username: target.username };
  }),
  fullAuditReport: adminWith('audit.read').query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const events = await db.select().from(userAccountAuditEvents).orderBy(desc(userAccountAuditEvents.createdAt)).limit(1000);
    // COLUMN LIST, not `select().from(users)`.
    //
    // Nothing leaked: the projection below is already an explicit allowlist, so
    // no private column ever reached the response. But this pulled EVERY column
    // of EVERY user - passwordHash, invitationToken, openId - into process
    // memory to build an audit export, and it is the precise pattern
    // ADMIN_USER_LIST_COLUMNS exists to forbid, one endpoint over. The next
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
    await db.insert(userAccountAuditEvents).values({ userId, actorId: ctx.user.id, action: 'dummy_user_created', source: 'dummy', note: input.note || 'Created for testing' });
    return { success: true, userId, username, email };
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
    await db.insert(userAccountAuditEvents).values({
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
    await db.insert(userAccountAuditEvents).values({
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
    await db.insert(userAccountAuditEvents).values({ userId: input.userId, actorId: ctx.user.id, action: 'dummy_user_password_changed', source: 'dummy', note: 'Password updated by an administrator' });
    return { success: true };
  }),
  setDummyUserActive: adminWith('qa.manage').input(z.object({ userId: z.number().int().positive(), active: z.boolean(), note: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select().from(users).where(eq(users.id, input.userId));
    if (!target?.isDummy) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only dummy users can be changed here' });
    await db.update(users).set({ accountStatus: input.active ? 'active' : 'frozen', deactivatedAt: input.active ? null : new Date(), frozenAt: input.active ? null : new Date(), frozenReason: input.active ? null : (input.note || 'Disabled by an administrator') }).where(eq(users.id, input.userId));
    await db.insert(userAccountAuditEvents).values({ userId: input.userId, actorId: ctx.user.id, action: input.active ? 'dummy_user_activated' : 'dummy_user_deactivated', source: 'dummy', note: input.note });
    return { success: true, active: input.active };
  }),
  deleteDummyUser: adminWith('qa.manage').input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select().from(users).where(eq(users.id, input.userId));
    if (!target?.isDummy) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only dummy users can be deleted' });
    await db.insert(userAccountAuditEvents).values({ userId: input.userId, actorId: ctx.user.id, action: 'dummy_user_deleted', source: 'dummy', note: target.creationNote });
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
    const db = await getDb();
    if (!db) return null;
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
    const db = await getDb();
    if (!db) return [];
    return db.select().from(userAccountAuditEvents).where(eq(userAccountAuditEvents.userId, input.userId)).orderBy(desc(userAccountAuditEvents.createdAt)).limit(100);
  }),
  analyticsSummary: adminWith('audit.read').input(z.object({ includeDummy: z.boolean().default(false) }).optional()).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];
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
  // exposure risk as ADMIN_USER_LIST_COLUMNS above, found independently in the
  // two Compliance Queue endpoints below - both previously did a bare
  // `select().from(users)` and spread the full row (including passwordHash and
  // the live, still-usable invitationToken bearer credential) into the admin
  // dashboard's Compliance Queue / Applicant Detail response. Every field here
  // is traced to real consumption in client/src/pages/AdminDashboard.tsx's
  // compliance queue list, registration CSV export (shared/registrationMetrics.ts),
  // and the applicant detail dialog.
  complianceQueue: adminWith('marketplace.manage').input(z.object({ includeDummy: z.boolean().default(false) }).optional()).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];
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
    await db.insert(registrationReviewEvents).values(applicants.map(applicant => ({ userId: applicant.id, actorId: ctx.user.id, action: 'bulk_applicant_status_updated', status: input.status, note: input.note })));
    await notifyUsers(db, applicants.map(applicant => ({ userId: applicant.id, title: input.status === 'approved' ? 'Registration approved' : 'Registration rejected', body: input.note || `Your registration is ${input.status}`, type: 'compliance', link: '/compliance', messageKey: `notif.compliance.applicant.${input.status}`, messageParams: (input.note ? { note: input.note } : {}) as Record<string, string> })));
    return { success: true, updatedCount: applicants.length, onboardingStatus: input.status };
  }),
  verifyUser: adminWith('users.manage').input(z.object({ userId: z.number(), verified: z.boolean() })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    await db.update(users).set({ verified: input.verified }).where(eq(users.id, input.userId));
    return { success: true };
  }),
  setUserFrozen: adminWith('users.manage').input(z.object({ userId: z.number(), frozen: z.boolean(), reason: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    if (input.userId === ctx.user.id) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Administrators cannot freeze their own account' });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const action = input.frozen ? 'account_frozen' : 'account_unfrozen';
    const reasonText = input.frozen ? (input.reason || 'Suspended by an administrator') : 'Account unfrozen by administrator';
    await db.update(users).set({
      accountStatus: input.frozen ? 'frozen' : 'active',
      frozenAt: input.frozen ? new Date() : null,
      frozenReason: input.frozen ? reasonText : null,
    }).where(eq(users.id, input.userId));
    await db.insert(userAccountAuditEvents).values({
      userId: input.userId,
      actorId: ctx.user.id,
      action,
      note: reasonText,
    });
    return { success: true, status: input.frozen ? 'frozen' : 'active' };
  }),
  disputes: adminWith('support.manage').query(async () => {
    const db = await getDb();
    if (!db) return [];
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
    const db = await getDb();
    if (!db) return DEFAULT_ADMIN_SETTINGS;
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
    const db = await getDb();
    if (!db) return [];
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
    await db.insert(userAccountAuditEvents).values({
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

    await db.update(users).set({ adminRole: input.adminRole }).where(eq(users.id, input.userId));
    await db.insert(userAccountAuditEvents).values({
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
    const [target] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, input.userId));
    if (!target || target.role !== 'admin') throw new TRPCError({ code: 'NOT_FOUND', message: 'No such administrator' });

    await db.update(users).set({
      accountStatus: input.active ? 'active' : 'frozen',
      deactivatedAt: input.active ? null : new Date(),
      // Kills every existing session for this account when deactivating.
      ...(input.active ? {} : { sessionsInvalidBefore: revocationCutoff() }),
    }).where(eq(users.id, input.userId));

    await db.insert(userAccountAuditEvents).values({
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
    await db.insert(userAccountAuditEvents).values({
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
    await db.insert(userAccountAuditEvents).values({
      userId: input.userId, actorId: ctx.user.id, action: 'admin_password_reset_requested', source: 'admin_management',
      note: 'One-time password reset link issued; existing sessions revoked',
    });
    return { success: true, resetLink: `/admin/accept-invitation?token=${rawToken}`, expiresAt };
  }),

  /** Live invitation/reset links for one administrator. Hashes are never returned. */
  adminInvitations: superAdminProcedure.input(z.object({
    userId: z.number().int().positive(),
  })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];
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
    await db.insert(userAccountAuditEvents).values({
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

    await db.insert(userAccountAuditEvents).values({
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

      try {
        const { text } = await generateAIResponse({
          messages: [
            { role: 'system', content: systemPrompt + attachmentBlock + regulatoryBlock + referenceBlock + candidateBlock },
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
      let key: string;
      try {
        ({ key } = await storagePut(
          `ai-attachments/user-${ctx.user.id}/${validated.name}`,
          validated.bytes,
          validated.contentType,
        ));
      } catch (error) {
        if (error instanceof ObjectStorageNotConfiguredError) {
          throw new TRPCError({
            code: 'SERVICE_UNAVAILABLE',
            message: 'File attachments are not available on this deployment.',
          });
        }
        throw error;
      }
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
  analytics: analyticsRouter,
  admin: adminRouter,
  compliance: registrationRouter,
  billing: billingRouter,
  ai: aiRouter,
});

export type AppRouter = typeof appRouter;
