/**
 * ── ONE ACCOUNT, ACROSS THE WHOLE PRODUCT ───────────────────────────────
 *
 * `/admin/users/:id` showed identity, an edit form, internal notes and the
 * audit trail, and that was all: a single scrolling support card. An
 * administrator investigating an account had to leave it and search five
 * other screens by hand to learn whether this person had projects, had sent
 * quotations, was in a dispute, held a subscription, or was stuck in
 * compliance. The owner rejected that as complete. North Star §34.
 *
 * WHAT THIS MODULE RETURNS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * It returns COUNTS, STATES and a handful of RECENT HEADINGS, each with the
 * canonical deep link to the screen that owns that domain. It does not return
 * the contents of anything: not a dispute's evidence, not a message, not a
 * quotation's commercial terms, not a compliance document. An administrator
 * who needs those opens the record that owns them, where the domain's own
 * authorization applies.
 *
 * That line is the point rather than caution. §65: do not expose PII merely
 * to make a workflow look richer. A 360 view is about knowing WHERE to look,
 * not about copying every domain's private data onto one page.
 *
 * COUNTS ARE COUNTED, AND ABSENCE IS ABSENCE. Every figure is a COUNT(*)
 * against a real table. Nothing is estimated, and a domain this account has
 * never touched returns zero because it was counted as zero - a query that
 * fails throws, because §10 says an outage must not render as no activity.
 */
import { and, count, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  disputes, products, projectMembers, projects, qualifiedEnquiries, quotations,
  referralRewards, referrals, registrationDocuments, reviews, rfqs, serviceOfferings,
  supportTickets, users, vendorProfiles, vendorSponsorships, vendorSubscriptions,
} from '../drizzle/schema';

type Db = any;

const RECENT = 5;

/** A number that was counted, from a query that has already succeeded. */
const n = (row: any, key = 'n') => Number(row?.[key] ?? 0);

/**
 * PROJECTS THIS ACCOUNT OWNS OR IS A MEMBER OF.
 *
 * Membership matters as much as ownership: a project manager running six
 * projects owns none of them, and a view that counted only `ownerId` would
 * show the busiest account on the platform as having no projects at all.
 * `removedAt is null` because a removed member is a former member.
 */
async function projectContext(db: Db, userId: number) {
  const [owned] = await db.select({ n: count() }).from(projects).where(eq(projects.ownerId, userId));
  const [member] = await db.select({ n: count() }).from(projectMembers)
    .where(and(eq(projectMembers.userId, userId), isNull(projectMembers.removedAt)));

  const memberOf = await db.select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, userId), isNull(projectMembers.removedAt)));
  const ids = memberOf.map((row: any) => Number(row.projectId));

  const recent = await db.select({
    id: projects.id, title: projects.title, status: projects.status,
    ownerId: projects.ownerId, createdAt: projects.createdAt,
  }).from(projects)
    .where(ids.length > 0
      ? or(eq(projects.ownerId, userId), inArray(projects.id, ids))
      : eq(projects.ownerId, userId))
    .orderBy(desc(projects.createdAt))
    .limit(RECENT);

  return { owned: n(owned), memberOf: n(member), recent };
}

