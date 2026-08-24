// ── Password hashing ───────────────────────────────────────────────────────
//
// Lifted out of routers.ts unchanged so that code which needs only to hash a
// password - the administrator bootstrap, which runs at startup - can do so
// without importing the entire tRPC router graph and everything it pulls in.
//
// routers.ts re-exports both functions, so `import { hashPassword } from
// './routers'` keeps working exactly as before.
//
// scrypt with a fresh 16-byte salt per password and a constant-time comparison.
// Do not replace this with anything hand-rolled.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scryptCallback);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

/**
 * A real, well-formed scrypt hash of a value no account holds, used only so
 * `auth.signIn` can spend the same CPU on a nonexistent account as on a real
 * one. Verifying against it always fails; skipping verification entirely would
 * return in microseconds and leak which usernames exist.
 */
export const NO_SUCH_ACCOUNT_HASH =
  'scrypt$00000000000000000000000000000000$' + '0'.repeat(128);

export async function verifyPassword(password: string, storedHash: string | null | undefined): Promise<boolean> {
  if (!storedHash) return false;
  const [algorithm, salt, encodedKey] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !encodedKey || !/^[a-f0-9]+$/i.test(encodedKey)) return false;
  const storedKey = Buffer.from(encodedKey, 'hex');
  if (storedKey.length === 0) return false;
  const derivedKey = (await scryptAsync(password, salt, storedKey.length)) as Buffer;
  return derivedKey.length === storedKey.length && timingSafeEqual(derivedKey, storedKey);
}
