// ── Outbound email adapter (Slice 3) ───────────────────────────────────────
//
// BuildHub has never sent an email. `admin.createUser` *returns* the invitation
// link in its API response for an admin to copy by hand, which works for a
// handful of seeded accounts and does not work at all for self-service password
// reset or address verification.
//
// This is the same seam as server/billing/provider.ts, for the same reason: the
// flows that need email must be written now, but the provider that delivers it
// is an owner decision with credentials attached. So the interface lands here,
// the default refuses loudly, and connecting a real sender is one new class.
//
// The rule this file exists to enforce: nothing in BuildHub may ever report
// "we sent you a link" when no link was sent. A reset flow that silently
// succeeds while delivering nothing strands the user with no way to tell
// whether to keep waiting.

export type OutboundEmail = {
  to: string;
  subject: string;
  /** Plain text only. No HTML templating layer exists, and none is needed yet. */
  body: string;
};

export interface Mailer {
  /** Stable identifier; 'none' means no delivery is possible. */
  readonly id: string;
  send(email: OutboundEmail): Promise<void>;
}

export class MailerNotConfiguredError extends Error {
  constructor(operation: string) {
    super(
      `No outbound email provider is configured; cannot ${operation}. ` +
        `Register one with setMailer() at startup.`,
    );
    this.name = 'MailerNotConfiguredError';
  }
}

/**
 * The default. Throws rather than resolving, so a caller that forgets to check
 * `isMailerConfigured()` fails visibly in development instead of shipping a
 * dead "check your inbox" screen to production.
 */
export class NullMailer implements Mailer {
  readonly id = 'none';

  async send(): Promise<void> {
    throw new MailerNotConfiguredError('send email');
  }
}

/**
 * Development only. Writes the message to the server log so a developer working
 * without an email provider can still complete a reset flow by copying the link
 * out of the terminal.
 *
 * `isMailerConfigured()` returns true for this, which is intentional: from the
 * application's point of view delivery genuinely did happen, to a destination
 * the developer can read. It must never be registered in production - the
 * caller in server/_core/index.ts guards on ENV.isProduction.
 */
export class ConsoleMailer implements Mailer {
  readonly id = 'console';

  async send(email: OutboundEmail): Promise<void> {
    console.log(
      `\n[mailer:console] to=${email.to}\n[mailer:console] subject=${email.subject}\n${email.body}\n`,
    );
  }
}

let activeMailer: Mailer = new NullMailer();

export function getMailer(): Mailer {
  return activeMailer;
}

/** Registration seam for a real provider adapter (and for tests). */
export function setMailer(mailer: Mailer): void {
  activeMailer = mailer;
}

export function resetMailer(): void {
  activeMailer = new NullMailer();
}

export function isMailerConfigured(): boolean {
  return activeMailer.id !== 'none';
}
