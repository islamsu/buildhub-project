import { z } from 'zod';
import { COOKIE_NAME } from '@shared/const';
import { getSessionCookieOptions } from './_core/cookies';
import { systemRouter } from './_core/systemRouter';
import { publicProcedure, protectedProcedure, router } from './_core/trpc';
import { TRPCError } from '@trpc/server';
import { getDb } from './db';
import { invokeLLM } from './_core/llm';
import { storagePut } from './storage';
import { isAllowedRfqAttachmentType, MAX_RFQ_ATTACHMENT_SIZE } from './rfqAttachments';
import { isAllowedProjectDocumentType, clampProjectProgress } from '../shared/projectFeatures';
import {
  projects, milestones, tasks, documents, products,
  rfqs, quotations, messages, notifications, reviews,
  dailyLogs, expenses, users, disputes, adminSettings, progressReports, productQuestions,
  registrationDocuments, registrationDocumentSubmissions, registrationReviewEvents,
} from '../drizzle/schema';
import { eq, desc, and, sql, inArray } from 'drizzle-orm';
import { getComplianceRequirements, isComplianceRole, type ComplianceStatus, type ComplianceDocumentStatus } from '../shared/compliance';

// ── Auth Router ────────────────────────────────────────────────────────────
const authRouter = router({
  me: publicProcedure.query(opts => opts.ctx.user),
  logout: publicProcedure.mutation(({ ctx }) => {
    const cookieOptions = getSessionCookieOptions(ctx.req);
    ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    return { success: true } as const;
  }),
  updateRole: protectedProcedure
    .input(z.object({
      userRole: z.enum(['homeowner', 'contractor', 'engineer', 'architect', 'supplier', 'project_manager', 'admin']),
      name: z.string().optional(),
      phone: z.string().optional(),
      location: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await db.update(users).set({ userRole: input.userRole, name: input.name, phone: input.phone, location: input.location, onboardingStatus: isComplianceRole(input.userRole) ? 'not_started' : 'approved', verified: isComplianceRole(input.userRole) ? false : true }).where(eq(users.id, ctx.user.id));
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
    return db.select().from(projects).orderBy(desc(projects.updatedAt)).limit(50);
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
    return db.select().from(milestones).where(eq(milestones.projectId, input.projectId)).orderBy(milestones.dueDate);
  }),
  addMilestone: protectedProcedure
    .input(z.object({ projectId: z.number(), title: z.string(), dueDate: z.date().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await db.insert(milestones).values(input);
      return { success: true };
    }),
  tasks: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(tasks).where(eq(tasks.projectId, input.projectId)).orderBy(desc(tasks.createdAt));
  }),
  addTask: protectedProcedure
    .input(z.object({ projectId: z.number(), title: z.string(), description: z.string().optional(), priority: z.enum(['low', 'medium', 'high']).optional(), dueDate: z.date().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await db.insert(tasks).values(input);
      return { success: true };
    }),
  updateTask: protectedProcedure
    .input(z.object({ id: z.number(), status: z.enum(['todo', 'in_progress', 'done']).optional(), title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const { id, ...data } = input;
      await db.update(tasks).set(data).where(eq(tasks.id, id));
      return { success: true };
    }),
  expenses: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(expenses).where(eq(expenses.projectId, input.projectId)).orderBy(desc(expenses.date));
  }),
  addExpense: protectedProcedure
    .input(z.object({ projectId: z.number(), category: z.string().optional(), description: z.string().optional(), amount: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await db.insert(expenses).values({ ...input, amount: String(input.amount) });
      return { success: true };
    }),
  dailyLogs: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(dailyLogs).where(eq(dailyLogs.projectId, input.projectId)).orderBy(desc(dailyLogs.date));
  }),
  addDailyLog: protectedProcedure
    .input(z.object({ projectId: z.number(), description: z.string(), weather: z.string().optional(), workers: z.number().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
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
  quotations: protectedProcedure.input(z.object({ rfqId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    if (!db) return [];
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
        providerRating:   users.rating,
        providerReviews:  users.reviewCount,
        providerVerified: users.verified,
        providerRole:     users.userRole,
        providerLocation: users.location,
      })
      .from(quotations)
      .leftJoin(users, eq(quotations.providerId, users.id))
      .where(eq(quotations.rfqId, input.rfqId))
      .orderBy(quotations.price);
    return rows;
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
      return { success: true };
    }),
  acceptQuotation: protectedProcedure
    .input(z.object({ quotationId: z.number(), rfqId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [rfq] = await db.select().from(rfqs).where(and(eq(rfqs.id, input.rfqId), eq(rfqs.requesterId, ctx.user.id)));
      if (!rfq) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this RFQ' });
      await db.update(quotations).set({ status: 'accepted' }).where(eq(quotations.id, input.quotationId));
      await db.update(quotations).set({ status: 'rejected' }).where(
        and(eq(quotations.rfqId, input.rfqId), sql`id != ${input.quotationId}`)
      );
      await db.update(rfqs).set({ status: 'awarded' }).where(eq(rfqs.id, input.rfqId));
      return { success: true };
    }),
  rejectQuotation: protectedProcedure
    .input(z.object({ quotationId: z.number(), rfqId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [rfq] = await db.select().from(rfqs).where(and(eq(rfqs.id, input.rfqId), eq(rfqs.requesterId, ctx.user.id)));
      if (!rfq) throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this RFQ' });
      await db.update(quotations).set({ status: 'rejected' }).where(eq(quotations.id, input.quotationId));
      return { success: true };
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
  submit: protectedProcedure
    .input(z.object({ projectId: z.number(), revieweeId: z.number(), rating: z.number().min(1).max(5), comment: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      // Only allow verified post-project reviews
      const [project] = await db.select().from(projects).where(and(eq(projects.id, input.projectId), eq(projects.status, 'completed')));
      if (!project) throw new TRPCError({ code: 'FORBIDDEN', message: 'Reviews only allowed for completed projects' });
      await db.insert(reviews).values({ ...input, reviewerId: ctx.user.id, verified: true });
      return { success: true };
    }),
});

// ── Admin Router ───────────────────────────────────────────────────────────
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' });
  return next({ ctx });
});

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
};

const adminRouter = router({
  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { users: 0, projects: 0, products: 0, rfqs: 0, disputes: 0 };
    const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(users);
    const [projectCount] = await db.select({ count: sql<number>`count(*)` }).from(projects);
    const [productCount] = await db.select({ count: sql<number>`count(*)` }).from(products);
    const [rfqCount] = await db.select({ count: sql<number>`count(*)` }).from(rfqs);
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
    return db.select().from(users).orderBy(desc(users.createdAt)).limit(250);
  }),
  complianceQueue: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const applicants = await db.select().from(users).where(inArray(users.userRole, providerRoles));
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
    const [applicant] = await db.select().from(users).where(eq(users.id, input.userId));
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
    await db.insert(notifications).values({ userId: applicant.id, title, body, type: 'compliance', link: '/compliance' });
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
    await db.insert(notifications).values({ userId: input.userId, title: 'Registration status updated', body: input.note || `Your registration is now ${input.status.replace('_', ' ')}`, type: 'compliance', link: '/compliance' });
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
    await db.insert(notifications).values(applicants.map(applicant => ({ userId: applicant.id, title: input.status === 'approved' ? 'Registration approved' : 'Registration rejected', body: input.note || `Your registration is ${input.status}`, type: 'compliance', link: '/compliance' })));
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
    await db.update(users).set({
      accountStatus: input.frozen ? 'frozen' : 'active',
      frozenAt: input.frozen ? new Date() : null,
      frozenReason: input.frozen ? (input.reason || 'Suspended by an administrator') : null,
    }).where(eq(users.id, input.userId));
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

// ── App Router ─────────────────────────────────────────────────────────────
const aiRouter = router({
  chat: publicProcedure
    .input(z.object({
      messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string() })),
    }))
    .mutation(async ({ input }) => {
      const response = await invokeLLM({ messages: input.messages as any });
      const raw = response.choices[0]?.message?.content;
      const content = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((c: any) => c.text ?? '').join('') : 'Sorry, I could not process your request.';
      return { content };
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
  admin: adminRouter,
  compliance: registrationRouter,
  ai: aiRouter,
});

export type AppRouter = typeof appRouter;
