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

  const params = asParams(notification.messageParams);
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
