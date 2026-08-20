import {
  boolean,
  decimal,
  foreignKey,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';

// ── Users ──────────────────────────────────────────────────────────────────
export const users = mysqlTable('users', {
  id:          int('id').autoincrement().primaryKey(),
  openId:      varchar('openId', { length: 64 }).notNull().unique(),
  username:    varchar('username', { length: 100 }),
  name:        text('name'),
  email:       varchar('email', { length: 320 }),
  phone:       varchar('phone', { length: 32 }),
  loginMethod: varchar('loginMethod', { length: 64 }),
  role:        mysqlEnum('role', ['user', 'admin']).default('user').notNull(),
  accountSource: mysqlEnum('accountSource', ['self_registered', 'admin_created']).default('self_registered').notNull(),
  isDummy:     boolean('isDummy').default(false).notNull(),
  createdBy:   int('createdBy').references((): any => users.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  creationNote:text('creationNote'),
  deactivatedAt: timestamp('deactivatedAt'),
  accountStatus: mysqlEnum('accountStatus', ['active', 'frozen']).default('active').notNull(),
  frozenAt:    timestamp('frozenAt'),
  frozenReason: text('frozenReason'),
  userRole:    mysqlEnum('userRole', [
                 'homeowner', 'contractor', 'engineer', 'architect',
                 'supplier', 'project_manager', 'admin',
               ]).default('homeowner'),
  avatar:      text('avatar'),
  bio:         text('bio'),
  location:    varchar('location', { length: 255 }),
  verified:    boolean('verified').default(false),
  onboardingStatus: mysqlEnum('onboardingStatus', ['not_started', 'under_review', 'update_required', 'approved', 'rejected']).default('not_started').notNull(),
  onboardingReviewNotes: text('onboardingReviewNotes'),
  onboardingReviewedAt: timestamp('onboardingReviewedAt'),
  onboardingReviewedBy: int('onboardingReviewedBy').references((): any => users.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  invitationStatus: mysqlEnum('invitationStatus', ['none', 'invitation_sent', 'pending_setup', 'password_set', 'expired']).default('none').notNull(),
  invitationToken: varchar('invitationToken', { length: 128 }),
  invitationExpiresAt: timestamp('invitationExpiresAt'),
  invitationSentAt: timestamp('invitationSentAt'),
  passwordSetAt: timestamp('passwordSetAt'),
  passwordHash: text('passwordHash'),
  rating:      decimal('rating', { precision: 3, scale: 2 }).default('0.00'),
  reviewCount: int('reviewCount').default(0),
  createdAt:   timestamp('createdAt').defaultNow().notNull(),
  updatedAt:   timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
  lastSignedIn:timestamp('lastSignedIn').defaultNow().notNull(),
}, table => ({
  usernameUnique: uniqueIndex('users_username_unique').on(table.username),
  emailUnique: uniqueIndex('users_email_unique').on(table.email),
  createdByIdx: index('users_createdBy_idx').on(table.createdBy),
  onboardingReviewedByIdx: index('users_onboardingReviewedBy_idx').on(table.onboardingReviewedBy),
}));

// Phase 4A.6.6: server-side session revocation. Each signed session JWT now
// carries a unique `jti`; logout inserts that jti here so authenticateRequest
// can reject a replayed post-logout token instead of only clearing the cookie
// client-side. onDelete is CASCADE (not RESTRICT like most Phase 3C FKs, and
// not SET NULL like userAccountAuditEvents above): unlike an audit trail,
// a revocation record has no value once its user is gone - there is nothing
// left to protect from replay, so it should not block user deletion.
export const revokedSessions = mysqlTable('revokedSessions', {
  jti:       varchar('jti', { length: 36 }).primaryKey(),
  userId:    int('userId').notNull().references(() => users.id, { onDelete: 'cascade', onUpdate: 'restrict' }),
  revokedAt: timestamp('revokedAt').defaultNow().notNull(),
  // The token's own exp, copied here so a future cleanup job can prune rows
  // whose underlying JWT would already be rejected by expiry regardless.
  expiresAt: timestamp('expiresAt').notNull(),
}, table => ({
  userIdIdx: index('revokedSessions_userId_idx').on(table.userId),
}));

export const userAccountAuditEvents = mysqlTable('userAccountAuditEvents', {
  id:        int('id').autoincrement().primaryKey(),
  // Nullable + SET NULL (not RESTRICT): every user gets an audit event on creation
  // (see routers.ts 'dummy_user_created' etc.), so RESTRICT here would make it
  // impossible to ever delete any user — the audit trail must outlive its subject.
  userId:    int('userId').references(() => users.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  actorId:   int('actorId').references(() => users.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  action:    varchar('action', { length: 80 }).notNull(),
  source:    varchar('source', { length: 40 }),
  note:      text('note'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  userIdIdx: index('userAccountAuditEvents_userId_idx').on(table.userId),
  actorIdIdx: index('userAccountAuditEvents_actorId_idx').on(table.actorId),
}));

// ── Projects ───────────────────────────────────────────────────────────────
export const projects = mysqlTable('projects', {
  id:          int('id').autoincrement().primaryKey(),
  ownerId:     int('ownerId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  title:       varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  type:        mysqlEnum('type', [
                 'residential', 'commercial', 'renovation',
                 'finishing', 'maintenance', 'other',
               ]).default('residential'),
  status:      mysqlEnum('status', [
                 'planning', 'active', 'on_hold', 'completed', 'cancelled',
               ]).default('planning'),
  budget:      decimal('budget', { precision: 14, scale: 2 }),
  spent:       decimal('spent', { precision: 14, scale: 2 }).default('0.00'),
  progress:    int('progress').default(0),
  location:    varchar('location', { length: 255 }),
  startDate:   timestamp('startDate'),
  endDate:     timestamp('endDate'),
  createdAt:   timestamp('createdAt').defaultNow().notNull(),
  updatedAt:   timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
}, table => ({
  ownerIdIdx: index('projects_ownerId_idx').on(table.ownerId),
}));

// ── Milestones ─────────────────────────────────────────────────────────────
export const milestones = mysqlTable('milestones', {
  id:        int('id').autoincrement().primaryKey(),
  projectId: int('projectId').notNull().references(() => projects.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  title:     varchar('title', { length: 255 }).notNull(),
  dueDate:   timestamp('dueDate'),
  status:    mysqlEnum('status', ['pending', 'in_progress', 'completed']).default('pending'),
  progress:  int('progress').default(0),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  projectIdIdx: index('milestones_projectId_idx').on(table.projectId),
}));

// ── Tasks ──────────────────────────────────────────────────────────────────
export const tasks = mysqlTable('tasks', {
  id:          int('id').autoincrement().primaryKey(),
  projectId:   int('projectId').notNull().references(() => projects.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  milestoneId: int('milestoneId').references(() => milestones.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  assigneeId:  int('assigneeId').references(() => users.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  title:       varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  status:      mysqlEnum('status', ['todo', 'in_progress', 'done']).default('todo'),
  priority:    mysqlEnum('priority', ['low', 'medium', 'high']).default('medium'),
  dueDate:     timestamp('dueDate'),
  createdAt:   timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  projectIdIdx: index('tasks_projectId_idx').on(table.projectId),
  milestoneIdIdx: index('tasks_milestoneId_idx').on(table.milestoneId),
  assigneeIdIdx: index('tasks_assigneeId_idx').on(table.assigneeId),
}));

// ── Documents ──────────────────────────────────────────────────────────────
export const documents = mysqlTable('documents', {
  id:        int('id').autoincrement().primaryKey(),
  projectId: int('projectId').notNull().references(() => projects.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  uploaderId:int('uploaderId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  name:      varchar('name', { length: 255 }).notNull(),
  type:      mysqlEnum('type', ['drawing', 'boq', 'photo', 'contract', 'invoice', 'other']).default('other'),
  url:       text('url').notNull(),
  fileKey:   varchar('fileKey', { length: 255 }),
  size:      int('size'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  projectIdIdx: index('documents_projectId_idx').on(table.projectId),
  uploaderIdIdx: index('documents_uploaderId_idx').on(table.uploaderId),
}));

// ── Registration Compliance Documents ────────────────────────────────────────
export const registrationDocuments = mysqlTable('registrationDocuments', {
  id:         int('id').autoincrement().primaryKey(),
  userId:     int('userId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  documentType: varchar('documentType', { length: 100 }).notNull(),
  displayName: varchar('displayName', { length: 255 }).notNull(),
  fileName:   varchar('fileName', { length: 255 }).notNull(),
  url:        text('url').notNull(),
  fileKey:    varchar('fileKey', { length: 255 }),
  mimeType:   varchar('mimeType', { length: 100 }).notNull(),
  size:       int('size').notNull(),
  status:     mysqlEnum('status', ['submitted', 'under_review', 'approved', 'rejected', 'update_required']).default('submitted').notNull(),
  applicantNote: text('applicantNote'),
  reviewerNote: text('reviewerNote'),
  reviewedBy: int('reviewedBy').references(() => users.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  reviewedAt: timestamp('reviewedAt'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
}, table => ({
  userIdIdx: index('registrationDocuments_userId_idx').on(table.userId),
  reviewedByIdx: index('registrationDocuments_reviewedBy_idx').on(table.reviewedBy),
}));

// ── Registration Document Submission History ─────────────────────────────────
export const registrationDocumentSubmissions = mysqlTable('registrationDocumentSubmissions', {
  id:           int('id').autoincrement().primaryKey(),
  documentId:   int('documentId').notNull(),
  userId:       int('userId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  documentType: varchar('documentType', { length: 100 }).notNull(),
  fileName:     varchar('fileName', { length: 255 }).notNull(),
  url:          text('url').notNull(),
  fileKey:      varchar('fileKey', { length: 255 }),
  mimeType:     varchar('mimeType', { length: 100 }).notNull(),
  size:         int('size').notNull(),
  status:       mysqlEnum('status', ['submitted', 'under_review', 'approved', 'rejected', 'update_required']).default('submitted').notNull(),
  applicantNote:text('applicantNote'),
  createdAt:    timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  documentIdIdx: index('registrationDocumentSubmissions_documentId_idx').on(table.documentId),
  userIdIdx: index('registrationDocumentSubmissions_userId_idx').on(table.userId),
  documentIdFk: foreignKey({
    columns: [table.documentId],
    foreignColumns: [registrationDocuments.id],
    name: 'regDocSubmissions_documentId_fk',
  }).onDelete('restrict').onUpdate('restrict'),
}));

// ── Registration Compliance Audit Events ─────────────────────────────────────
export const registrationReviewEvents = mysqlTable('registrationReviewEvents', {
  id:         int('id').autoincrement().primaryKey(),
  userId:     int('userId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  documentId: int('documentId').references(() => registrationDocuments.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  actorId:    int('actorId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  action:     varchar('action', { length: 80 }).notNull(),
  status:     varchar('status', { length: 50 }),
  note:       text('note'),
  createdAt:  timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  userIdIdx: index('registrationReviewEvents_userId_idx').on(table.userId),
  documentIdIdx: index('registrationReviewEvents_documentId_idx').on(table.documentId),
  actorIdIdx: index('registrationReviewEvents_actorId_idx').on(table.actorId),
}));

// ── Marketplace Product Questions ──────────────────────────────────────────
export const productQuestions = mysqlTable('productQuestions', {
  id:         int('id').autoincrement().primaryKey(),
  productId:  int('productId').notNull().references(() => products.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  askerId:    int('askerId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  question:   text('question').notNull(),
  answer:     text('answer'),
  answeredAt: timestamp('answeredAt'),
  createdAt:  timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  productIdIdx: index('productQuestions_productId_idx').on(table.productId),
  askerIdIdx: index('productQuestions_askerId_idx').on(table.askerId),
}));

// ── Marketplace Products ───────────────────────────────────────────────────
export const products = mysqlTable('products', {
  id:          int('id').autoincrement().primaryKey(),
  supplierId:  int('supplierId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  name:        varchar('name', { length: 255 }).notNull(),
  nameAr:      varchar('nameAr', { length: 255 }),
  description: text('description'),
  descriptionAr: text('descriptionAr'),
  category:    varchar('category', { length: 100 }).notNull(),
  subCategory: varchar('subCategory', { length: 100 }),
  brand:       varchar('brand', { length: 100 }),
  origin:      varchar('origin', { length: 100 }),
  price:       decimal('price', { precision: 12, scale: 2 }),
  currency:    varchar('currency', { length: 10 }).default('EGP'),
  stock:       int('stock').default(0),
  unit:        varchar('unit', { length: 50 }),
  warranty:    varchar('warranty', { length: 100 }),
  deliveryDays:int('deliveryDays'),
  images:      text('images'),
  specs:       text('specs'),
  rating:      decimal('rating', { precision: 3, scale: 2 }).default('0.00'),
  reviewCount: int('reviewCount').default(0),
  featured:    boolean('featured').default(false),
  active:      boolean('active').default(true),
  createdAt:   timestamp('createdAt').defaultNow().notNull(),
  updatedAt:   timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
}, table => ({
  supplierIdIdx: index('products_supplierId_idx').on(table.supplierId),
}));

// ── RFQs ───────────────────────────────────────────────────────────────────
export const rfqs = mysqlTable('rfqs', {
  id:          int('id').autoincrement().primaryKey(),
  requesterId: int('requesterId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  projectId:   int('projectId').references(() => projects.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  title:       varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  category:    varchar('category', { length: 100 }),
  budget:      decimal('budget', { precision: 12, scale: 2 }),
  location:    varchar('location', { length: 255 }),
  deadline:    timestamp('deadline'),
  attachments: text('attachments'),
  productReference: json('productReference'),
  status:      mysqlEnum('status', ['open', 'closed', 'awarded']).default('open'),
  createdAt:   timestamp('createdAt').defaultNow().notNull(),
  updatedAt:   timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
}, table => ({
  requesterIdIdx: index('rfqs_requesterId_idx').on(table.requesterId),
  projectIdIdx: index('rfqs_projectId_idx').on(table.projectId),
}));

// ── Quotations ─────────────────────────────────────────────────────────────
export const quotations = mysqlTable('quotations', {
  id:           int('id').autoincrement().primaryKey(),
  rfqId:        int('rfqId').notNull().references(() => rfqs.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  providerId:   int('providerId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  price:        decimal('price', { precision: 12, scale: 2 }).notNull(),
  currency:     varchar('currency', { length: 10 }).default('EGP'),
  timeline:     int('timeline'),
  warranty:     varchar('warranty', { length: 100 }),
  paymentTerms: text('paymentTerms'),
  notes:        text('notes'),
  status:       mysqlEnum('status', ['pending', 'accepted', 'rejected']).default('pending'),
  createdAt:    timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  rfqIdIdx: index('quotations_rfqId_idx').on(table.rfqId),
  providerIdIdx: index('quotations_providerId_idx').on(table.providerId),
}));

// ── Messages ───────────────────────────────────────────────────────────────
export const messages = mysqlTable('messages', {
  id:         int('id').autoincrement().primaryKey(),
  senderId:   int('senderId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  receiverId: int('receiverId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  projectId:  int('projectId').references(() => projects.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  content:    text('content').notNull(),
  type:       mysqlEnum('type', ['text', 'file', 'quotation']).default('text'),
  fileUrl:    text('fileUrl'),
  quotationId:int('quotationId').references(() => quotations.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  read:       boolean('read').default(false),
  createdAt:  timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  senderIdIdx: index('messages_senderId_idx').on(table.senderId),
  receiverIdIdx: index('messages_receiverId_idx').on(table.receiverId),
  projectIdIdx: index('messages_projectId_idx').on(table.projectId),
  quotationIdIdx: index('messages_quotationId_idx').on(table.quotationId),
}));

// ── Notifications ──────────────────────────────────────────────────────────
export const notifications = mysqlTable('notifications', {
  id:        int('id').autoincrement().primaryKey(),
  userId:    int('userId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  title:     varchar('title', { length: 255 }).notNull(),
  body:      text('body'),
  type:      varchar('type', { length: 50 }).default('info'),
  read:      boolean('read').default(false),
  link:      varchar('link', { length: 255 }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  userIdReadIdx: index('notifications_userId_read_idx').on(table.userId, table.read),
}));

// ── Reviews ────────────────────────────────────────────────────────────────
export const reviews = mysqlTable('reviews', {
  id:         int('id').autoincrement().primaryKey(),
  projectId:  int('projectId').notNull().references(() => projects.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  reviewerId: int('reviewerId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  revieweeId: int('revieweeId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  rating:     int('rating').notNull(),
  comment:    text('comment'),
  verified:   boolean('verified').default(false),
  createdAt:  timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  projectIdIdx: index('reviews_projectId_idx').on(table.projectId),
  reviewerIdIdx: index('reviews_reviewerId_idx').on(table.reviewerId),
  revieweeIdIdx: index('reviews_revieweeId_idx').on(table.revieweeId),
}));

// ── Progress Reports ────────────────────────────────────────────────────────
export const progressReports = mysqlTable('progressReports', {
  id:          int('id').autoincrement().primaryKey(),
  projectId:   int('projectId').notNull().references(() => projects.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  authorId:    int('authorId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  title:       varchar('title', { length: 255 }).notNull(),
  summary:     text('summary').notNull(),
  progress:    int('progress').notNull().default(0),
  createdAt:   timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  projectIdIdx: index('progressReports_projectId_idx').on(table.projectId),
  authorIdIdx: index('progressReports_authorId_idx').on(table.authorId),
}));

// ── Disputes ────────────────────────────────────────────────────────────────
export const disputes = mysqlTable('disputes', {
  id:             int('id').autoincrement().primaryKey(),
  reporterId:     int('reporterId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  respondentId:   int('respondentId').references(() => users.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  projectId:      int('projectId').references(() => projects.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  title:          varchar('title', { length: 255 }).notNull(),
  description:    text('description').notNull(),
  type:           varchar('type', { length: 80 }).default('general').notNull(),
  priority:       mysqlEnum('priority', ['low', 'medium', 'high']).default('medium').notNull(),
  status:         mysqlEnum('status', ['open', 'investigating', 'resolved', 'rejected']).default('open').notNull(),
  resolutionNotes:text('resolutionNotes'),
  createdAt:      timestamp('createdAt').defaultNow().notNull(),
  updatedAt:      timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
}, table => ({
  reporterIdIdx: index('disputes_reporterId_idx').on(table.reporterId),
  respondentIdIdx: index('disputes_respondentId_idx').on(table.respondentId),
  projectIdIdx: index('disputes_projectId_idx').on(table.projectId),
}));

// ── Admin Settings ──────────────────────────────────────────────────────────
export const adminSettings = mysqlTable('adminSettings', {
  id:        int('id').autoincrement().primaryKey(),
  settingKey:varchar('settingKey', { length: 120 }).notNull().unique(),
  value:     text('value').notNull(),
  updatedBy: int('updatedBy').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
}, table => ({
  updatedByIdx: index('adminSettings_updatedBy_idx').on(table.updatedBy),
}));

// ── Daily Logs ─────────────────────────────────────────────────────────────
export const dailyLogs = mysqlTable('dailyLogs', {
  id:          int('id').autoincrement().primaryKey(),
  projectId:   int('projectId').notNull().references(() => projects.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  authorId:    int('authorId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  date:        timestamp('date').defaultNow().notNull(),
  description: text('description').notNull(),
  weather:     varchar('weather', { length: 50 }),
  workers:     int('workers'),
  createdAt:   timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  projectIdIdx: index('dailyLogs_projectId_idx').on(table.projectId),
  authorIdIdx: index('dailyLogs_authorId_idx').on(table.authorId),
}));

// ── Expenses ───────────────────────────────────────────────────────────────
export const expenses = mysqlTable('expenses', {
  id:          int('id').autoincrement().primaryKey(),
  projectId:   int('projectId').notNull().references(() => projects.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  category:    varchar('category', { length: 100 }),
  description: text('description'),
  amount:      decimal('amount', { precision: 12, scale: 2 }).notNull(),
  currency:    varchar('currency', { length: 10 }).default('EGP'),
  date:        timestamp('date').defaultNow(),
  receiptUrl:  text('receiptUrl'),
  createdAt:   timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  projectIdIdx: index('expenses_projectId_idx').on(table.projectId),
}));

// ── Vendor Subscriptions (Phase 4B.1) ──────────────────────────────────────
// Per-vendor commercial state. The plan CATALOGUE (prices, intervals,
// entitlements) deliberately does NOT live here - it is in shared/billing.ts,
// the single source of truth for every commercial value. This table holds only
// what is genuinely per-vendor and mutable.
//
// Exactly one row per vendor (userId is unique): the row is a live state
// machine that transitions in place, with the append-only audit trail in
// `billingEvents` below carrying the history. This is what makes "one founder
// offer per vendor, never retroactive, never re-granted" structurally
// enforceable rather than a rule that application code has to remember -
// `founderPriceUsedAt` is written once and never cleared, so a cancel-and-
// resubscribe cycle cannot silently re-award the offer.
//
// onDelete RESTRICT (the Phase 3C convention, not the CASCADE used by
// revokedSessions): a subscription is a financial record. Unlike a session
// revocation, it must not silently disappear with its user - deletion should
// be blocked and dealt with deliberately, exactly as it is for projects,
// quotations, and every other business row.
//
// Provider references are all NULLABLE and provider-agnostic by name: no
// Paymob/Stripe-specific column exists, so swapping or adding a provider is a
// new adapter (Phase 4B.5), not a migration. NO card, token, or credential
// data is stored here or anywhere else in BuildHub - provider-hosted checkout
// keeps that out of this system entirely.
export const vendorSubscriptions = mysqlTable('vendorSubscriptions', {
  id:        int('id').autoincrement().primaryKey(),
  userId:    int('userId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  plan:      mysqlEnum('plan', ['free', 'professional', 'premium']).default('free').notNull(),
  // 'free' is the resting state for any vendor without paid access, including
  // after a trial lapses, a cancellation completes, or a grace period expires.
  status:    mysqlEnum('status', ['free', 'trialing', 'active', 'past_due', 'canceled', 'expired']).default('free').notNull(),
  billingInterval: mysqlEnum('billingInterval', ['month', 'year']),
  currency:  varchar('currency', { length: 3 }).default('EGP').notNull(),
  // Price snapshot at the moment of subscription, so a later catalogue change
  // never retroactively rewrites what a vendor actually agreed to pay.
  priceAmount: decimal('priceAmount', { precision: 10, scale: 2 }),
  isFounderPrice: boolean('isFounderPrice').default(false).notNull(),
  // Set once, never cleared - the one-time-use guard described above.
  founderPriceUsedAt: timestamp('founderPriceUsedAt'),
  // When the discounted founder window ends and standard pricing takes over.
  founderPriceEndsAt: timestamp('founderPriceEndsAt'),
  // Phase 4B.4: write-once, never cleared - the same one-time-use discipline as
  // founderPriceUsedAt. Without it, a lapsed trial leaves the vendor unpaid and
  // therefore eligible to start another one, forever.
  trialStartedAt: timestamp('trialStartedAt'),
  trialEndsAt: timestamp('trialEndsAt'),
  currentPeriodStart: timestamp('currentPeriodStart'),
  currentPeriodEnd: timestamp('currentPeriodEnd'),
  cancelAtPeriodEnd: boolean('cancelAtPeriodEnd').default(false).notNull(),
  canceledAt: timestamp('canceledAt'),
  // Set when a renewal payment fails; downgrade happens once this passes.
  gracePeriodEndsAt: timestamp('gracePeriodEndsAt'),
  provider:  varchar('provider', { length: 40 }),
  providerCustomerRef: varchar('providerCustomerRef', { length: 191 }),
  providerSubscriptionRef: varchar('providerSubscriptionRef', { length: 191 }),
  providerPriceRef: varchar('providerPriceRef', { length: 191 }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
}, table => ({
  userIdUnique: uniqueIndex('vendorSubscriptions_userId_unique').on(table.userId),
  statusIdx: index('vendorSubscriptions_status_idx').on(table.status),
  // The three columns the scheduled lifecycle sweeps (Phase 4B.4) scan on.
  currentPeriodEndIdx: index('vendorSubscriptions_currentPeriodEnd_idx').on(table.currentPeriodEnd),
  trialEndsAtIdx: index('vendorSubscriptions_trialEndsAt_idx').on(table.trialEndsAt),
  gracePeriodEndsAtIdx: index('vendorSubscriptions_gracePeriodEndsAt_idx').on(table.gracePeriodEndsAt),
}));

// Append-only billing audit trail. Deliberately mirrors userAccountAuditEvents
// (nullable userId + SET NULL, not RESTRICT): like an account audit trail, a
// billing history must be able to outlive its subject, and RESTRICT here would
// make a user with any billing event undeletable forever.
export const billingEvents = mysqlTable('billingEvents', {
  id:        int('id').autoincrement().primaryKey(),
  userId:    int('userId').references(() => users.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  subscriptionId: int('subscriptionId').references(() => vendorSubscriptions.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  action:    varchar('action', { length: 80 }).notNull(),
  fromStatus: varchar('fromStatus', { length: 40 }),
  toStatus:  varchar('toStatus', { length: 40 }),
  // 'system' (scheduled lifecycle sweep), 'provider' (webhook), 'admin', 'vendor'.
  source:    varchar('source', { length: 40 }),
  actorId:   int('actorId').references(() => users.id, { onDelete: 'set null', onUpdate: 'restrict' }),
  note:      text('note'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  userIdIdx: index('billingEvents_userId_idx').on(table.userId),
  subscriptionIdIdx: index('billingEvents_subscriptionId_idx').on(table.subscriptionId),
  actorIdIdx: index('billingEvents_actorId_idx').on(table.actorId),
}));

// ── Vendor Service Categories (Phase 4B.3) ─────────────────────────────────
// A vendor's own declaration of which service categories they work in, drawn
// from the exact nine-value RFQ taxonomy in shared/rfqCategories.ts. This is
// what makes RFQ → vendor targeting possible without inventing a role-to-
// category mapping: BuildHub does not guess what an "engineer" does, each
// vendor states it.
//
// A vendor may declare many categories (one row each). RESTRICT on delete
// follows the Phase 3C convention; the unique index makes a duplicate
// declaration impossible at the database level rather than by application
// convention.
export const vendorCategories = mysqlTable('vendorCategories', {
  id:        int('id').autoincrement().primaryKey(),
  userId:    int('userId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  category:  varchar('category', { length: 100 }).notNull(),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  userCategoryUnique: uniqueIndex('vendorCategories_userId_category_unique').on(table.userId, table.category),
  // Drives the eligibility lookup in the RFQ → vendor direction.
  categoryIdx: index('vendorCategories_category_idx').on(table.category),
}));

// ── Qualified Enquiries (Phase 4B.3) ───────────────────────────────────────
// One row per qualified enquiry a vendor has consumed: the vendor opened the
// full detail of an RFQ they were genuinely eligible for.
//
// The UNIQUE (userId, rfqId) index is the load-bearing part of the design. It
// is what makes a credit idempotent per vendor+RFQ *at the database level*: a
// page refresh, a second browser tab, a duplicate API call, or a retry can
// never consume a second credit for the same opportunity, because the second
// insert is rejected by the constraint rather than by application logic that
// could race with itself. The uniqueness is deliberately NOT scoped by month -
// re-opening an RFQ in a later month must not charge the vendor again for a
// lead they already paid for.
//
// `yearMonth` is the UTC allowance period (Phase 4B.2's allowancePeriodFor),
// denormalised so the monthly count is a single indexed lookup and so history
// survives forever: rows are never deleted when a month rolls over, keeping
// the full record available for audit and analytics.
export const qualifiedEnquiries = mysqlTable('qualifiedEnquiries', {
  id:        int('id').autoincrement().primaryKey(),
  userId:    int('userId').notNull().references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  rfqId:     int('rfqId').notNull().references(() => rfqs.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
  /** 'YYYY-MM', UTC. The allowance period this credit was consumed in. */
  yearMonth: varchar('yearMonth', { length: 7 }).notNull(),
  /** The plan in force when the credit was consumed, for audit. Never re-read for enforcement. */
  planAtConsumption: varchar('planAtConsumption', { length: 20 }),
  /** The RFQ category that made this vendor eligible, for audit and troubleshooting. */
  matchedCategory: varchar('matchedCategory', { length: 100 }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, table => ({
  userRfqUnique: uniqueIndex('qualifiedEnquiries_userId_rfqId_unique').on(table.userId, table.rfqId),
  // The range this phase's FOR UPDATE lock is taken over, and the index the
  // monthly count reads - see server/billing/enquiries.ts.
  userMonthIdx: index('qualifiedEnquiries_userId_yearMonth_idx').on(table.userId, table.yearMonth),
  rfqIdIdx: index('qualifiedEnquiries_rfqId_idx').on(table.rfqId),
}));

// ── Types ──────────────────────────────────────────────────────────────────
export type User        = typeof users.$inferSelect;
export type InsertUser  = typeof users.$inferInsert;
export type Project     = typeof projects.$inferSelect;
export type Milestone   = typeof milestones.$inferSelect;
export type Task        = typeof tasks.$inferSelect;
export type Document    = typeof documents.$inferSelect;
export type ProductQuestion = typeof productQuestions.$inferSelect;
export type Product     = typeof products.$inferSelect;
export type Rfq         = typeof rfqs.$inferSelect;
export type Quotation   = typeof quotations.$inferSelect;
export type Message     = typeof messages.$inferSelect;
export type Notification= typeof notifications.$inferSelect;
export type Review      = typeof reviews.$inferSelect;
export type ProgressReport = typeof progressReports.$inferSelect;
export type Dispute     = typeof disputes.$inferSelect;
export type AdminSetting= typeof adminSettings.$inferSelect;
export type DailyLog    = typeof dailyLogs.$inferSelect;
export type Expense     = typeof expenses.$inferSelect;
export type VendorCategory = typeof vendorCategories.$inferSelect;
export type QualifiedEnquiry = typeof qualifiedEnquiries.$inferSelect;
export type VendorSubscription = typeof vendorSubscriptions.$inferSelect;
export type InsertVendorSubscription = typeof vendorSubscriptions.$inferInsert;
export type BillingEvent = typeof billingEvents.$inferSelect;
