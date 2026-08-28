import type { Express, Request } from "express";
import { and, eq } from "drizzle-orm";
import { getObjectStorage, isObjectStorageConfigured } from "./objectStorage";
import { sdk, type AuthenticatedUser } from "./sdk";
import { getDb } from "../db";
import { aiAttachments, documents, messages, projects, qualifiedEnquiries, registrationDocumentSubmissions, rfqs } from "../../drizzle/schema";
import { parseRfqAttachments } from "../../shared/rfqAttachments";

async function authenticateStorageRequest(req: Request): Promise<AuthenticatedUser | null> {
  try {
    return await sdk.authenticateRequest(req);
  } catch {
    return null;
  }
}

// Storage keys are classified by their prefix (set at upload time in server/routers.ts /
// server/storage.ts) into the categories below. Unpredictability of the key itself is never
// treated as authorization - every private category is verified against the owning DB record.
/**
 * A key that is safe to make an authorization DECISION about.
 *
 * Every branch below dispatches on a prefix - `key.startsWith('avatars/')` and
 * so on - and the same string is then handed to the storage adapter. If the key
 * can contain a `..` segment those two are no longer talking about the same
 * object: `avatars/../../something-else` satisfies the avatars branch, which
 * allows any authenticated user, and then asks the backend for a different
 * path entirely.
 *
 * THIS IS NOT EXPLOITABLE TODAY and the fix is still worth having. The only
 * configured backends are S3, where a key is an opaque string and `..` is a
 * literal segment that simply will not exist, and an HTTP API. It becomes a
 * real traversal the day anyone adds a filesystem-backed adapter, and the
 * person adding it would have no reason to suspect that the authorization
 * layer had been reasoning about a path it never validated.
 *
 * Fails closed, and is checked BEFORE the admin short-circuit: an admin is
 * allowed to read any legitimate key, not to read a malformed one.
 */
function isWellFormedStorageKey(key: string): boolean {
  if (key.length === 0 || key.length > 1024) return false;
  // No absolute paths, no Windows separators, no NUL or other control bytes.
  if (key.startsWith('/') || key.includes('\\')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F]/.test(key)) return false;
  // No traversal or empty segments - `a//b` and `a/./b` also address something
  // other than what they appear to.
  return key.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

