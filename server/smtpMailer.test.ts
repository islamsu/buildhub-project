import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { readSmtpConfig } from './_core/smtpMailer';

/**
 * SMTP configuration.
 *
 * SMTP rather than a provider's own HTTP API, deliberately: every service
 * BuildHub might use - SES, Postmark, Resend, Mailgun, SendGrid, Brevo, a
 * self-hosted relay - speaks it, so switching provider is four environment
 * variables rather than a rewrite, and nothing here is written against a
 * service nobody has chosen yet.
 *
 * The property these tests exist to hold: A PASSWORD RESET LINK IS A BEARER
 * CREDENTIAL. It must never cross the network in the clear from a real
 * deployment, whatever the environment says.
 */

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const SOURCE = read('./_core/smtpMailer.ts');

vi.mock('./_core/env', () => ({ ENV: { isProduction: false } }));

afterEach(() => vi.resetModules());

const base = { SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'BuildHub <no-reply@buildhub.test>' };

// ── §1 Reading configuration ───────────────────────────────────────────────

describe('§1 readSmtpConfig', () => {
  it('returns null when SMTP_HOST is absent — not configured is not an error', () => {
    // This is how a deployment says "no email", and it leaves NullMailer in
    // place so the UI reports reset as unavailable instead of pretending.
    expect(readSmtpConfig({})).toBeNull();
    expect(readSmtpConfig({ SMTP_PORT: '587' })).toBeNull();
  });

  it('defaults to port 587, the STARTTLS submission port', () => {
    expect(readSmtpConfig(base)?.port).toBe(587);
  });

  it('infers implicit TLS on 465 and STARTTLS on 587', () => {
    expect(readSmtpConfig({ ...base, SMTP_PORT: '465' })?.secure).toBe(true);
    expect(readSmtpConfig({ ...base, SMTP_PORT: '587' })?.secure).toBe(false);
  });

  it('honours an explicit SMTP_SECURE for relays that follow neither convention', () => {
    expect(readSmtpConfig({ ...base, SMTP_PORT: '2525', SMTP_SECURE: 'true' })?.secure).toBe(true);
    expect(readSmtpConfig({ ...base, SMTP_PORT: '465', SMTP_SECURE: 'false' })?.secure).toBe(false);
  });

  it('REFUSES a host with no sender address', () => {
    // The provider would reject every message, or worse accept them from an
    // unverified address and quietly burn the sending domain's reputation.
    expect(() => readSmtpConfig({ SMTP_HOST: 'smtp.example.com' }))
      .toThrow(/SMTP_FROM/);
  });

  it('refuses a port that is not a port', () => {
    for (const port of ['0', '-1', '70000', 'abc', '25.5']) {
      expect(() => readSmtpConfig({ ...base, SMTP_PORT: port }), port).toThrow(/valid port/);
    }
  });

  it('allows an unauthenticated relay, which some internal setups are', () => {
    const config = readSmtpConfig(base);
    expect(config?.user).toBeUndefined();
    expect(config?.password).toBeUndefined();
  });

  it('trims stray whitespace rather than sending it to the provider', () => {
    const config = readSmtpConfig({ SMTP_HOST: '  smtp.example.com  ', SMTP_FROM: '  a@b.test  ', SMTP_USER: '  u  ' });
    expect(config?.host).toBe('smtp.example.com');
    expect(config?.from).toBe('a@b.test');
    expect(config?.user).toBe('u');
  });
});

// ── §2 Transport security ──────────────────────────────────────────────────

describe('§2 a reset link never crosses the network in the clear', () => {
  it('STARTTLS is required on a plaintext port by default', () => {
    expect(readSmtpConfig({ ...base, SMTP_PORT: '587' })?.allowInsecure).toBe(false);
    expect(SOURCE).toContain('requireTLS: !config.secure && !config.allowInsecure');
  });

  it('certificate verification is never disabled', () => {
    expect(SOURCE).toContain('rejectUnauthorized: true');
    expect(SOURCE).not.toContain('rejectUnauthorized: false');
  });

  it('the plaintext escape hatch is gated on the BUILD MODE, not the variable', () => {
    // Setting SMTP_ALLOW_INSECURE in production must do nothing at all. It
    // exists so a developer can talk to MailHog, and for no other reason.
    expect(SOURCE).toContain('!ENV.isProduction && env.SMTP_ALLOW_INSECURE');
  });

  it('development can opt into a plaintext local relay', async () => {
    expect(readSmtpConfig({ ...base, SMTP_ALLOW_INSECURE: 'true' })?.allowInsecure).toBe(true);
  });

  it('PRODUCTION IGNORES SMTP_ALLOW_INSECURE ENTIRELY', async () => {
    vi.resetModules();
    vi.doMock('./_core/env', () => ({ ENV: { isProduction: true } }));
    const { readSmtpConfig: production } = await import('./_core/smtpMailer');
    expect(production({ ...base, SMTP_ALLOW_INSECURE: 'true' })?.allowInsecure).toBe(false);
    vi.doUnmock('./_core/env');
  });
});

// ── §3 Wiring ──────────────────────────────────────────────────────────────

describe('§3 startup', () => {
  const startup = read('./_core/index.ts');

  it('resolves the mailer from the environment', () => {
    expect(startup).toContain('resolveMailerFromEnv()');
  });

  it('verifies the credentials at boot rather than on first use', () => {
    // A bad password should surface in the startup log, not the first time a
    // locked-out user asks for a reset.
    expect(startup).toContain('mail.mailer.verify()');
  });

  it('a failed verification is logged, NOT fatal', () => {
    // The rest of BuildHub works without email. Taking the site down over an
    // SMTP password turns a degraded feature into an outage.
    const block = startup.slice(startup.indexOf('const mail = resolveMailerFromEnv()'));
    expect(block.slice(0, 1400)).toContain('console.error');
    expect(block.slice(0, 1400)).not.toContain('process.exit');
  });

  it('a failed verification DEREGISTERS the mailer, so the UI stops offering reset', () => {
    // Found by the production dry run: an instance whose SMTP could not connect
    // still reported passwordReset: true, so the UI showed a button that could
    // only fail. Deregistering makes auth.capabilities tell the truth.
    const block = startup.slice(startup.indexOf('mail.mailer.verify()'));
    expect(block.slice(0, 600)).toContain('resetMailer()');
  });

  it('a deregistered mailer reports itself unconfigured', async () => {
    const { isMailerConfigured, resetMailer, setMailer } = await import('./_core/mailer');
    setMailer({ id: 'smtp', send: async () => {} });
    expect(isMailerConfigured()).toBe(true);
    resetMailer();
    expect(isMailerConfigured()).toBe(false);
  });

  it('falls back to the console mailer only outside production', () => {
    expect(SOURCE).toContain('ENV.isProduction ? { kind: "none" } : { kind: "console" }');
  });

  it('every SMTP variable is documented and none carries a value', () => {
    const env = read('../.env.example');
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']) {
      expect(env, key).toContain(`${key}=`);
    }
    // A credential must never be committed, not even as an example.
    expect(env).toMatch(/SMTP_PASSWORD=\s*$/m);
    expect(env).toMatch(/SMTP_HOST=\s*$/m);
  });

  it('no hostname, credential or sender address is hardcoded', () => {
    expect(SOURCE).not.toMatch(/smtp\.(gmail|sendgrid|mailgun|postmarkapp|resend)/i);
    expect(SOURCE).not.toMatch(/password\s*[:=]\s*["'][^"']+["']/);
  });
});
