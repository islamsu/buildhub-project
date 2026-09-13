/**
 * ── THE ADMIN REGISTRATION SURFACE, WHEREVER IT LIVES ─────────────────────
 *
 * Several guards assert that a capability of the professional-registration
 * workflow exists — applicant search, the date filters, bulk approval, the
 * document preview's loading and failure states, the truthful error-vs-empty
 * rule. Each of them read `client/src/pages/AdminDashboard.tsx`, because that
 * is where the workflow used to live.
 *
 * It lives in `client/src/components/AdminRegistrations.tsx` now: the
 * management interface was moved off the dashboard, and Pending Verifications
 * was consolidated into it because both were views of ONE query.
 *
 * A census that reads only the old file reports a capability MISSING while it
 * is implemented correctly next door — and, in the direction that actually
 * matters, would stop policing it. So the guards read the SURFACE rather than
 * a filename. Adding a third file to this list is how a future split stays
 * covered.
 */
import { readFileSync } from 'node:fs';

export const ADMIN_REGISTRATION_SURFACE_FILES = [
  '../../client/src/pages/AdminDashboard.tsx',
  '../../client/src/components/AdminRegistrations.tsx',
] as const;

/** Every file the admin registration/compliance workflow is spread across. */
export function adminRegistrationSurface(base: string | URL = import.meta.url): string {
  return ADMIN_REGISTRATION_SURFACE_FILES
    .map(file => readFileSync(new URL(file, base), 'utf8'))
    .join('\n');
}
