import { eq } from 'drizzle-orm';
import type { getDb } from './db';
import { rfqs, vendorCategories } from '../drizzle/schema';
import { neutralizeUntrusted } from './_core/untrustedContent';

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * TRANSACTION OPPORTUNITIES, and the line the AI does not cross.
 *
 * The brief asks the assistant to stop at answering questions and start
 * surfacing real marketplace opportunities: a contractor asking "find
 * residential finishing work in Cairo" should get actual open RFQs, ranked,
 * with a way to act on them.
 *
 * THE ARCHITECTURAL DECISION, stated plainly because it is the whole safety
 * argument: THE AI HAS NO EXECUTE PATH. There is no function in this module
 * that opens an enquiry, spends a credit, or submits a quotation. It produces
 * a PREPARED action - a real BuildHub route and the id to act on - and the
 * person confirms by going there, where the existing procedure runs with its
 * existing approval check, declared-category eligibility, monthly allowance
 * and credit accounting.
 *
 * That is a structural guarantee rather than a promise. "The AI must never
 * become a transaction authorization bypass" is not enforced here by a careful
 * check that could be forgotten; it is enforced by there being nothing to
 * bypass with. The five states the brief distinguishes -
 *
 *     RECOMMENDATION -> MATCH -> PREPARED ACTION -> CONFIRMED ACTION -> COMPLETED
 *
 * - are split across a boundary: this module reaches PREPARED and stops. The
 * last two happen in the existing routers, under the existing rules.
 *
 * WHY THE SCORE IS COMPUTED HERE AND NOT BY THE MODEL. The brief requires
 * deterministic server-side ranking with the model explaining the result. A
 * model that ranks is a model that can be argued into re-ranking, and its
 * ordering cannot be tested. Everything below is arithmetic over fields that
 * actually exist; the model receives the order and is told it did not choose it.
 */

/** Roles for whom an RFQ is an opportunity rather than something they created. */
export const RFQ_SEEKING_ROLES = ['contractor', 'supplier'] as const;
export type RfqSeekingRole = typeof RFQ_SEEKING_ROLES[number];

export const isRfqSeekingRole = (role: string | null | undefined): role is RfqSeekingRole =>
  (RFQ_SEEKING_ROLES as readonly string[]).includes(role ?? '');

/**
 * A prepared action. Never a performed one.
 *
 * `href` is a real BuildHub route. `requiresConfirmation` is true for anything
 * that spends a credit or creates a record - it is carried explicitly rather
 * than inferred at the UI, so a new surface cannot quietly treat a chargeable
 * action as free.
 */
export type PreparedAction = {
  /**
   * Deliberately the literal 'prepared'. There is no 'completed' variant in
   * this type, so no code path can construct one and no answer can claim a
   * transaction happened because a shape allowed it to.
   */
  state: 'prepared';
  action: 'view_rfq' | 'open_enquiry' | 'prepare_quote' | 'create_rfq' | 'view_provider' | 'view_product';
  href: string;
  requiresConfirmation: boolean;
};

export type ScoredOpportunity = {
  id: number;
  title: string;
  category: string | null;
  location: string | null;
  deadline: Date | null;
  score: number;
  /** Evidence, drawn only from fields that exist. Never a generated sentence. */
  reasons: string[];
  actions: PreparedAction[];
};

export type OpportunityOutcome = {
  matchQuality: 'exact' | 'partial' | 'related' | 'none';
  opportunities: ScoredOpportunity[];
  /** What the search was actually able to filter on. */
  appliedCriteria: string[];
  /** Criteria that had to be dropped to return anything at all. */
  broadenedBy: string[];
};

/**
 * Points, named so a change to ranking is a change to a named constant.
 *
 * THERE IS DELIBERATELY NO `recency` WEIGHT. There was one, worth 5 points, and
 * mutation testing showed it could be set to 0 or to 500 without changing a
 * single outcome: every case where it might have decided an order is already
 * decided earlier, either by the match-quality bucket or by the tiebreak below.
 * A weight that cannot change a result is not a conservative weight, it is a
 * number that makes the scoring look more considered than it is. How recent an
 * RFQ is still reaches the model - as a REASON, which is evidence - and it
 * still orders equal candidates, through the tiebreak.
 */
const WEIGHT = {
  declaredCategory: 50,
  requestedCategory: 25,
  location: 20,
} as const;

type RfqRow = {
  id: number;
  title: string;
  category: string | null;
  location: string | null;
  deadline: Date | null;
  status: string | null;
  createdAt: Date | null;
};

const norm = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase();

/**
 * Rank open RFQs for one provider.
 *
 * AUTHORIZATION. This reads the same open feed `rfq.list` already exposes to
 * any authenticated caller, and it selects the same columns - deliberately NOT
 * `description`, `budget` or `productReference`, which are the fields
 * `openQualifiedEnquiry` charges a credit to reveal. Ranking a feed must not
 * become a way to read the part of it that is paid for. The caller's own
 * declared categories are read under their own id.
 */
