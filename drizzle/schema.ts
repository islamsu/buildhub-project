import {
  boolean,
  decimal,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core';

// ── Users ──────────────────────────────────────────────────────────────────
export const users = mysqlTable('users', {
  id:          int('id').autoincrement().primaryKey(),
  openId:      varchar('openId', { length: 64 }).notNull().unique(),
  name:        text('name'),
  email:       varchar('email', { length: 320 }),
  phone:       varchar('phone', { length: 32 }),
  loginMethod: varchar('loginMethod', { length: 64 }),
  role:        mysqlEnum('role', ['user', 'admin']).default('user').notNull(),
  userRole:    mysqlEnum('userRole', [
                 'homeowner', 'contractor', 'engineer', 'architect',
                 'supplier', 'project_manager', 'admin',
               ]).default('homeowner'),
  avatar:      text('avatar'),
  bio:         text('bio'),
  location:    varchar('location', { length: 255 }),
  verified:    boolean('verified').default(false),
  rating:      decimal('rating', { precision: 3, scale: 2 }).default('0.00'),
  reviewCount: int('reviewCount').default(0),
  createdAt:   timestamp('createdAt').defaultNow().notNull(),
  updatedAt:   timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
  lastSignedIn:timestamp('lastSignedIn').defaultNow().notNull(),
});

// ── Projects ───────────────────────────────────────────────────────────────
export const projects = mysqlTable('projects', {
  id:          int('id').autoincrement().primaryKey(),
  ownerId:     int('ownerId').notNull(),
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
});

// ── Milestones ─────────────────────────────────────────────────────────────
export const milestones = mysqlTable('milestones', {
  id:        int('id').autoincrement().primaryKey(),
  projectId: int('projectId').notNull(),
  title:     varchar('title', { length: 255 }).notNull(),
  dueDate:   timestamp('dueDate'),
  status:    mysqlEnum('status', ['pending', 'in_progress', 'completed']).default('pending'),
  progress:  int('progress').default(0),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
});

// ── Tasks ──────────────────────────────────────────────────────────────────
export const tasks = mysqlTable('tasks', {
  id:          int('id').autoincrement().primaryKey(),
  projectId:   int('projectId').notNull(),
  milestoneId: int('milestoneId'),
  assigneeId:  int('assigneeId'),
  title:       varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  status:      mysqlEnum('status', ['todo', 'in_progress', 'done']).default('todo'),
  priority:    mysqlEnum('priority', ['low', 'medium', 'high']).default('medium'),
  dueDate:     timestamp('dueDate'),
  createdAt:   timestamp('createdAt').defaultNow().notNull(),
});

// ── Documents ──────────────────────────────────────────────────────────────
export const documents = mysqlTable('documents', {
  id:        int('id').autoincrement().primaryKey(),
  projectId: int('projectId').notNull(),
  uploaderId:int('uploaderId').notNull(),
  name:      varchar('name', { length: 255 }).notNull(),
  type:      mysqlEnum('type', ['drawing', 'boq', 'photo', 'contract', 'invoice', 'other']).default('other'),
  url:       text('url').notNull(),
  fileKey:   varchar('fileKey', { length: 255 }),
  size:      int('size'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
});

// ── Marketplace Products ───────────────────────────────────────────────────
export const products = mysqlTable('products', {
  id:          int('id').autoincrement().primaryKey(),
  supplierId:  int('supplierId').notNull(),
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
});

// ── RFQs ───────────────────────────────────────────────────────────────────
export const rfqs = mysqlTable('rfqs', {
  id:          int('id').autoincrement().primaryKey(),
  requesterId: int('requesterId').notNull(),
  projectId:   int('projectId'),
  title:       varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  category:    varchar('category', { length: 100 }),
  budget:      decimal('budget', { precision: 12, scale: 2 }),
  location:    varchar('location', { length: 255 }),
  deadline:    timestamp('deadline'),
  status:      mysqlEnum('status', ['open', 'closed', 'awarded']).default('open'),
  createdAt:   timestamp('createdAt').defaultNow().notNull(),
  updatedAt:   timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
});

// ── Quotations ─────────────────────────────────────────────────────────────
export const quotations = mysqlTable('quotations', {
  id:           int('id').autoincrement().primaryKey(),
  rfqId:        int('rfqId').notNull(),
  providerId:   int('providerId').notNull(),
  price:        decimal('price', { precision: 12, scale: 2 }).notNull(),
  currency:     varchar('currency', { length: 10 }).default('EGP'),
  timeline:     int('timeline'),
  warranty:     varchar('warranty', { length: 100 }),
  paymentTerms: text('paymentTerms'),
  notes:        text('notes'),
  status:       mysqlEnum('status', ['pending', 'accepted', 'rejected']).default('pending'),
  createdAt:    timestamp('createdAt').defaultNow().notNull(),
});

// ── Messages ───────────────────────────────────────────────────────────────
export const messages = mysqlTable('messages', {
  id:         int('id').autoincrement().primaryKey(),
  senderId:   int('senderId').notNull(),
  receiverId: int('receiverId').notNull(),
  projectId:  int('projectId'),
  content:    text('content').notNull(),
  type:       mysqlEnum('type', ['text', 'file', 'quotation']).default('text'),
  fileUrl:    text('fileUrl'),
  read:       boolean('read').default(false),
  createdAt:  timestamp('createdAt').defaultNow().notNull(),
});

// ── Notifications ──────────────────────────────────────────────────────────
export const notifications = mysqlTable('notifications', {
  id:        int('id').autoincrement().primaryKey(),
  userId:    int('userId').notNull(),
  title:     varchar('title', { length: 255 }).notNull(),
  body:      text('body'),
  type:      varchar('type', { length: 50 }).default('info'),
  read:      boolean('read').default(false),
  link:      varchar('link', { length: 255 }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
});

// ── Reviews ────────────────────────────────────────────────────────────────
export const reviews = mysqlTable('reviews', {
  id:         int('id').autoincrement().primaryKey(),
  projectId:  int('projectId').notNull(),
  reviewerId: int('reviewerId').notNull(),
  revieweeId: int('revieweeId').notNull(),
  rating:     int('rating').notNull(),
  comment:    text('comment'),
  verified:   boolean('verified').default(false),
  createdAt:  timestamp('createdAt').defaultNow().notNull(),
});

// ── Daily Logs ─────────────────────────────────────────────────────────────
export const dailyLogs = mysqlTable('dailyLogs', {
  id:          int('id').autoincrement().primaryKey(),
  projectId:   int('projectId').notNull(),
  authorId:    int('authorId').notNull(),
  date:        timestamp('date').defaultNow().notNull(),
  description: text('description').notNull(),
  weather:     varchar('weather', { length: 50 }),
  workers:     int('workers'),
  createdAt:   timestamp('createdAt').defaultNow().notNull(),
});

// ── Expenses ───────────────────────────────────────────────────────────────
export const expenses = mysqlTable('expenses', {
  id:          int('id').autoincrement().primaryKey(),
  projectId:   int('projectId').notNull(),
  category:    varchar('category', { length: 100 }),
  description: text('description'),
  amount:      decimal('amount', { precision: 12, scale: 2 }).notNull(),
  currency:    varchar('currency', { length: 10 }).default('EGP'),
  date:        timestamp('date').defaultNow(),
  receiptUrl:  text('receiptUrl'),
  createdAt:   timestamp('createdAt').defaultNow().notNull(),
});

// ── Types ──────────────────────────────────────────────────────────────────
export type User        = typeof users.$inferSelect;
export type InsertUser  = typeof users.$inferInsert;
export type Project     = typeof projects.$inferSelect;
export type Milestone   = typeof milestones.$inferSelect;
export type Task        = typeof tasks.$inferSelect;
export type Document    = typeof documents.$inferSelect;
export type Product     = typeof products.$inferSelect;
export type Rfq         = typeof rfqs.$inferSelect;
export type Quotation   = typeof quotations.$inferSelect;
export type Message     = typeof messages.$inferSelect;
export type Notification= typeof notifications.$inferSelect;
export type Review      = typeof reviews.$inferSelect;
export type DailyLog    = typeof dailyLogs.$inferSelect;
export type Expense     = typeof expenses.$inferSelect;

