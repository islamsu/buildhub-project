import { z } from 'zod';
import { COOKIE_NAME } from '@shared/const';
import { getSessionCookieOptions } from './_core/cookies';
import { systemRouter } from './_core/systemRouter';
import { publicProcedure, protectedProcedure, router } from './_core/trpc';
import { TRPCError } from '@trpc/server';
import { getDb, getUserByEmail, getUserByUsername, normalizeEmail, normalizeUsername, revokeSession } from './db';
import { invokeLLM } from './_core/llm';
import { storagePut } from './storage';
import { isAllowedRfqAttachmentType, MAX_RFQ_ATTACHMENT_SIZE } from './rfqAttachments';
import { acceptQuotationSecure, rejectQuotationSecure } from './quotationWorkflow';
import { aiChatLimiters, getClientIp } from './_core/rateLimit';
import { notifyUser, notifyUsers } from './notifications';
import { isAllowedProjectDocumentType, clampProjectProgress } from '../shared/projectFeatures';
import {
  projects, milestones, tasks, documents, products,
  rfqs, quotations, messages, notifications, reviews,
  dailyLogs, expenses, users, disputes, adminSettings, progressReports, productQuestions,
  registrationDocuments, registrationDocumentSubmissions, registrationReviewEvents, userAccountAuditEvents,
} from '../drizzle/schema';
import { eq, desc, and, sql, inArray, notInArray } from 'drizzle-orm';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getComplianceRequirements, isComplianceRole, type ComplianceStatus, type ComplianceDocumentStatus } from '../shared/compliance';
import { sdk, type AuthenticatedUser } from './_core/sdk';
import {
  BILLING_CURRENCY, FOUNDER_OFFER_ENDS_AT_SETTING_KEY, FOUNDER_OFFER_MONTHS, GRACE_PERIOD_DAYS,
  PLAN_IDS, PLANS, TRIAL_DAYS, annualSavings,
} from '@shared/billing';
import {
  ADMIN_SUBSCRIPTION_COLUMNS, checkFounderEligibility, getBillingState, getBillingEvents, getSubscription,
} from './billing/service';
import { deriveBillingState } from './billing/domain';
import { isPaymentProviderConfigured } from './billing/provider';
import { vendorSubscriptions } from '../drizzle/schema';

const scryptAsync = promisify(scryptCallback);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash) return false;
  const [algorithm, salt, encodedKey] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !encodedKey || !/^[a-f0-9]+$/i.test(encodedKey)) return false;
  const storedKey = Buffer.from(encodedKey, 'hex');
  if (storedKey.length === 0) return false;
  const derivedKey = (await scryptAsync(password, salt, storedKey.length)) as Buffer;
  return derivedKey.length === storedKey.length && timingSafeEqual(derivedKey, storedKey);
}

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
      userRole: z.enum(['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager', 'admin']),
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
      return { success: true };
    }),
});

// ── Registration Compliance Router ─────────────────────────────────────────
const complianceProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isComplianceRole(ctx.user.userRole)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Professional onboarding is required for this role' });
  return next({ ctx });
});

const MAX_REGISTRATION_DOCUMENT_SIZE = 10 * 1024 * 1024;
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
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const requirements = getComplianceRequirements(ctx.user.userRole);
    const requirement = requirements.find(item => item.type === input.documentType);
    if (!requirement) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This document is not required for the selected role' });
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_REGISTRATION_DOCUMENT_SIZE) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Registration documents must be between 1 byte and 10MB' });
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const { key, url } = await storagePut(`registration/${ctx.user.id}/${Date.now()}-${safeName}`, bytes, input.contentType);
    const result = await db.insert(registrationDocuments).values({ userId: ctx.user.id, documentType: input.documentType, displayName: requirement.name, fileName: input.fileName, url, fileKey: key, mimeType: input.contentType, size: bytes.length, status: 'submitted', applicantNote: input.applicantNote });
    const documentId = Number(result[0].insertId);
    await db.insert(registrationDocumentSubmissions).values({ documentId, userId: ctx.user.id, documentType: input.documentType, fileName: input.fileName, url, fileKey: key, mimeType: input.contentType, size: bytes.length, status: 'submitted', applicantNote: input.applicantNote });
    await db.update(users).set({ onboardingStatus: 'under_review', onboardingReviewNotes: null }).where(eq(users.id, ctx.user.id));
    await db.insert(registrationReviewEvents).values({ userId: ctx.user.id, documentId, actorId: ctx.user.id, action: 'document_submitted', status: 'submitted', note: input.applicantNote });
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
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, input.projectId), eq(projects.ownerId, ctx.user.id)));
      if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this project' });
      const buffer = Buffer.from(input.base64, 'base64');
      if (buffer.length > 8 * 1024 * 1024) throw new TRPCError({ code: 'BAD_REQUEST', message: 'File too large (max 8MB)' });
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
  list: publicProcedure
    .input(z.object({ category: z.string().optional(), search: z.string().optional(), limit: z.number().default(24) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      let query = db.select().from(products).where(eq(products.active, true));
      return query.orderBy(desc(products.featured), desc(products.createdAt)).limit(input.limit);
    }),
  get: publicProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [product] = await db.select().from(products).where(eq(products.id, input.id));
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
    return db.select().from(productQuestions).where(eq(productQuestions.productId, input.productId)).orderBy(desc(productQuestions.createdAt));
  }),
  askQuestion: protectedProcedure.input(z.object({ productId: z.number(), question: z.string().min(2).max(2000) })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, input.productId));
    if (!product && input.productId > 10) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    const result = await db.insert(productQuestions).values({ productId: input.productId, askerId: ctx.user.id, question: input.question });
    return { id: Number(result[0].insertId) };
  }),
});

