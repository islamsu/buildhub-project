/**
 * Rendering a stored notification in the reader's language.
 *
 * PHASE 1B. `notifications.title` / `.body` hold ENGLISH PROSE rendered at
 * WRITE time. BuildHub's language is a per-viewer choice made at READ time, so
 * a stored sentence is wrong for half the audience from the moment it is
 * written: an Arabic-speaking contractor read "You received a new quotation"
 * in English, inside an otherwise fully Arabic interface.
 *
 * The server now also writes `messageKey` + `messageParams`. This resolves
 * them, and falls back to the stored prose in the two cases where it must:
 *
 *   - a row written BEFORE this change, which has no key at all;
 *   - a key this client build does not know, which happens whenever the server
 *     ships a new notification kind ahead of the client. `t()` returns the key
 *     itself when it is missing, and a raw key in the UI is worse than an
 *     English sentence, so an unresolved key falls back too.
 */

export type StoredNotification = {
  title: string;
  body?: string | null;
  messageKey?: string | null;
  messageParams?: unknown;
};

/** `{name}` substitution. Unknown placeholders are left alone rather than blanked. */
function fill(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole);
}

/**
 * A param whose NAME ends in `Key` holds a translation key, not a value.
 *
 * The server cannot localise a plan name: it does not know the reader's
 * language, which is the entire reason messageKey exists. But it also cannot
 * push the plan into the template, because "upgraded to Premium" and
 * "upgraded to Professional" are the same sentence with a different noun -
 * and hard-coding one of them into the message is exactly the fabrication the
 * brief forbids. So the server names the plan by KEY and the reader's client
 * resolves it, the same way it resolves the sentence around it.
 *
 * Only server-chosen keys from a fixed set ever travel this way. User-written
 * text goes in `note`, which is passed through verbatim and never resolved.
 */
function resolveKeyParams(
  params: Record<string, unknown>,
  t: (key: string) => string,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = { ...params };
  for (const [name, value] of Object.entries(params)) {
    if (!name.endsWith('Key') || typeof value !== 'string') continue;
    const resolved = t(value);
    // t() echoes the key when this client build has no translation for it.
    // Rendering `billing.plan.premium` to a vendor is worse than falling back
    // to the server's stored English sentence, so the caller does that.
    if (resolved === value) return null;
    out[name] = resolved;
  }
  return out;
}

function asParams(value: unknown): Record<string, unknown> {
  // messageParams is a JSON column: a driver may hand it back parsed or raw.
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function notificationText(
  notification: StoredNotification,
  t: (key: string) => string,
): { title: string; body: string | null } {
  const key = notification.messageKey;
  const fallback = { title: notification.title, body: notification.body ?? null };
  if (!key) return fallback;

  const titleKey = `${key}.title`;
  const title = t(titleKey);
  // t() echoes the key when there is no translation for it.
  if (title === titleKey) return fallback;

  const raw = asParams(notification.messageParams);
  const params = resolveKeyParams(raw, t);
  if (!params) return fallback;
  // An administrator's free-text note is theirs, in whatever language they
  // wrote it. It is passed through verbatim; only the sentence around it is
  // translated, which is why there is a separate `.bodyNote` template.
  const note = params.note;
  const hasNote = typeof note === 'string' && note.trim() !== '';
  const bodyKey = `${key}.${hasNote ? 'bodyNote' : 'body'}`;
  const bodyTemplate = t(bodyKey);

  return {
    title: fill(title, params),
    body: bodyTemplate === bodyKey ? fallback.body : fill(bodyTemplate, params),
  };
}
