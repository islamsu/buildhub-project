import type { getDb } from './db';
import { notifications } from '../drizzle/schema';

export type NotifyParams = {
  userId: number;
  title: string;
  body?: string;
  type?: string;
  link?: string;
};

type Db = Awaited<ReturnType<typeof getDb>>;

// Single seam for all user-facing notification dispatch, in-app or otherwise. Today it only
// writes the in-app `notifications` row (the only channel actually implemented). Email/SMS/push
// providers should be added inside these two functions - behind their own configured-credential
// checks - once BUILDHUB_EMAIL_* / BUILDHUB_SMS_* / push credentials exist, so call sites never
// need to change. A notification is best-effort: failures are logged, never thrown, so a
// notification bug can never fail the business operation that triggered it.
export async function notifyUser(db: Db, params: NotifyParams): Promise<void> {
  if (!db) return;
  try {
    await db.insert(notifications).values({
      userId: params.userId,
      title: params.title,
      body: params.body ?? null,
      type: params.type ?? 'info',
      link: params.link ?? null,
    });
  } catch (error) {
    console.warn('[Notifications] Failed to write in-app notification:', error);
  }
}

export async function notifyUsers(db: Db, paramsList: NotifyParams[]): Promise<void> {
  if (!db || paramsList.length === 0) return;
  try {
    await db.insert(notifications).values(paramsList.map(params => ({
      userId: params.userId,
      title: params.title,
      body: params.body ?? null,
      type: params.type ?? 'info',
      link: params.link ?? null,
    })));
  } catch (error) {
    console.warn('[Notifications] Failed to write in-app notifications:', error);
  }
}