export async function findRfqOpportunities(params: {
  db: Db;
  userId: number;
  userRole: string | null;
  requestedCategory?: string;
  requestedLocation?: string;
  now?: Date;
  limit?: number;
}): Promise<OpportunityOutcome> {
  const empty: OpportunityOutcome = {
    matchQuality: 'none', opportunities: [], appliedCriteria: [], broadenedBy: [],
  };

  // A homeowner has no RFQ opportunities - their RFQs are their own requests.
  // Refusing by role here means the query never runs for the wrong caller.
  if (!isRfqSeekingRole(params.userRole)) return empty;

  const now = params.now ?? new Date();
  const { db } = params;

  // The provider's OWN declared categories, under their own id.
  const declaredRows = await db.select({ category: vendorCategories.category })
    .from(vendorCategories)
    .where(eq(vendorCategories.userId, params.userId));
  const declared = new Set(declaredRows.map(row => norm(row.category)));

  const openRows = await db.select({
    id: rfqs.id,
    title: rfqs.title,
    category: rfqs.category,
    location: rfqs.location,
    deadline: rfqs.deadline,
    status: rfqs.status,
    createdAt: rfqs.createdAt,
  })
    .from(rfqs)
    .where(eq(rfqs.status, 'open'));

  // Structural filters. An expired RFQ is not an opportunity, however well it
  // scores - this is a filter and not a penalty, because ranking a dead lead
  // below a live one still shows it.
  const live = openRows.filter(row => !row.deadline || row.deadline.getTime() >= now.getTime());
  if (live.length === 0) return empty;

  const wantedCategory = norm(params.requestedCategory);
  const wantedLocation = norm(params.requestedLocation);

  const appliedCriteria: string[] = [];
  if (declared.size > 0) appliedCriteria.push('your declared service categories');
  if (wantedCategory) appliedCriteria.push(`category "${params.requestedCategory}"`);
  if (wantedLocation) appliedCriteria.push(`location "${params.requestedLocation}"`);

  const scored = live.map(row => {
    const reasons: string[] = [];
    let score = 0;

    const rowCategory = norm(row.category);
    const rowLocation = norm(row.location);

    // The strongest signal, and the one with real consequences: opening a
    // qualified enquiry requires the RFQ to match a DECLARED category. An RFQ
    // outside them is not merely a worse match, it is one this provider cannot
    // open - so it must not be ranked as though it were.
    const matchesDeclared = rowCategory.length > 0 && declared.has(rowCategory);
    if (matchesDeclared) {
      score += WEIGHT.declaredCategory;
      reasons.push(`matches your declared category "${row.category}"`);
    }

    if (wantedCategory && rowCategory === wantedCategory) {
      score += WEIGHT.requestedCategory;
      reasons.push(`matches the category you asked about`);
    }

    if (wantedLocation && rowLocation.length > 0 && rowLocation.includes(wantedLocation)) {
      score += WEIGHT.location;
      reasons.push(`located in ${row.location}`);
    }

    // Recency is REPORTED, never scored. See the note on WEIGHT.
    if (row.createdAt) {
      const days = (now.getTime() - row.createdAt.getTime()) / 86_400_000;
      if (days <= 7) reasons.push('posted in the last 7 days');
    }

    return { row, score, reasons, matchesDeclared, matchesRequested: Boolean(wantedCategory) && rowCategory === wantedCategory };
  });

  const toOpportunity = (entry: typeof scored[number]): ScoredOpportunity => ({
    id: entry.row.id,
    title: neutralizeUntrusted(entry.row.title, 160),
    category: entry.row.category,
    location: entry.row.location,
    deadline: entry.row.deadline,
    score: entry.score,
    reasons: entry.reasons,
    // ROUTES THAT EXIST, and routeIntegrity.test.ts holds every href here
    // against the real table in App.tsx.
    //
    // These were `/rfq/${id}` when no such route existed, and both actions fell
    // through to the 404 page - the dead control this engine is meant to refuse
    // to emit, shipped by the engine itself. They were then pointed at `/rfq`
    // while the detail page was missing. The detail page now EXISTS, so
    // view_rfq addresses the record directly again, which is what the action
    // always claimed to do.
    //
    // `/provider` forwards a signed-in provider to their role platform, where
    // the credit-gated enquiry and the quotation form live. Viewing is free;
    // opening the enquiry is what costs.
    actions: [
      { state: 'prepared', action: 'view_rfq', href: `/rfq/${entry.row.id}`, requiresConfirmation: false },
      // Opening the enquiry SPENDS A CREDIT. It is offered as an action and
      // marked as needing confirmation; nothing here performs it.
      { state: 'prepared', action: 'open_enquiry', href: '/provider', requiresConfirmation: true },
    ],
  });

  // Score first, then NEWEST FIRST, then id for a total order.
  //
  // The middle term used to be absent, and id-descending stood in for it. That
  // happened to look like "newest first" because ids climb with time, but it is
  // not the same claim and it is not the one worth making - a backfilled or
  // re-imported RFQ breaks it. Ordering on the column that actually means
  // "when was this posted" is both correct and testable.
  const byScore = (a: { score: number; row: RfqRow }, b: { score: number; row: RfqRow }) =>
    b.score - a.score
    || (b.row.createdAt?.getTime() ?? 0) - (a.row.createdAt?.getTime() ?? 0)
    || b.row.id - a.row.id;

  const limit = params.limit ?? 5;

  // EXACT: everything the person asked for was matched, and it is in a trade
  // they may actually open.
  const exact = scored
    .filter(e => e.matchesDeclared && (!wantedCategory || e.matchesRequested)
      && (!wantedLocation || e.reasons.some(r => r.startsWith('located in'))))
    .sort(byScore);
  if (exact.length > 0) {
    return {
      matchQuality: 'exact',
      opportunities: exact.slice(0, limit).map(toOpportunity),
      appliedCriteria,
      broadenedBy: [],
    };
  }

  // PARTIAL: within their declared categories, but not everything asked for.
  const partial = scored.filter(e => e.matchesDeclared).sort(byScore);
  if (partial.length > 0) {
    const missed = [
      wantedCategory ? 'the exact category asked for' : '',
      wantedLocation ? 'the location asked for' : '',
    ].filter(Boolean);
    return {
      matchQuality: 'partial',
      opportunities: partial.slice(0, limit).map(toOpportunity),
      appliedCriteria,
      broadenedBy: missed.length ? [`could not match ${missed.join(' or ')}`] : [],
    };
  }

  // RELATED: open work outside their declared categories. Returned because a
  // provider may add a category - but flagged, because as things stand they
  // cannot open these.
  const related = scored.sort(byScore);
  if (related.length > 0) {
    return {
      matchQuality: 'related',
      opportunities: related.slice(0, limit).map(toOpportunity),
      appliedCriteria,
      broadenedBy: ['none of these fall inside your declared service categories'],
    };
  }

  return empty;
}