// ── RFQ Router ─────────────────────────────────────────────────────────────
const rfqRouter = router({
  list: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(rfqs).orderBy(desc(rfqs.createdAt)).limit(50);
  }),
  myList: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(rfqs).where(eq(rfqs.requesterId, ctx.user.id)).orderBy(desc(rfqs.createdAt));
  }),
  get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [rfq] = await db.select().from(rfqs).where(eq(rfqs.id, input.id));
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
      return { id: Number(result[0].insertId) };
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
      const buffer = Buffer.from(input.base64, 'base64');
      if (buffer.length > MAX_RFQ_ATTACHMENT_SIZE) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'File too large (max 8MB)' });
      }
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
  submitQuotation: approvedProviderProcedure
    .input(z.object({
      rfqId: z.number(),
      price: z.number(),
      timeline: z.number().optional(),
      warranty: z.string().optional(),
      paymentTerms: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await db.insert(quotations).values({
        ...input,
        providerId: ctx.user.id,
        price: String(input.price),
      });
      const [rfq] = await db.select({ requesterId: rfqs.requesterId, title: rfqs.title }).from(rfqs).where(eq(rfqs.id, input.rfqId));
      if (rfq) {
        await notifyUser(db, { userId: rfq.requesterId, title: 'New quotation received', body: `You received a new quotation for "${rfq.title}"`, type: 'quotation', link: '/rfq' });
      }
      return { success: true };
    }),
  acceptQuotation: protectedProcedure
    .input(z.object({ quotationId: z.number(), rfqId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return acceptQuotationSecure(input.rfqId, input.quotationId, ctx.user.id);
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
  send: protectedProcedure.input(z.object({ receiverId: z.number(), projectId: z.number().optional(), content: z.string().min(1), type: z.enum(['text', 'file', 'quotation']).default('text'), fileUrl: z.string().url().optional(), quotationId: z.number().optional() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    if (input.type === 'quotation') {
      if (!input.quotationId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Quotation reference is required' });
      const [quotation] = await db.select({ id: quotations.id }).from(quotations).where(eq(quotations.id, input.quotationId));
      if (!quotation) throw new TRPCError({ code: 'NOT_FOUND', message: 'Quotation not found' });
    }
    const result = await db.insert(messages).values({ ...input, senderId: ctx.user.id });
    return { id: Number(result[0].insertId), ...input, senderId: ctx.user.id };
  }),
  uploadAttachment: protectedProcedure.input(z.object({ fileName: z.string().min(1).max(255), contentType: z.string().startsWith('image/').or(z.literal('application/pdf')), base64: z.string().max(11_000_000) })).mutation(async ({ ctx, input }) => {
    const buffer = Buffer.from(input.base64, 'base64');
    if (buffer.length > 8 * 1024 * 1024) throw new TRPCError({ code: 'BAD_REQUEST', message: 'File too large (max 8MB)' });
    const safeName = input.fileName.replace(/[^\\w.-]+/g, '_');
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
      await notifyUser(db, { userId: input.revieweeId, title: 'New review received', body: `You received a new ${input.rating}-star review.`, type: 'review', link: '/provider' });
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
  // Same self-only guarantee as update: writes only to ctx.user.id's row.
  uploadAvatar: protectedProcedure.input(z.object({
    contentType: z.string().refine(isAllowedAvatarType, 'Only image files are supported'),
    base64: z.string().min(1),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_AVATAR_SIZE) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Avatar images must be between 1 byte and 2MB' });
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
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
  return next({ ctx });
});

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
  stats: adminProcedure.query(async () => {
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
  users: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select(ADMIN_USER_LIST_COLUMNS).from(users).orderBy(desc(users.createdAt)).limit(250);
  }),
  createUser: adminProcedure.input(z.object({
    username: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/),
    email: z.string().trim().email(),
    name: z.string().trim().min(1).max(255),
    phone: z.string().trim().max(32).optional(),
    userRole: z.enum(['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager', 'admin']),
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
      openId, username, name: input.name, email, phone: input.phone || null, loginMethod: 'admin_created', role: input.userRole === 'admin' ? 'admin' : 'user', userRole: input.userRole, accountSource: 'admin_created', isDummy: false, createdBy: ctx.user.id, creationNote: input.note || null, onboardingStatus: professional ? 'not_started' : 'approved', verified: !professional,
      invitationStatus: input.sendInvitation ? 'invitation_sent' : 'none',
      invitationToken: input.sendInvitation ? inviteToken : null,
      invitationExpiresAt: input.sendInvitation ? expiresAt : null,
      invitationSentAt: input.sendInvitation ? new Date() : null,
    });
    const userId = Number(result[0]?.insertId);
    await db.insert(userAccountAuditEvents).values({ userId, actorId: ctx.user.id, action: input.sendInvitation ? 'admin_created_account_with_invite' : 'admin_created_account', source: 'admin_created', note: input.note || null });
    return { success: true, userId, invitationLink: input.sendInvitation ? `/auth/setup-password?token=${inviteToken}` : null };
  }),
  resendInvitation: adminProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
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
  completeInvitation: publicProcedure.input(z.object({ token: z.string().min(10), password: z.string().min(6).max(128) })).mutation(async ({ input }) => {
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
  fullAuditReport: adminProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const events = await db.select().from(userAccountAuditEvents).orderBy(desc(userAccountAuditEvents.createdAt)).limit(1000);
    const allUsersList = await db.select().from(users);
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
  createDummyUser: adminProcedure.input(z.object({
    name: z.string().trim().min(1).max(255).optional(),
    username: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/).optional(),
    userRole: z.enum(['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager']),
    note: z.string().trim().max(1000).optional(),
    password: z.string().min(8).max(128).optional(),
  })).mutation(async ({ ctx, input }) => {
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
  setDummyUserPassword: adminProcedure.input(z.object({
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
  setDummyUserActive: adminProcedure.input(z.object({ userId: z.number().int().positive(), active: z.boolean(), note: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [target] = await db.select().from(users).where(eq(users.id, input.userId));
    if (!target?.isDummy) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only dummy users can be changed here' });
    await db.update(users).set({ accountStatus: input.active ? 'active' : 'frozen', deactivatedAt: input.active ? null : new Date(), frozenAt: input.active ? null : new Date(), frozenReason: input.active ? null : (input.note || 'Disabled by an administrator') }).where(eq(users.id, input.userId));
    await db.insert(userAccountAuditEvents).values({ userId: input.userId, actorId: ctx.user.id, action: input.active ? 'dummy_user_activated' : 'dummy_user_deactivated', source: 'dummy', note: input.note });
    return { success: true, active: input.active };
  }),
  deleteDummyUser: adminProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
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
  vendorBilling: adminProcedure.input(z.object({ userId: z.number().int().positive() })).query(async ({ input }) => {
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
      isPaid: state.isPaid,
      inTrial: state.inTrial,
      inGracePeriod: state.inGracePeriod,
      awaitingRenewalSync: state.awaitingRenewalSync,
      events: await getBillingEvents(input.userId, 50),
    };
  }),
  accountAudit: adminProcedure.input(z.object({ userId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(userAccountAuditEvents).where(eq(userAccountAuditEvents.userId, input.userId)).orderBy(desc(userAccountAuditEvents.createdAt)).limit(100);
  }),
  analyticsSummary: adminProcedure.input(z.object({ includeDummy: z.boolean().default(false) }).optional()).query(async ({ input }) => {
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
    if (sortedMonths.length === 0) {
      return [{ month: '2026-07', users: userRows.length, projects: projectRows.length }];
    }
    return sortedMonths.map(month => ({
      month,
      users: monthlyMap[month].users,
      projects: monthlyMap[month].projects,
    }));
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
  complianceQueue: adminProcedure.input(z.object({ includeDummy: z.boolean().default(false) }).optional()).query(async ({ input }) => {
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
  complianceApplicant: adminProcedure.input(z.object({ userId: z.number() })).query(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    const [applicant] = await db.select(COMPLIANCE_APPLICANT_COLUMNS).from(users).where(eq(users.id, input.userId));
    if (!applicant || !isComplianceRole(applicant.userRole)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Compliance applicant not found' });
    const docs = await db.select().from(registrationDocuments).where(eq(registrationDocuments.userId, input.userId)).orderBy(desc(registrationDocuments.createdAt));
    const history = await db.select().from(registrationDocumentSubmissions).where(eq(registrationDocumentSubmissions.userId, input.userId)).orderBy(desc(registrationDocumentSubmissions.createdAt)).limit(100);
    const events = await db.select().from(registrationReviewEvents).where(eq(registrationReviewEvents.userId, input.userId)).orderBy(desc(registrationReviewEvents.createdAt)).limit(100);
    return { applicant, requirements: getComplianceRequirements(applicant.userRole), documents: docs, history, events };
  }),
  reviewComplianceDocument: adminProcedure.input(z.object({
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
    await notifyUser(db, { userId: applicant.id, title, body, type: 'compliance', link: '/compliance' });
    return { success: true, documentStatus: input.status, onboardingStatus: overallStatus };
  }),
  updateApplicantStatus: adminProcedure.input(z.object({
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
    await notifyUser(db, { userId: input.userId, title: 'Registration status updated', body: input.note || `Your registration is now ${input.status.replace('_', ' ')}`, type: 'compliance', link: '/compliance' });
    return { success: true, onboardingStatus: input.status };
  }),
  bulkUpdateApplicantStatus: adminProcedure.input(z.object({
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
    await notifyUsers(db, applicants.map(applicant => ({ userId: applicant.id, title: input.status === 'approved' ? 'Registration approved' : 'Registration rejected', body: input.note || `Your registration is ${input.status}`, type: 'compliance', link: '/compliance' })));
    return { success: true, updatedCount: applicants.length, onboardingStatus: input.status };
  }),
  verifyUser: adminProcedure.input(z.object({ userId: z.number(), verified: z.boolean() })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    await db.update(users).set({ verified: input.verified }).where(eq(users.id, input.userId));
    return { success: true };
  }),
  setUserFrozen: adminProcedure.input(z.object({ userId: z.number(), frozen: z.boolean(), reason: z.string().max(500).optional() })).mutation(async ({ ctx, input }) => {
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
  disputes: adminProcedure.query(async () => {
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
  updateDispute: adminProcedure.input(z.object({
    disputeId: z.number(),
    status: z.enum(['open', 'investigating', 'resolved', 'rejected']),
    resolutionNotes: z.string().max(2000).optional(),
  })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    await db.update(disputes).set({ status: input.status, resolutionNotes: input.resolutionNotes }).where(eq(disputes.id, input.disputeId));
    return { success: true };
  }),
  settings: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return DEFAULT_ADMIN_SETTINGS;
    const rows = await db.select({ settingKey: adminSettings.settingKey, value: adminSettings.value }).from(adminSettings);
    return { ...DEFAULT_ADMIN_SETTINGS, ...Object.fromEntries(rows.map(row => [row.settingKey, row.value])) };
  }),
  updateSetting: adminProcedure.input(z.object({ key: z.string().min(1).max(120), value: z.string().max(2000) })).mutation(async ({ ctx, input }) => {
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
});

// ── AI Router ──────────────────────────────────────────────────────────────
const MAX_AI_MESSAGES = 40;
const MAX_AI_MESSAGE_LENGTH = 6000;
const MAX_AI_RESPONSE_TOKENS = 1024;

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

const aiRouter = router({
  chat: aiChatProcedure
    .input(z.object({
      messages: z.array(z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1).max(MAX_AI_MESSAGE_LENGTH),
      })).min(1).max(MAX_AI_MESSAGES),
    }))
    .mutation(async ({ input }) => {
      const response = await invokeLLM({ messages: input.messages as any, max_tokens: MAX_AI_RESPONSE_TOKENS });
      const raw = response.choices[0]?.message?.content;
      const content = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((c: any) => c.text ?? '').join('') : 'Sorry, I could not process your request.';
      return { content };
    }),
});

// ── Billing Router (Phase 4B.1) ────────────────────────────────────────────
// READ-ONLY by design. There is deliberately no vendor-callable mutation that
// changes a plan, price, or subscription status anywhere in this router: plan
// changes are driven by verified payment-provider events (Phase 4B.5), never
// by a client request. That is what structurally prevents a vendor from
// upgrading themselves by manipulating a payload - there is no such endpoint
// to manipulate, not merely a check that could be bypassed.
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