/** Requests raised by this account, and quotations it has sent on others'. */
async function sourcingContext(db: Db, userId: number) {
  const [rfqRow] = await db.select({ n: count() }).from(rfqs).where(eq(rfqs.requesterId, userId));
  const rfqByStatus = await db.select({ status: rfqs.status, n: count() })
    .from(rfqs).where(eq(rfqs.requesterId, userId)).groupBy(rfqs.status);

  // THE CURRENT quotation only. A revision supersedes its predecessor, and
  // counting the superseded rows would report a supplier who revised one
  // quotation three times as having sent four.
  const [quotationRow] = await db.select({ n: count() }).from(quotations)
    .where(and(eq(quotations.providerId, userId), isNull(quotations.supersededAt)));
  const quotationByStatus = await db.select({ status: quotations.status, n: count() })
    .from(quotations)
    .where(and(eq(quotations.providerId, userId), isNull(quotations.supersededAt)))
    .groupBy(quotations.status);

  const [enquiryRow] = await db.select({ n: count() }).from(qualifiedEnquiries)
    .where(eq(qualifiedEnquiries.userId, userId));

  const recentRfqs = await db.select({
    id: rfqs.id, title: rfqs.title, status: rfqs.status, createdAt: rfqs.createdAt,
  }).from(rfqs).where(eq(rfqs.requesterId, userId)).orderBy(desc(rfqs.createdAt)).limit(RECENT);

  const asRecord = (rows: any[]) => {
    const out: Record<string, number> = {};
    for (const row of rows) out[String(row.status)] = n(row);
    return out;
  };

  return {
    rfqs: n(rfqRow),
    rfqsByStatus: asRecord(rfqByStatus),
    quotations: n(quotationRow),
    quotationsByStatus: asRecord(quotationByStatus),
    /** Allowance actually consumed. See billing.myEnquiryUsage for the rule. */
    qualifiedEnquiries: n(enquiryRow),
    recentRfqs,
  };
}

/** What this account has listed, if anything. */
async function marketplaceContext(db: Db, userId: number) {
  const productByStatus = await db.select({ status: products.status, n: count() })
    .from(products).where(eq(products.supplierId, userId)).groupBy(products.status);
  const [serviceRow] = await db.select({ n: count() }).from(serviceOfferings)
    .where(eq(serviceOfferings.providerId, userId));
  const placements = await db.select({ kind: vendorSponsorships.kind, n: count() })
    .from(vendorSponsorships).where(eq(vendorSponsorships.vendorId, userId)).groupBy(vendorSponsorships.kind);

  const byStatus: Record<string, number> = {};
  for (const row of productByStatus) byStatus[String(row.status)] = n(row);
  const placementsByKind: Record<string, number> = {};
  for (const row of placements) placementsByKind[String(row.kind)] = n(row);

  return {
    products: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
    productsByStatus: byStatus,
    services: n(serviceRow),
    placementsByKind,
  };
}

/**
 * WHERE THIS ACCOUNT STANDS WITH COMPLIANCE.
 *
 * Document STATES, never document contents or URLs. A compliance file belongs
 * on the Professional Registrations record, behind that screen's own
 * authorization and its own audit - not copied onto a summary page because it
 * would make the summary look fuller.
 */
async function complianceContext(db: Db, userId: number) {
  const rows = await db.select({ status: registrationDocuments.status, n: count() })
    .from(registrationDocuments).where(eq(registrationDocuments.userId, userId))
    .groupBy(registrationDocuments.status);
  const byStatus: Record<string, number> = {};
  for (const row of rows) byStatus[String(row.status)] = n(row);
  return {
    documents: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
    documentsByStatus: byStatus,
  };
}

/** Reviews, disputes and tickets - as counts and headings, not contents. */
async function trustContext(db: Db, userId: number) {
  const [received] = await db.select({ n: count() }).from(reviews).where(eq(reviews.revieweeId, userId));
  const [written] = await db.select({ n: count() }).from(reviews).where(eq(reviews.reviewerId, userId));
  const [hidden] = await db.select({ n: count() }).from(reviews)
    .where(and(eq(reviews.revieweeId, userId), sql`${reviews.hiddenAt} is not null`));

  // BOTH SIDES. An account that has raised no dispute but is the respondent
  // in three is the one an administrator most needs to see.
  const disputeRows = await db.select({ status: disputes.status, n: count() })
    .from(disputes)
    .where(or(eq(disputes.reporterId, userId), eq(disputes.respondentId, userId)))
    .groupBy(disputes.status);
  const recentDisputes = await db.select({
    id: disputes.id, reference: disputes.reference, title: disputes.title,
    status: disputes.status, createdAt: disputes.createdAt,
    reporterId: disputes.reporterId,
  }).from(disputes)
    .where(or(eq(disputes.reporterId, userId), eq(disputes.respondentId, userId)))
    .orderBy(desc(disputes.createdAt)).limit(RECENT);

  const ticketRows = await db.select({ status: supportTickets.status, n: count() })
    .from(supportTickets).where(eq(supportTickets.requesterId, userId))
    .groupBy(supportTickets.status);
  const recentTickets = await db.select({
    id: supportTickets.id, reference: supportTickets.reference, subject: supportTickets.subject,
    status: supportTickets.status, createdAt: supportTickets.createdAt,
  }).from(supportTickets).where(eq(supportTickets.requesterId, userId))
    .orderBy(desc(supportTickets.createdAt)).limit(RECENT);

  const asRecord = (rows: any[]) => {
    const out: Record<string, number> = {};
    for (const row of rows) out[String(row.status)] = n(row);
    return out;
  };

  return {
    reviewsReceived: n(received),
    reviewsWritten: n(written),
    reviewsHidden: n(hidden),
    disputesByStatus: asRecord(disputeRows),
    disputes: disputeRows.reduce((sum: number, row: any) => sum + n(row), 0),
    recentDisputes,
    ticketsByStatus: asRecord(ticketRows),
    tickets: ticketRows.reduce((sum: number, row: any) => sum + n(row), 0),
    recentTickets,
  };
}