/**
 * The opportunity block handed to the model.
 *
 * States the ordering is BuildHub's, names what BuildHub does not know, and -
 * the part that matters most - forbids claiming any of it has been done.
 */
export function formatOpportunitiesForModel(
  outcome: OpportunityOutcome,
  lang: 'en' | 'ar',
): string {
  if (outcome.matchQuality === 'none' || outcome.opportunities.length === 0) {
    return `=== BUILDHUB OPPORTUNITY SEARCH ===
NO OPEN RFQ on BuildHub currently matches this request.

Say so plainly. Do NOT invent an RFQ, a client, a budget or a deadline. You may
suggest they broaden their declared service categories, or check back - nothing
more.${lang === 'ar' ? '\nAnswer in Arabic.' : ''}
=== END ===`;
  }

  const header = {
    exact: 'MATCH QUALITY: EXACT - these match the request as asked, and fall inside their declared service categories.',
    partial: 'MATCH QUALITY: PARTIAL - these are inside their declared categories but do NOT match everything asked for. Say which part did not match.',
    related: 'MATCH QUALITY: RELATED - these are open, but NONE falls inside their declared service categories. They cannot open a qualified enquiry on these as things stand. Say that first.',
    none: '',
  }[outcome.matchQuality];

  const rows = outcome.opportunities.map((o, i) => {
    // The title is neutralised HERE as well as in toOpportunity. An outcome can
    // be constructed by any caller, and a defence applied at only one of two
    // entry points is a hole waiting for the second caller. RFQ titles are
    // written by the requester, so they are untrusted like any other user text.
    const safeTitle = neutralizeUntrusted(o.title, 160) || `RFQ #${o.id}`;
    const facts = [
      `category: ${neutralizeUntrusted(o.category, 60) || 'not stated'}`,
      `location: ${neutralizeUntrusted(o.location, 60) || 'not stated'}`,
      `deadline: ${o.deadline ? o.deadline.toISOString().slice(0, 10) : 'none given'}`,
    ].join(' | ');
    return `  ${i + 1}. RFQ #${o.id}: ${safeTitle} [BuildHub score ${o.score}]
     ${facts}
     why ranked here: ${o.reasons.length ? o.reasons.join('; ') : 'open and live, no other matching signal'}`;
  }).join('\n');

  return `=== BUILDHUB OPPORTUNITY SEARCH ===
${header}

Ranked by BuildHub's own scoring. Present them in THIS ORDER. You did not
choose this order and you must not re-order it.

${rows}

WHAT BUILDHUB DOES NOT KNOW about these: the client's real budget flexibility,
how many other providers are bidding, whether the work suits this provider's
current workload, and how likely any of them is to be awarded. Do not state,
estimate or imply any of it.

WHAT YOU MAY AND MAY NOT DO WITH THESE

You may describe them, rank-explain them, and tell the person where to act:
opening the full enquiry and preparing a quotation both happen on the RFQ page.

You have NOT opened any enquiry, spent any credit, submitted any quotation or
contacted any client, and you cannot. Never say or imply that you have, and
never say an action is complete. Opening a qualified enquiry SPENDS ONE OF
THEIR MONTHLY CREDITS - always say so before suggesting it, and let them decide.
${lang === 'ar' ? '\nAnswer in Arabic.' : ''}
=== END ===`;
}
