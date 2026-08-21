import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import { InsertUser, users, userAccountAuditEvents, revokedSessions } from "../drizzle/schema";
import { readFileSync } from "node:fs";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

/**
 * TLS options for the database connection.
 *
 * This path previously passed DATABASE_URL to drizzle as a bare string, which
 * means mysql2 opens an UNENCRYPTED connection unless the URL itself carries
 * ssl parameters. That is survivable when the database is a unix socket on the
 * same box, and wrong the moment it is a managed instance reached across a
 * network - either the provider refuses the connection outright, or worse it
 * accepts it and every query, credential and customer record crosses the
 * network in the clear.
 *
 * Controlled by DATABASE_SSL:
 *
 *   require   verify the server certificate. Managed providers issue their own
 *             CA, so DATABASE_CA_CERT points at the PEM bundle they supply.
 *   disable   plain connection. The local-development default, and the only
 *             way to talk to a socket-local MariaDB without ceremony.
 *
 * PRODUCTION DEFAULTS TO require. A deployment that genuinely needs plain
 * transport has to say so explicitly, because the failure it prevents is
 * silent and total.
 */
function resolveSslOptions(): { ssl?: object } {
  const mode = (process.env.DATABASE_SSL ?? (ENV.isProduction ? "require" : "disable")).toLowerCase();
  if (mode === "disable" || mode === "false" || mode === "off") return {};

  const ca = process.env.DATABASE_CA_CERT;
  return {
    ssl: {
      // Never weakened to false. An unverified TLS connection stops a passive
      // listener and does nothing at all about an active one, while looking
      // exactly as reassuring in a config file.
      rejectUnauthorized: true,
      ...(ca ? { ca: ca.includes("BEGIN CERTIFICATE") ? ca : readFileSync(ca, "utf8") } : {}),
    },
  };
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const ssl = resolveSslOptions();
      _db = Object.keys(ssl).length > 0
        ? drizzle({ connection: { uri: process.env.DATABASE_URL, ...ssl } })
        : drizzle(process.env.DATABASE_URL);
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

// Session revocation (Phase 4A.6.6), hardened in the Phase 4B readiness audit.
//
// This one deliberately does NOT follow the graceful-degradation convention
// used elsewhere in this file. It previously returned false when the database
// was unreachable, which meant a database blip silently re-validated every
// revoked session - disabling the exact control logout revocation exists to
// provide, at precisely the moment nobody is watching.
//
// It now fails CLOSED: an unreachable database cannot prove a session is still
// valid, so the session is treated as revoked. The availability cost is close
// to zero, because every authenticated operation in the app already needs the
// database and degrades to nothing without it - so failing closed here does not
// take down anything that was still working.
export async function isSessionRevoked(jti: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;
  const result = await db.select({ jti: revokedSessions.jti }).from(revokedSessions).where(eq(revokedSessions.jti, jti)).limit(1);
  return result.length > 0;
}

export async function revokeSession(jti: string, userId: number, expiresAt: Date): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(revokedSessions).values({ jti, userId, expiresAt })
    .onDuplicateKeyUpdate({ set: { revokedAt: new Date() } });
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