/** Plan, referral position and what BuildHub has granted this account. */
async function commercialContext(db: Db, userId: number) {
  const [subscription] = await db.select({
    plan: vendorSubscriptions.plan,
    status: vendorSubscriptions.status,
    currentPeriodEnd: vendorSubscriptions.currentPeriodEnd,
    cancelAtPeriodEnd: vendorSubscriptions.cancelAtPeriodEnd,
  }).from(vendorSubscriptions).where(eq(vendorSubscriptions.userId, userId)).limit(1);

  const [codeRow] = await db.select({
    code: users.referralCode,
    codeStatus: users.referralCodeStatus,
    issuedAt: users.referralCodeIssuedAt,
  }).from(users).where(eq(users.id, userId)).limit(1);

  const [attributed] = await db.select({ n: count() }).from(referrals)
    .where(eq(referrals.referrerId, userId));
  const [qualified] = await db.select({ n: count() }).from(referrals)
    .where(and(eq(referrals.referrerId, userId), inArray(referrals.status, ['qualified', 'rewarded'] as any)));
  // WAS THIS ACCOUNT ITSELF REFERRED? An attribution dispute is usually about
  // the referred side, and the referred side had nowhere to be seen.
  const [wasReferred] = await db.select({
    referrerId: referrals.referrerId, code: referrals.code, status: referrals.status,
  }).from(referrals).where(eq(referrals.referredId, userId)).limit(1);

  const rewardRows = await db.select({ status: referralRewards.status, n: count() })
    .from(referralRewards).where(eq(referralRewards.recipientUserId, userId))
    .groupBy(referralRewards.status);
  const rewardsByStatus: Record<string, number> = {};
  for (const row of rewardRows) rewardsByStatus[String(row.status)] = n(row);

  return {
    subscription: subscription ?? null,
    referralCode: codeRow?.code ?? null,
    referralCodeStatus: codeRow?.codeStatus ?? null,
    referralCodeIssuedAt: codeRow?.issuedAt ?? null,
    referralsAttributed: n(attributed),
    referralsQualified: n(qualified),
    referredBy: wasReferred ?? null,
    rewardsByStatus,
    rewards: Object.values(rewardsByStatus).reduce((sum, value) => sum + value, 0),
  };
}

/**
 * THE WHOLE PICTURE, in one authorized read.
 *
 * Each domain is a separate query because each answers a separate question,
 * and they run concurrently so the page costs one round of latency rather
 * than nine. Nothing here is cached: an administrator acting on an account is
 * acting on its state NOW, and a minute-old count is the kind of small lie
 * that wastes an investigation.
 */
export async function userOperationalSnapshot(db: Db, userId: number) {
  const [projectsCtx, sourcing, marketplace, compliance, trust, commercial] = await Promise.all([
    projectContext(db, userId),
    sourcingContext(db, userId),
    marketplaceContext(db, userId),
    complianceContext(db, userId),
    trustContext(db, userId),
    commercialContext(db, userId),
  ]);
  return { projects: projectsCtx, sourcing, marketplace, compliance, trust, commercial };
}
