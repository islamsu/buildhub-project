/**
 * The PROJECT half of "role + project + question".
 *
 * Until now ai.chat knew who was asking and what role they held, and nothing
 * about what they were working on. A homeowner asking "am I over budget?" got
 * a general essay about construction budgets.
 *
 * Three rules shape everything here, and each of them says NO to something the
 * obvious implementation would do:
 *
 *   AUTHORIZATION BEFORE RETRIEVAL. A project reaches this module only through
 *   a query that already constrains it - ownerId for the person who owns it,
 *   the allowlisted directory columns for an approved provider. There is no
 *   path where a projectId from the request selects a row that ownership did
 *   not already permit. The id chooses among what the caller may see; it never
 *   widens it.
 *
 *   RELEVANT, NOT EVERYTHING. The brief is explicit: do not dump all user and
 *   project data into every request. A question with no project bearing gets no
 *   project block at all, and a resolved project contributes a handful of
 *   fields, not a row dump.
 *
 *   ASK, DO NOT GUESS. Somebody with three projects who asks "when does mine
 *   finish?" is not asking about the most recently updated one. The model is
 *   told to ask which, and given the titles to offer - it is not handed three
 *   projects and left to pick.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { getDb } from '../db';
import { projects } from '../../drizzle/schema';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** What an owner may see of their own project. Never another owner's. */
export type OwnedProject = {
  id: number;
  title: string;
  type: string | null;
  status: string | null;
  location: string | null;
  progress: number | null;
  budget: string | null;
  spent: string | null;
  startDate: Date | null;
  endDate: Date | null;
};

/**
 * What an approved provider may see. The SAME allowlist projects.directory
 * uses, for the same reason recorded there: budget and spent are owner-private
 * and a lead listing must never carry them.
 */
export type DirectoryProject = {
  id: number;
  title: string;
  type: string | null;
  status: string | null;
  location: string | null;
  progress: number | null;
};

export type ProjectContext =
  /** No project bears on this question, or the caller has none. */
  | { kind: 'none' }
  /** Exactly one project applies, and the caller is authorized for it. */
  | { kind: 'resolved'; scope: 'owner'; project: OwnedProject }
  | { kind: 'resolved'; scope: 'directory'; project: DirectoryProject }
  /** Several could apply and the question does not say which. ASK. */
  | { kind: 'ambiguous'; choices: { id: number; title: string }[] }
  /** A project was named that this caller may not see, or does not exist. */
  | { kind: 'unauthorized' };

/** The five roles that read the project directory rather than owning projects. */
const PROVIDER_ROLES = ['contractor', 'engineer', 'architect', 'supplier', 'project_manager'] as const;

/**
 * Does this question bear on a project at all?
 *
 * Deliberately conservative: a false negative costs a little context, a false
 * positive spends a database round trip and pushes project data into a request
 * that had no business carrying it. Arabic cues are first-class, not an
 * afterthought - the product is bilingual and half its users type in Arabic.
 */
const PROJECT_CUES = [
  /\bmy project\b/i, /\bthe project\b/i, /\bthis project\b/i, /\bmy build\b/i,
  /\bmy site\b/i, /\bon site\b/i, /\bmy villa\b/i, /\bmy apartment\b/i,
  /\bover budget\b/i, /\bmy budget\b/i, /\bspent so far\b/i, /\bremaining budget\b/i,
  /\bmy timeline\b/i, /\bmy schedule\b/i, /\bfinish(ed)? by\b/i, /\bbehind schedule\b/i,
  /\bprogress\b/i, /\bmilestone/i, /\bhandover\b/i,
  /مشروعي/, /المشروع/, /موقعي/, /ميزانيتي/, /الميزانية/, /جدولي الزمني/, /التقدم/, /متأخر/,
];

export function questionMentionsAProject(question: string): boolean {
  return PROJECT_CUES.some(cue => cue.test(question));
}

/**
 * Resolve the project context for one request.
 *
 * `selectedProjectId` is a SELECTOR, not an authorization claim. It picks among
 * the rows the caller may already see; every branch below re-derives that set
 * from the session, so naming somebody else's id yields `unauthorized` rather
 * than their project.
 */
