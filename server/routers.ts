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
import {
  projects, milestones, tasks, documents, products,
  rfqs, quotations, messages, notifications, reviews,
  dailyLogs, expenses, users,
} from '../drizzle/schema';
import { eq, desc, and, sql } from 'drizzle-orm';

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
      await db.update(users).set({ userRole: input.userRole, name: input.name, phone: input.phone, location: input.location }).where(eq(users.id, ctx.user.id));
      return { success: true };
    }),
});

// ── Projects Router ────────────────────────────────────────────────────────
const providerRoles = ['contractor', 'engineer', 'architect', 'supplier', 'project_manager'] as const;

const projectsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(projects).where(eq(projects.ownerId, ctx.user.id)).orderBy(desc(projects.createdAt));
  }),
  directory: protectedProcedure.query(async ({ ctx }) => {
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
  myProducts: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.userRole !== 'supplier') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Supplier access required' });
    }
    const db = await getDb();
    if (!db) return [];
    return db.select().from(products).where(eq(products.supplierId, ctx.user.id)).orderBy(desc(products.createdAt));
  }),
  create: protectedProcedure
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
      const { attachments, ...rest } = input;
      const result = await db.insert(rfqs).values({
        ...rest,
        requesterId: ctx.user.id,
        budget: input.budget != null ? String(input.budget) : undefined,
        attachments: attachments && attachments.length > 0 ? JSON.stringify(attachments) : undefined,
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
  myQuotations: protectedProcedure.query(async ({ ctx }) => {
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
  submitQuotation: protectedProcedure
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

const adminRouter = router({
  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { users: 0, projects: 0, products: 0, rfqs: 0 };
    const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(users);
    const [projectCount] = await db.select({ count: sql<number>`count(*)` }).from(projects);
    const [productCount] = await db.select({ count: sql<number>`count(*)` }).from(products);
    const [rfqCount] = await db.select({ count: sql<number>`count(*)` }).from(rfqs);
    return {
      users: Number(userCount?.count ?? 0),
      projects: Number(projectCount?.count ?? 0),
      products: Number(productCount?.count ?? 0),
      rfqs: Number(rfqCount?.count ?? 0),
    };
  }),
  users: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(users).orderBy(desc(users.createdAt)).limit(100);
  }),
  verifyUser: adminProcedure.input(z.object({ userId: z.number(), verified: z.boolean() })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
    await db.update(users).set({ verified: input.verified }).where(eq(users.id, input.userId));
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
  notifications: notificationsRouter,
  reviews: reviewsRouter,
  admin: adminRouter,
  ai: aiRouter,
});

export type AppRouter = typeof appRouter;
