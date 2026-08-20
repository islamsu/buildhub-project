import type { Express, Request } from "express";
import { and, eq } from "drizzle-orm";
import { getObjectStorage, isObjectStorageConfigured } from "./objectStorage";
import { sdk, type AuthenticatedUser } from "./sdk";
import { getDb } from "../db";
import { documents, messages, projects, registrationDocumentSubmissions } from "../../drizzle/schema";

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
export async function authorizeStorageKey(key: string, user: AuthenticatedUser | null): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'admin') return true; // Admins already have full user-data visibility elsewhere (compliance review, audit reports).

  // Category B (RFQ attachments): rfq.get/rfq.list already expose full RFQ detail - including
  // these attachments - to any authenticated user by design (open-bidding marketplace), so the
  // same rule applies here rather than inventing a stricter one the rest of the app doesn't have.
  if (key.startsWith('rfq-attachments/')) {
    return true;
  }

  // Category A (avatars): profile pictures, already shown on every public vendor
  // profile and directory card, so any authenticated user may fetch one - the
  // same rule as RFQ attachments above.
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
      res.status(500).send("Storage proxy not configured");
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