export async function authorizeStorageKey(key: string, user: AuthenticatedUser | null): Promise<boolean> {
  if (!isWellFormedStorageKey(key)) return false;
  if (!user) return false;
  if (user.role === 'admin') return true; // Admins already have full user-data visibility elsewhere (compliance review, audit reports).

  // Category A (avatars): profile pictures, already shown on every public vendor
  // profile and directory card, so any authenticated user may fetch one. This is
  // now the ONLY blanket-allow category below admin - RFQ attachments used to
  // share it and no longer do.
  //
  // This branch was missing entirely. Avatars are written to `avatars/` by
  // profile.uploadAvatar, but with no case here every request fell through to
  // the fail-closed default at the end of this function, so the proxy returned
  // 403 to every non-admin and avatar images were simply broken.
  if (key.startsWith('avatars/')) {
    return true;
  }

  const db = await getDb();
  if (!db) return false;

  // Category B: RFQ attachments - the requester, plus any provider who has PAID
  // to open a qualified enquiry on that RFQ.
  //
  // This branch used to `return true` for every authenticated caller. Its
  // justification was that "rfq.get/rfq.list already expose full RFQ detail -
  // including these attachments - to any authenticated user by design", and
  // that was true when it was written. Slice 9 made it false: rfq.list now uses
  // a column allowlist that omits `attachments`, and rfq.get is scoped
  // `WHERE requesterId = ctx.user.id`. So the proxy became the LOOSEST surface
  // rather than the matching one - the drawings, BOQs and site photos behind a
  // paid enquiry were reachable by anyone who could name the key.
  //
  // Key unpredictability was never the authorization and is not relied on here
  // either: the 8 hex characters storagePut appends are 32 bits, and the rest of
  // the path is a small integer and the original filename.
  //
  // The uploader id is read from the key rather than searched for, because
  // rfq.uploadAttachment writes exactly `rfq-attachments/user-<id>/...` and that
  // is the only writer. Candidate RFQs are then scoped to that same user, which
  // has a second effect worth stating: an attacker who learns a key cannot
  // reference it from an RFQ of their own to grant themselves access, because
  // the lookup only ever considers RFQs owned by the ACTUAL uploader.
  //
  // Matched by exact string comparison in JS, not by SQL LIKE. `_` is a
  // wildcard in LIKE and a legal character in these keys (the filename
  // sanitiser produces it), so a LIKE would quietly match a DIFFERENT file.
  if (key.startsWith('rfq-attachments/')) {
    const uploaderId = Number(/^rfq-attachments\/user-(\d+)\//.exec(key)?.[1]);
    if (!Number.isInteger(uploaderId)) return false;
    // The requester's own file. No query needed, and it is the common case.
    if (uploaderId === user.id) return true;

    const owning = await db.select({ id: rfqs.id, attachments: rfqs.attachments })
      .from(rfqs)
      .where(eq(rfqs.requesterId, uploaderId));
    const match = owning.find(row => parseRfqAttachments(row.attachments).some(a => a.key === key));
    if (!match) return false;

    const [enquiry] = await db.select({ id: qualifiedEnquiries.id })
      .from(qualifiedEnquiries)
      .where(and(eq(qualifiedEnquiries.rfqId, match.id), eq(qualifiedEnquiries.userId, user.id)));
    return !!enquiry;
  }

  // Category F: AI attachments - the uploader ONLY.
  //
  // Narrower than every other category on purpose. An RFQ attachment is shown
  // to a provider who paid for the enquiry, and an avatar is public; a file
  // someone handed to the AI assistant has no second audience at all. Nobody
  // else has a reason to read it, so nobody else may.
  //
  // Resolved through the DATABASE ROW, not the key. The `user-<id>` segment in
  // the path is not trusted as authorization - it is not even parsed here -
  // because a key is a string an attacker may come to possess, and this row is
  // the only thing that records who the file belongs to. A soft-deleted
  // attachment is refused too: removing it from a conversation means the bytes
  // stop being reachable, not that the row stops being audited.
  if (key.startsWith('ai-attachments/')) {
    const [row] = await db.select({ userId: aiAttachments.userId, deletedAt: aiAttachments.deletedAt })
      .from(aiAttachments)
      .where(eq(aiAttachments.fileKey, key));
    return !!row && row.userId === user.id && row.deletedAt === null;
  }

  // Category D: compliance/registration documents - owner only (+ admin above).
  if (key.startsWith('registration/')) {
    const [row] = await db.select({ userId: registrationDocumentSubmissions.userId })
      .from(registrationDocumentSubmissions)
      .where(eq(registrationDocumentSubmissions.fileKey, key));
    return !!row && row.userId === user.id;
  }

  // Category C: private project files - project owner only, matching the ownership rule
  // already used for every other project sub-resource (see projectsRouter).
  if (key.startsWith('project-documents/')) {
    const [row] = await db.select({ projectId: documents.projectId })
      .from(documents)
      .where(eq(documents.fileKey, key));
    if (!row) return false;
    const [project] = await db.select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, row.projectId), eq(projects.ownerId, user.id)));
    return !!project;
  }

  // Category E: message attachments - only the sender or receiver of the message that
  // references this file may fetch it. storagePut returns `/manus-storage/{key}`, which is
  // exactly the value the client stores as messages.fileUrl.
  if (key.startsWith('message-attachments/')) {
    const url = `/manus-storage/${key}`;
    const [row] = await db.select({ senderId: messages.senderId, receiverId: messages.receiverId })
      .from(messages)
      .where(eq(messages.fileUrl, url));
    return !!row && (row.senderId === user.id || row.receiverId === user.id);
  }

  // Anything outside the classified categories above (e.g. unused/legacy prefixes) fails closed.
  return false;
}

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    const user = await authenticateStorageRequest(req);
    if (!user) {
      res.status(401).send("Authentication required");
      return;
    }

    const authorized = await authorizeStorageKey(key, user);
    if (!authorized) {
      res.status(403).send("You do not have access to this file");
      return;
    }

    // Slice 5: the backend is resolved by the adapter, not hardcoded here. This
    // block used to build a Forge presign URL inline, which meant two places in
    // the codebase knew where files physically live and only one of them would
    // have been migrated.
    if (!isObjectStorageConfigured()) {
      // 503, not 500. The same distinction the AI attachment path already
      // makes: nothing failed here, the deployment simply has no object
      // storage configured. A 500 tells an operator to go looking for a crash,
      // and tells a monitor to page somebody, for a missing environment
      // variable. The message says which it is without naming a bucket, a
      // host or a credential.
      res.status(503).send("File storage is not configured on this deployment");
      return;
    }

    try {
      const url = await getObjectStorage().signedGetUrl(key);
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      // The signed URL is short-lived and grants access on its own, so it must
      // never be cached by a browser or an intermediary.
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
