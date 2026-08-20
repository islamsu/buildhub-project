// ── SMTP mailer ────────────────────────────────────────────────────────────
//
// SMTP rather than any provider's own HTTP API, deliberately. Every service
// BuildHub might reasonably use - Amazon SES, Postmark, Resend, Mailgun,
// SendGrid, Brevo, or a self-hosted relay - speaks SMTP, so this one adapter
// works with all of them and switching later is a change of four environment
// variables rather than a change of code. Picking one vendor's REST API would
// have meant writing behaviour against a service nobody has chosen yet, which
// is the same mistake the payment adapter exists to avoid.
//
// Configuration is entirely environmental. Nothing here knows a hostname, a
// credential, or a sender address, and none of those may ever be committed.

import { createTransport, type Transporter } from "nodemailer";
import { ENV } from "./env";
import type { Mailer, OutboundEmail } from "./mailer";

export type SmtpConfig = {
  host: string;
  port: number;
  /** Implicit TLS (port 465). Port 587 negotiates STARTTLS instead. */
  secure: boolean;
  user?: string;
  password?: string;
  /** The From address. Must be on a domain the provider has verified. */
  from: string;
  /**
   * Permit a plaintext SMTP session. DEVELOPMENT ONLY - readSmtpConfig refuses
   * to set it in production, so no deployment can talk to a relay in the clear.
   */
  allowInsecure: boolean;
};

/**
 * Read SMTP settings from the environment.
 *
 * Returns null when SMTP_HOST is absent, which is how a deployment says "no
 * email configured" - it is not an error, and it leaves NullMailer in place so
 * every reset flow reports itself unavailable rather than pretending.
 */
export function readSmtpConfig(env = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;

  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`SMTP_PORT is not a valid port: ${env.SMTP_PORT}`);
  }

  const from = env.SMTP_FROM?.trim();
  if (!from) {
    // Without this the provider rejects every message, or worse accepts them
    // from an unverified address and quietly destroys the sending domain's
    // reputation. Better to refuse at boot.
    throw new Error("SMTP_HOST is set but SMTP_FROM is not; a verified sender address is required");
  }

  return {
    host,
    port,
    // 465 is implicit TLS; 587 and 25 start plaintext and upgrade via STARTTLS.
    // Explicit override for relays that do neither by convention.
    secure: env.SMTP_SECURE ? env.SMTP_SECURE.toLowerCase() === "true" : port === 465,
    user: env.SMTP_USER?.trim() || undefined,
    password: env.SMTP_PASSWORD || undefined,
    from,
    // Gated on the build mode, not on the variable alone. Setting
    // SMTP_ALLOW_INSECURE in production does nothing.
    allowInsecure: !ENV.isProduction && env.SMTP_ALLOW_INSECURE?.toLowerCase() === "true",
  };
}

export class SmtpMailer implements Mailer {
  readonly id = "smtp";
  private readonly transporter: Transporter;

  constructor(private readonly config: SmtpConfig) {
    this.transporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user ? { auth: { user: config.user, pass: config.password ?? "" } } : {}),
      // On a STARTTLS port, REQUIRE the upgrade rather than silently continuing
      // in plaintext when the server declines it. A password reset link sent in
      // the clear is a password reset link anyone on the path can use.
      //
      // The one exception is a development relay - MailHog, Mailpit, a local
      // Postfix - which typically speaks no TLS at all. readSmtpConfig only
      // ever sets allowInsecure outside production, so this cannot be switched
      // on in a real deployment however the environment is written.
      requireTLS: !config.secure && !config.allowInsecure,
      ...(config.allowInsecure ? { ignoreTLS: true } : {}),
      tls: { rejectUnauthorized: true },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(email: OutboundEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: email.to,
      subject: email.subject,
      text: email.body,
    });
  }

  /**
   * Prove the credentials work, without sending anything.
   *
   * Called at boot so a bad password surfaces in the startup log rather than
   * the first time a locked-out user asks for a reset.
   */
  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  close(): void {
    this.transporter.close();
  }
}

/**
 * Build the mailer this deployment should use.
 *
 * Three outcomes, in order:
 *   SMTP_HOST set     a real SMTP sender
 *   development       ConsoleMailer, so a developer can complete a reset flow
 *                     by copying the link out of the terminal
 *   production, unset NullMailer - refuses loudly, and auth.capabilities tells
 *                     the UI not to offer password reset at all
 */
export function resolveMailerFromEnv(env = process.env): { kind: "smtp"; mailer: SmtpMailer } | { kind: "console" } | { kind: "none" } {
  const config = readSmtpConfig(env);
  if (config) return { kind: "smtp", mailer: new SmtpMailer(config) };
  return ENV.isProduction ? { kind: "none" } : { kind: "console" };
}
