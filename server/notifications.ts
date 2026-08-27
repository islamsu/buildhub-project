import type { getDb } from './db';
import { notifications } from '../drizzle/schema';

export type NotifyParams = {
  userId: number;
  /** English fallback, kept for rows a client cannot resolve by key. */
  title: string;
  body?: string;
  type?: string;
  link?: string;
  /**
   * PHASE 1B. The translatable form of the same message.
   *
   * `title`/`body` above are English prose rendered at WRITE time, which is the
   * wrong time: BuildHub's language is a per-viewer choice made at READ time, so
   * a stored sentence is wrong for half the audience the moment it is written.
   *
   * `messageKey` names the message; the client resolves `<key>.title` and
   * `<key>.body` through the same t() as every other string. `messageParams`
   * carries the small facts that fill it. When a param named `note` is present
   * and non-empty the client resolves `<key>.bodyNote` instead - that is the
   * free-text an administrator wrote, which cannot be translated and is passed
   * through verbatim.
   *
   * PRIVACY: params are substitutions for a sentence, not a payload. Never put
   * a credential, a document, a file key or an email address in here.
   */
  messageKey?: string;
  messageParams?: Record<string, string | number>;
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
      messageKey: params.messageKey ?? null,
      messageParams: params.messageParams ?? null,
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
      messageKey: params.messageKey ?? null,
      messageParams: params.messageParams ?? null,
    })));
  } catch (error) {
    console.warn('[Notifications] Failed to write in-app notifications:', error);
  }
}
