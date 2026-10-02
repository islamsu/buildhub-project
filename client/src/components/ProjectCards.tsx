/**
 * ── A PROJECT CARD THAT DOES SOMETHING ──────────────────────────────────
 *
 * Six role workspaces rendered project cards, and all six rendered a plain
 * `<div className="rounded-xl border p-4">`. They looked exactly like every
 * actionable record in the product - a bordered tile with a title, a status
 * badge and a progress bar - and they were inert. A Project Manager clicked a
 * card in their own Project Queue and nothing happened.
 *
 * ── ONE COMPONENT, BECAUSE SIX COPIES IS WHY IT HAPPENED ────────────────
 *
 * The markup was duplicated per workspace with small differences, so "make the
 * card clickable" was six edits and nobody made any of them. §49 and §71: one
 * coherent system, and consolidate variants rather than patching each. These
 * two components are now the only project card in the product.
 *
 * ── AND THE TWO KINDS ARE DELIBERATELY DIFFERENT COMPONENTS ─────────────
 *
 * Not one component with a `variant` prop. A managed project opens the real
 * project workspace; an opportunity must never try to, because
 * `projects.directory` lists projects the reader has no access to and
 * `requireProjectAccess` would refuse. Two destinations, two authorization
 * stories, two components - so a future edit cannot accidentally give an
 * opportunity card the managed card's link.
 *
 * `shared/projectOpportunities.ts` decides which row earns which.
 *
 * ── WHAT MAKES THESE ACTIONABLE RATHER THAN CLICKABLE ───────────────────
 *
 * Both render an `<a>` through wouter's `Link`, so they are in the tab order,
 * respond to Enter, can be opened in a new tab, and show a real focus ring -
 * none of which a `<div onClick>` gives. Each carries a visible CTA in both
 * languages, because a card whose only affordance is a cursor change is a card
 * a keyboard user cannot discover.
 */
import { Link } from 'wouter';
import { ArrowRight, ArrowLeft, ClipboardList, FolderKanban, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { DirectoryProject, ProjectOpportunity } from '@shared/projectOpportunities';

type Lang = 'en' | 'ar';

/** Shared shell: the border, the hover and the focus ring, in one place. */
const CARD_CLASS =
  'group block rounded-xl border p-4 text-start transition-colors hover:border-primary/40 '
  + 'hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary '
  + 'focus-visible:ring-offset-2';

function ProgressBar({ progress, label, tone }: { progress: number; label: string; tone: string }) {
  return (
    <>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{label}</span><span>{progress}%</span>
      </div>
    </>
  );
}

/**
 * A project the reader OWNS or is an ACTIVE MEMBER of.
 *
 * Opens the real workspace. `requireProjectAccess` is what permits that; this
 * link is only how the reader gets there, and it is rendered only for rows that
 * came from `projects.list`.
 */
export function ManagedProjectCard({
  project, lang, progressLabel, statusLabel,
}: {
  project: DirectoryProject;
  lang: Lang;
  progressLabel: string;
  statusLabel: string;
}) {
  const Arrow = lang === 'ar' ? ArrowLeft : ArrowRight;
  const cta = lang === 'ar' ? 'افتح مساحة المشروع' : 'Open project workspace';
  return (
    <Link
      href={`/projects/${project.id}`}
      className={CARD_CLASS}
      data-testid="managed-project-card"
      aria-label={`${cta}: ${project.title}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{project.title}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            {project.location || (lang === 'ar' ? 'لم يحدد الموقع' : 'Location not set')}
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0">{statusLabel}</Badge>
      </div>
      <ProgressBar progress={Number(project.progress ?? 0)} label={progressLabel} tone="bg-primary" />
      <span
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary"
        data-testid="managed-project-cta"
      >
        <FolderKanban className="h-3.5 w-3.5" />{cta}
        <Arrow className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/**
 * A directory project the reader does NOT belong to, with an open request.
 *
 * ── IT DOES NOT LINK TO THE PROJECT, AND THAT IS THE POINT ─────────────
 *
 * The destination is the REQUEST, which is the canonical opportunity surface
 * and carries its own eligibility and allowance rules. Following it grants no
 * project access, so this card cannot become a way around
 * `requireProjectAccess`.
 *
 * It renders only what `projects.directory` returns - title, type, status,
 * location, progress. No budget, no owner, no description, no documents, no
 * members: `OPPORTUNITY_FORBIDDEN_FIELDS` names them and a test asserts this
 * file mentions none of them.
 */
export function ProjectOpportunityCard({
  opportunity, lang, progressLabel, statusLabel,
}: {
  opportunity: ProjectOpportunity;
  lang: Lang;
  progressLabel: string;
  statusLabel: string;
}) {
  const { project, requestId, requestCount } = opportunity;
  const Arrow = lang === 'ar' ? ArrowLeft : ArrowRight;
  const cta = lang === 'ar' ? 'اعرض الطلب المفتوح' : 'View the open request';
  const count = requestCount === 1
    ? (lang === 'ar' ? 'طلب مفتوح واحد' : '1 open request')
    : (lang === 'ar' ? `${requestCount} طلبات مفتوحة` : `${requestCount} open requests`);
  return (
    <Link
      href={`/rfq/${requestId}`}
      className={CARD_CLASS}
      data-testid="project-opportunity-card"
      aria-label={`${cta}: ${project.title}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{project.title}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            {project.location || (lang === 'ar' ? 'الموقع غير محدد' : 'Location not set')}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">{statusLabel}</Badge>
      </div>
      <ProgressBar progress={Number(project.progress ?? 0)} label={progressLabel} tone="bg-primary" />
      <span className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-medium text-muted-foreground" data-testid="project-opportunity-count">{count}</span>
        <span className="inline-flex items-center gap-1 font-medium text-primary" data-testid="project-opportunity-cta">
          <ClipboardList className="h-3.5 w-3.5" />{cta}
          <Arrow className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </Link>
  );
}
