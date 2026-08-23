#!/usr/bin/env node
// ── Bootstrap the first administrator ──────────────────────────────────────
//
// BuildHub has no way to create an admin. `admin.createUser` and
// `admin.createDummyUser` are both adminProcedure, registration never sets
// role='admin', and there is no first-user rule. So on a freshly migrated
// database, creating an admin requires an admin. Nothing breaks that cycle
// from inside the running application, and that is a production cold-start
// dead end, not merely a staging inconvenience.
//
// THIS IS DELIBERATELY NOT AN APPLICATION FEATURE.
//
// The convenient fixes are all backdoors. An ADMIN_EMAIL env var that
// auto-promotes, a "first user to register becomes admin" rule, or a
// /bootstrap endpoint are each a privilege-escalation primitive that ships to
// production and stays there forever, reachable by anyone who finds it.
//
// So this is an operator tool, run out-of-band, once, by a human with database
// credentials. It leaves NO code path in the running application that can mint
// an admin. The friction is one-time; a backdoor would be permanent.
//
//   DATABASE_URL=... BOOTSTRAP_ADMIN_PASSWORD=... \
//     node scripts/create-admin.mjs --username buildhub-admin --email ops@example.com
//
// The password is read from the environment or prompted for interactively. It
// is NEVER accepted as a command-line argument: argv is visible to every other
// process on the box via ps, and lands in shell history.
//
// Refuses to run if an admin already exists. This bootstraps the FIRST one;
// every subsequent admin is created through the application by that admin,
// which is the audited path.

import { createInterface } from 'node:readline';
import { randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { createConnection } from 'mysql2/promise';

const scryptAsync = promisify(scryptCallback);

/**
 * Byte-for-byte the scheme server/routers.ts uses. Kept as its own copy on
 * purpose: this script must run with a bare `node` inside the production
 * image, where tsx is not installed and the server bundle does not re-export
 * it. server/adminBootstrap.test.ts cross-checks a hash produced here against
 * the application's OWN verifyPassword, in both directions, so the two cannot
 * drift apart silently.
 */
export async function hashPasswordForBootstrap(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

/** Matches the application's floor of 8; 12 is required of an admin. */
export const APP_PASSWORD_MIN_LENGTH = 8;
export const ADMIN_PASSWORD_MIN_LENGTH = 12;

export function validateAdminPassword(password) {
  if (typeof password !== 'string' || password.length === 0) return 'A password is required.';
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    return `An administrator password must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters ` +
      `(the application floor is ${APP_PASSWORD_MIN_LENGTH}; this account can create and freeze every other account).`;
  }
  if (password.length > 128) return 'Password must be at most 128 characters.';
  return null;
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : undefined;
}

async function promptSecret(question) {
  // No echo. Not perfect against a determined local attacker, but it keeps the
  // password off the screen and out of scrollback.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const original = rl._writeToOutput?.bind(rl);
  rl._writeToOutput = function (s) { if (original && !s.includes(question)) return; original?.(s); };
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

function sslOptions() {
  // Mirrors server/db.ts: production requires TLS unless told otherwise, and
  // the Render private hop sets DATABASE_SSL=disable.
  const mode = (process.env.DATABASE_SSL ?? 'require').toLowerCase();
  if (['disable', 'false', 'off'].includes(mode)) return {};
  return { ssl: { rejectUnauthorized: true } };
}

const fail = (message) => { console.error(`\n  REFUSED: ${message}\n`); process.exit(2); };

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) fail('DATABASE_URL is not set.');

  if (process.argv.some((a) => a === '--password' || a.startsWith('--password='))) {
    fail(
      'Do not pass the password as an argument - argv is world-readable via ps and lands in shell history. ' +
      'Use BOOTSTRAP_ADMIN_PASSWORD, or omit it and answer the prompt.',
    );
  }

  const username = (arg('username') ?? process.env.BOOTSTRAP_ADMIN_USERNAME ?? '').trim().toLowerCase();
  const email = (arg('email') ?? process.env.BOOTSTRAP_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const name = arg('name') ?? process.env.BOOTSTRAP_ADMIN_NAME ?? 'BuildHub Administrator';

  if (!username) fail('--username is required (or BOOTSTRAP_ADMIN_USERNAME).');
  if (!email) fail('--email is required (or BOOTSTRAP_ADMIN_EMAIL).');
  if (!/^[a-z0-9][a-z0-9._-]{2,99}$/.test(username)) fail(`Username "${username}" is not a valid username.`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(`Email "${email}" is not a valid address.`);

  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? (await promptSecret('Password for the new administrator: '));
  const invalid = validateAdminPassword(password);
  if (invalid) fail(invalid);

  const conn = await createConnection({ uri: url, ...sslOptions() });
  try {
    const [admins] = await conn.execute("SELECT id, username FROM users WHERE role = 'admin' LIMIT 5");
    if (admins.length > 0) {
      // Bootstrapping is for the FIRST admin only. Every later one is created
      // through the application by an existing admin, which is audited. A
      // script that can mint admin number two is a backdoor with extra steps.
      console.error(`\n  REFUSED: this database already has ${admins.length} administrator(s):`);
      for (const a of admins) console.error(`    - ${a.username ?? `(id ${a.id})`}`);
      console.error('\n  Create further administrators through the application, where the action is audited.\n');
      process.exit(3);
    }

    const [clash] = await conn.execute(
      'SELECT id FROM users WHERE username = ? OR email = ? LIMIT 1', [username, email],
    );
    if (clash.length > 0) fail(`A user already exists with that username or email. Choose another, or promote that account deliberately.`);

    const passwordHash = await hashPasswordForBootstrap(password);
    await conn.execute(
      `INSERT INTO users
         (openId, username, name, email, loginMethod, role, accountSource, isDummy,
          accountStatus, verified, onboardingStatus, invitationStatus, passwordHash,
          passwordSetAt, emailVerifiedAt)
       VALUES (?, ?, ?, ?, 'password', 'admin', 'admin_created', 0,
               'active', 1, 'approved', 'password_set', ?, NOW(), NOW())`,
      [`bootstrap_${randomUUID()}`, username, name, email, passwordHash],
    );

    const [created] = await conn.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [username]);
    console.log(`\n  Administrator created.`);
    console.log(`    id       ${created[0]?.id}`);
    console.log(`    username ${username}`);
    console.log(`    email    ${email}`);
    console.log(`\n  Sign in and change the password if it was supplied via the environment.`);
    console.log(`  This script will now REFUSE to run against this database again.\n`);
  } finally {
    await conn.end();
  }
}

// Only run when invoked directly, so the test can import the helpers above.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((error) => {
    // Never echo the password, and never echo a driver error that may carry the
    // connection string.
    console.error(`\n  FAILED: ${error?.code ?? error?.name ?? 'error'} while creating the administrator.\n`);
    process.exit(1);
  });
}
