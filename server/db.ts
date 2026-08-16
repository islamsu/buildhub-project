import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import { InsertUser, users, userAccountAuditEvents } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export function normalizeEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

export function normalizeUsername(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) return undefined;
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByUsername(username: string) {
  const normalized = normalizeUsername(username);
  if (!normalized) return undefined;
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, normalized)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function upsertUser(user: InsertUser): Promise<{ created: boolean; linkedExisting: boolean; userId?: number }> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return { created: false, linkedExisting: false };
  }

  const normalizedEmail = normalizeEmail(user.email);
  const normalizedUsername = normalizeUsername(user.username);
  const existingByOpenId = await getUserByOpenId(user.openId);
  const existingByEmail = normalizedEmail ? await getUserByEmail(normalizedEmail) : undefined;
  const existing = existingByOpenId ?? existingByEmail;

  if (existing && existing.isDummy && !existingByOpenId) {
    throw new Error("A dummy account cannot be linked to an external sign-in identity");
  }
  if (existingByEmail && !existingByOpenId && existingByEmail.accountSource !== 'admin_created') {
    throw new Error("An account already exists for this email");
  }

  if (existing) {
    if (normalizedUsername && existing.username && existing.username !== normalizedUsername) {
      throw new Error("Username is already assigned to this account");
    }
    const updateSet: Record<string, unknown> = {
      name: user.name === undefined ? existing.name : user.name ?? null,
      email: normalizedEmail ?? existing.email ?? null,
      loginMethod: user.loginMethod === undefined ? existing.loginMethod : user.loginMethod ?? null,
      lastSignedIn: user.lastSignedIn ?? new Date(),
    };
    const linkedAdminAccount = Boolean(existingByEmail && !existingByOpenId && existing.accountSource === 'admin_created');
    if (linkedAdminAccount) updateSet.openId = user.openId;
    if (normalizedUsername && !existing.username) updateSet.username = normalizedUsername;
    await db.update(users).set(updateSet).where(eq(users.id, existing.id));
    if (linkedAdminAccount) {
      await db.insert(userAccountAuditEvents).values({ userId: existing.id, actorId: null, action: 'oauth_identity_linked', source: 'self_registered', note: 'Admin-created account claimed after matching OAuth email.' });
    }
    return { created: false, linkedExisting: linkedAdminAccount, userId: existing.id };
  }

  if (normalizedUsername && await getUserByUsername(normalizedUsername)) throw new Error("Username is already in use");

  const values: InsertUser = {
    openId: user.openId,
    username: normalizedUsername,
    name: user.name ?? null,
    email: normalizedEmail,
    loginMethod: user.loginMethod ?? null,
    lastSignedIn: user.lastSignedIn ?? new Date(),
    accountSource: user.accountSource ?? 'self_registered',
    isDummy: user.isDummy ?? false,
    createdBy: user.createdBy ?? null,
    creationNote: user.creationNote ?? null,
  };
  if (user.role !== undefined) values.role = user.role;
  else if (user.openId === ENV.ownerOpenId) values.role = 'admin';
  const result = await db.insert(users).values(values);
  const userId = Number(result[0]?.insertId);
  if (userId) {
    await db.insert(userAccountAuditEvents).values({ userId, actorId: user.createdBy ?? null, action: 'account_created', source: values.accountSource ?? 'self_registered', note: values.creationNote ?? null });
  }
  return { created: true, linkedExisting: false, userId };
}