export async function resolveProjectContext(params: {
  db: Db;
  userId: number;
  userRole: string | null | undefined;
  question: string;
  selectedProjectId?: number;
}): Promise<ProjectContext> {
  const { db, userId, userRole, question, selectedProjectId } = params;
  const isProvider = PROVIDER_ROLES.includes(userRole as typeof PROVIDER_ROLES[number]);

  // Nothing to retrieve if the question is not about a project and none was
  // chosen. This is the common case and it costs no query at all.
  if (selectedProjectId === undefined && !questionMentionsAProject(question)) {
    return { kind: 'none' };
  }

  if (!isProvider) {
    // OWNER SCOPE. The predicate carries ownerId, so an id belonging to anybody
    // else simply does not come back.
    const owned = await db.select({
      id: projects.id, title: projects.title, type: projects.type, status: projects.status,
      location: projects.location, progress: projects.progress, budget: projects.budget,
      spent: projects.spent, startDate: projects.startDate, endDate: projects.endDate,
    }).from(projects)
      .where(selectedProjectId === undefined
        ? eq(projects.ownerId, userId)
        : and(eq(projects.ownerId, userId), eq(projects.id, selectedProjectId)))
      .orderBy(desc(projects.updatedAt))
      .limit(25);

    if (selectedProjectId !== undefined) {
      return owned.length === 1
        ? { kind: 'resolved', scope: 'owner', project: owned[0] as OwnedProject }
        : { kind: 'unauthorized' };
    }
    if (owned.length === 0) return { kind: 'none' };
    if (owned.length === 1) return { kind: 'resolved', scope: 'owner', project: owned[0] as OwnedProject };
    return { kind: 'ambiguous', choices: owned.map(row => ({ id: row.id, title: row.title })) };
  }

  // PROVIDER SCOPE. A provider owns no projects; what they may read is the
  // directory, with budget and spent withheld. Only an explicitly chosen
  // project is resolved - a provider who asks "how is the project going" has
  // no "mine" to infer, and guessing from a 50-row directory would be worse
  // than saying nothing.
  if (selectedProjectId === undefined) return { kind: 'none' };

  const [row] = await db.select({
    id: projects.id, title: projects.title, type: projects.type,
    status: projects.status, location: projects.location, progress: projects.progress,
  }).from(projects).where(eq(projects.id, selectedProjectId));

  return row
    ? { kind: 'resolved', scope: 'directory', project: row as DirectoryProject }
    : { kind: 'unauthorized' };
}

/** A short, human line - never a row dump. */
function line(label: string, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return `${label}: ${value instanceof Date ? value.toISOString().slice(0, 10) : String(value)}`;
}

/**
 * The block handed to the model.
 *
 * Written as instructions ABOUT data rather than as data alone, because the
 * failure worth preventing is the model treating an ambiguous case as an
 * invitation to choose.
 */
export function formatProjectContext(context: ProjectContext, lang: 'en' | 'ar'): string {
  const ar = lang === 'ar';

  if (context.kind === 'none') return '';

  if (context.kind === 'unauthorized') {
    return ar
      ? '\n\nسياق المشروع: لم يُعثر على المشروع المطلوب ضمن ما يحق لهذا المستخدم الاطلاع عليه. لا تخمّن مشروعاً آخر، واطلب منه اختيار مشروع من مساحة عمله.'
      : '\n\nPROJECT CONTEXT: the project asked for is not among the ones this user may see. Do NOT substitute another project. Ask them to pick one from their workspace.';
  }

  if (context.kind === 'ambiguous') {
    const titles = context.choices.map(choice => `- ${choice.title}`).join('\n');
    return ar
      ? `\n\nسياق المشروع: لدى هذا المستخدم أكثر من مشروع، والسؤال لا يحدد أيّها. اسأله عن المشروع المقصود قبل الإجابة، واعرض عليه هذه القائمة:\n${titles}\nلا تختر نيابةً عنه ولا تفترض الأحدث.`
      : `\n\nPROJECT CONTEXT: this user has more than one project and the question does not say which. ASK which project they mean before answering, and offer these:\n${titles}\nDo not choose for them, and do not assume the most recent one.`;
  }

  const project = context.project;
  const facts = [
    line(ar ? 'العنوان' : 'Title', project.title),
    line(ar ? 'النوع' : 'Type', project.type),
    line(ar ? 'الحالة' : 'Status', project.status),
    line(ar ? 'الموقع' : 'Location', project.location),
    line(ar ? 'نسبة الإنجاز' : 'Progress', project.progress === null ? null : `${project.progress}%`),
    ...(context.scope === 'owner' ? [
      line(ar ? 'الميزانية' : 'Budget', (project as OwnedProject).budget),
      line(ar ? 'المصروف' : 'Spent', (project as OwnedProject).spent),
      line(ar ? 'تاريخ البدء' : 'Start date', (project as OwnedProject).startDate),
      line(ar ? 'تاريخ الانتهاء' : 'End date', (project as OwnedProject).endDate),
    ] : []),
  ].filter(Boolean).join('\n');

  const scopeNote = context.scope === 'owner'
    ? (ar
      ? 'هذه بيانات مشروع هذا المستخدم نفسه.'
      : "These are this user's OWN project records.")
    : (ar
      ? 'هذه بيانات دليل المشاريع المتاحة للمزوّدين المعتمدين. الميزانية والمصروف غير متاحين هنا، فلا تفترضهما ولا تقدّرهما وكأنك تعرفهما.'
      : 'These are the approved-provider DIRECTORY fields. Budget and spend are NOT available here - do not assume or estimate them as if you knew them.');

  const discipline = ar
    ? 'استخدم هذه الأرقام كما هي، ولا تخترع أي حقل غير مذكور أعلاه. إن كان السؤال يحتاج حقلاً غير موجود، قل إنه غير متاح في البناء هنا.'
    : 'Use these figures as given. Do NOT invent any field not listed above. If the question needs one that is missing, say it is not recorded in BuildHub rather than estimating it.';

  return `\n\n${ar ? 'سياق المشروع' : 'PROJECT CONTEXT'}\n${scopeNote}\n${facts}\n${discipline}`;
}
