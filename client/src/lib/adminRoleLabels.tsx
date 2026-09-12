/**
 * ── THE ADMIN ROLE VOCABULARY, IN ONE PLACE ───────────────────────────────
 *
 * `ROLE_GROUPS`, `labelForRole`, `formatComplianceStatus` and `EmptyState` all
 * began inside AdminDashboard.tsx. Professional Registrations moved out of
 * that file into its own management page and needs every one of them, and a
 * second copy of a label table is how two admin screens come to call the same
 * status two different things.
 *
 * This is a MOVE, not a fork: AdminDashboard imports these now rather than
 * defining them.
 */
import type { ReactNode } from 'react';

export const ROLE_GROUPS = [
  { key: 'homeowner', en: 'Homeowners', ar: 'أصحاب المنازل' },
  { key: 'contractor', en: 'Contractors', ar: 'المقاولون' },
  { key: 'engineer', en: 'Engineers', ar: 'المهندسون' },
  { key: 'architect', en: 'Architects', ar: 'المهندسون المعماريون' },
  { key: 'supplier', en: 'Suppliers', ar: 'الموردون' },
  { key: 'project_manager', en: 'Project Managers', ar: 'مديرو المشاريع' },
  { key: 'admin', en: 'Administrators', ar: 'المشرفون' },
];

export function labelForRole(role: string | null | undefined, lang: 'en' | 'ar') {
  const found = ROLE_GROUPS.find(group => group.key === role);
  return found ? (lang === 'ar' ? found.ar : found.en) : role || (lang === 'ar' ? 'غير محدد' : 'Unassigned');
}

export function formatComplianceStatus(status: string | null | undefined, lang: 'en' | 'ar') {
  const labels: Record<string, [string, string]> = { not_started: ['Not started', 'لم يبدأ'], submitted: ['Submitted', 'تم الإرسال'], under_review: ['Under review', 'قيد المراجعة'], update_required: ['Update required', 'يتطلب تحديثاً'], approved: ['Approved', 'تمت الموافقة'], rejected: ['Rejected', 'مرفوض'] };
  return status ? (labels[status]?.[lang === 'ar' ? 1 : 0] ?? status) : '—';
}

/**
 * The one sentence a screen shows when there is genuinely nothing to show.
 *
 * Deliberately NOT the sentence a failed query shows - see LoadFailed. An
 * empty state standing in for an error tells an administrator that a queue is
 * clear when it may be on fire.
 */
export function EmptyState({ text }: { text: ReactNode }) {
  return <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">{text}</div>;
}
