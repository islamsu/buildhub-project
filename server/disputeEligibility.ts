/**
 * WHO MAY RAISE, READ AND ANSWER A DISPUTE - decided in ONE place.
 *
 * `disputes.create` checked project membership inline and nothing else checked
 * anything: `myDisputes` filtered on reporter-or-respondent, `admin.disputes`
 * returned every row, and there was no read path for a single dispute at all.
 * Adding RFQ and quotation subjects to that shape would have meant three more
 * inline rules, each able to drift from the others.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a competitor supplier never gains
 * access. Two suppliers bidding on the same RFQ are commercial rivals, and the
 * one who lost must not be able to read the dispute the winner is in - or the
 * evidence attached to it. Eligibility is derived from a REAL relationship to
 * the subject, never from a role, and never from the fact that the RFQ was
 * publicly listed.
 *
 * Every operation re-checks. Nothing trusts a client-supplied party id, and
 * `create` / `read` / `respond` / `upload` / `reopen` all come through here
 * rather than each remembering the rule.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  disputes, projectMembers, projects, qualifiedEnquiries, quotations, rfqs, rfqSuppliers, users,
} from '../drizzle/schema';
import type { DisputeSubjectType } from '../shared/disputes';

/**
 * WHY somebody may act on this dispute. Recorded rather than reduced to a
 * boolean: "you are the supplier who quoted" and "you own the project" lead to
 * different respondent candidates and different screens, and an administrator
 * investigating needs to know which one applied.
 */
export type DisputeRelation =
  | 'project_owner'
  | 'project_member'
  | 'rfq_requester'
  | 'rfq_invited_supplier'
  | 'rfq_enquiring_supplier'
  | 'rfq_quoting_supplier'
  | 'quotation_supplier'
  | 'quotation_requester';

export type SubjectParty = {
  userId: number;
  relation: DisputeRelation;
};

/** The whole cast of a subject: everybody with a real relationship to it. */
export type SubjectParties = {
  subjectType: DisputeSubjectType;
  subjectId: number;
  /** The person who owns the thing - the project owner, or the RFQ requester. */
  principalId: number | null;
  parties: SubjectParty[];
  /** A short description of the subject, for the screen. Never another party's data. */
  label: string;
};

const dedupe = (parties: SubjectParty[]): SubjectParty[] => {
  const seen = new Map<number, SubjectParty>();
  // FIRST relation wins, and the lists below are ordered strongest-first, so a
  // supplier who was invited AND quoted is recorded as the one who quoted.
  for (const party of parties) if (!seen.has(party.userId)) seen.set(party.userId, party);
  return Array.from(seen.values());
};

/**
 * Everybody with a real relationship to a project.
 *
 * Live membership only: a member who was removed is no longer a party, and a
 * dispute they raise afterwards is refused rather than quietly accepted.
 */
async function projectParties(db: any, projectId: number): Promise<SubjectParties | null> {
  const [project] = await db.select({ id: projects.id, ownerId: projects.ownerId, title: projects.title })
    .from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;

  const members = await db.select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), isNull(projectMembers.removedAt)));

  return {
    subjectType: 'project',
    subjectId: projectId,
    principalId: Number(project.ownerId),
    label: String(project.title ?? `Project #${projectId}`),
    parties: dedupe([
      { userId: Number(project.ownerId), relation: 'project_owner' },
      ...members.map((member: any) => ({ userId: Number(member.userId), relation: 'project_member' as const })),
    ]),
  };
}

/**
 * Everybody with a real relationship to an RFQ.
 *
 * A SUPPLIER IS A PARTY ONLY THROUGH AN ACT. Being able to see the RFQ on the
 * open board is not a relationship - if it were, every supplier on the platform
 * would be a party to every dispute about every RFQ. The three acts that count:
 *
 *   they were INVITED to it (rfqSuppliers)
 *   they OPENED it as a qualified enquiry, which their plan was charged for
 *   they SUBMITTED a quotation
 */
async function rfqParties(db: any, rfqId: number): Promise<SubjectParties | null> {
  const [rfq] = await db.select({ id: rfqs.id, requesterId: rfqs.requesterId, title: rfqs.title })
    .from(rfqs).where(eq(rfqs.id, rfqId)).limit(1);
  if (!rfq) return null;

  const [invited, enquired, quoted] = await Promise.all([
    db.select({ userId: rfqSuppliers.supplierId }).from(rfqSuppliers).where(eq(rfqSuppliers.rfqId, rfqId)),
    db.select({ userId: qualifiedEnquiries.userId }).from(qualifiedEnquiries).where(eq(qualifiedEnquiries.rfqId, rfqId)),
    db.select({ userId: quotations.providerId }).from(quotations).where(eq(quotations.rfqId, rfqId)),
  ]);

  return {
    subjectType: 'rfq',
    subjectId: rfqId,
    principalId: Number(rfq.requesterId),
    label: String(rfq.title ?? `RFQ #${rfqId}`),
    // Strongest relation first, so dedupe records the most specific one.
    parties: dedupe([
      { userId: Number(rfq.requesterId), relation: 'rfq_requester' },
      ...quoted.map((row: any) => ({ userId: Number(row.userId), relation: 'rfq_quoting_supplier' as const })),
      ...enquired.map((row: any) => ({ userId: Number(row.userId), relation: 'rfq_enquiring_supplier' as const })),
      ...invited.map((row: any) => ({ userId: Number(row.userId), relation: 'rfq_invited_supplier' as const })),
    ]),
  };
}

/**
 * A quotation has exactly TWO parties: the supplier who wrote it and the
 * requester it was written for.
 *
 * NOT the other suppliers who quoted on the same RFQ. They are commercial
 * rivals, and a dispute about one bid is none of their business - this is the
 * narrowest of the three subjects on purpose.
 */
async function quotationParties(db: any, quotationId: number): Promise<SubjectParties | null> {
  const [quotation] = await db.select({
    id: quotations.id, rfqId: quotations.rfqId, providerId: quotations.providerId,
  }).from(quotations).where(eq(quotations.id, quotationId)).limit(1);
  if (!quotation) return null;

  const [rfq] = await db.select({ requesterId: rfqs.requesterId, title: rfqs.title })
    .from(rfqs).where(eq(rfqs.id, quotation.rfqId)).limit(1);
  if (!rfq) return null;

  return {
    subjectType: 'quotation',
    subjectId: quotationId,
    principalId: Number(rfq.requesterId),
    label: `Quotation #${quotationId} on ${String(rfq.title ?? `RFQ #${quotation.rfqId}`)}`,
    parties: dedupe([
      { userId: Number(quotation.providerId), relation: 'quotation_supplier' },
      { userId: Number(rfq.requesterId), relation: 'quotation_requester' },
    ]),
  };
}

/** Everybody with a real relationship to the subject, or null if it is gone. */
export async function partiesForSubject(
  db: any, subjectType: DisputeSubjectType, subjectId: number,
): Promise<SubjectParties | null> {
  if (!Number.isSafeInteger(subjectId) || subjectId <= 0) return null;
  if (subjectType === 'project') return projectParties(db, subjectId);
  if (subjectType === 'rfq') return rfqParties(db, subjectId);
  if (subjectType === 'quotation') return quotationParties(db, subjectId);
  return null;
}

/** The caller's relation to a subject, or null if they have none. */
export async function relationToSubject(
  db: any, subjectType: DisputeSubjectType, subjectId: number, userId: number,
): Promise<{ relation: DisputeRelation; subject: SubjectParties } | null> {
  const subject = await partiesForSubject(db, subjectType, subjectId);
  if (!subject) return null;
  const party = subject.parties.find(entry => entry.userId === userId);
  return party ? { relation: party.relation, subject } : null;
}

/**
 * May this account raise a dispute about this subject?
 *
 * NOT_FOUND for both "no such subject" and "you have no relationship to it",
 * following `requireProjectAccess`: a refusal that distinguishes them tells a
 * stranger that an RFQ with that id exists, which is the thing being probed for.
 */
export async function requireSubjectParty(
  db: any, subjectType: DisputeSubjectType, subjectId: number, userId: number,
): Promise<{ relation: DisputeRelation; subject: SubjectParties }> {
  const found = await relationToSubject(db, subjectType, subjectId, userId);
  if (!found) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'That is not something you can raise a dispute about.',
    });
  }
  return found;
}

/**
 * ── WHO MAY BE NAMED AS THE RESPONDENT ─────────────────────────────────────
 *
 * CANDIDATES, NEVER FREE-TYPED. `disputes.create` took a `respondentId` from
 * the client and checked only that they were on the project - which is right as
 * far as it goes, and does not survive the move to RFQ and quotation subjects,
 * where "on the project" means nothing.
 *
 * The reporter is excluded: a dispute against yourself is not a dispute.
 */
export async function respondentCandidates(
  db: any, subject: SubjectParties, reporterId: number,
): Promise<Array<{ userId: number; name: string | null; relation: DisputeRelation }>> {
  const others = subject.parties.filter(party => party.userId !== reporterId);
  if (others.length === 0) return [];
  // Only the candidates, not the whole user table. `admin.disputes` reads every
  // user into memory to map two names per row, which is the defect this avoids
  // rather than copies.
  const rows = await db.select({ id: users.id, name: users.name })
    .from(users).where(inArray(users.id, others.map(party => party.userId)));
  const names = new Map<number, string | null>(rows.map((row: any) => [Number(row.id), row.name ?? null]));
  return others.map(party => ({
    userId: party.userId,
    name: names.get(party.userId) ?? null,
    relation: party.relation,
  }));
}

/**
 * The respondent a client asked for, validated against the real cast.
 *
 * Returns null when none was named, which is legitimate: a dispute can be
 * against the situation rather than against a person.
 */
export function validateRespondent(
  subject: SubjectParties, reporterId: number, respondentId: number | null | undefined,
): number | null {
  if (respondentId == null) return null;
  if (respondentId === reporterId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot open a dispute against yourself.' });
  }
  if (!subject.parties.some(party => party.userId === respondentId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'The respondent must be someone involved in the thing you are disputing.',
    });
  }
  return respondentId;
}

/**
 * ── WHO MAY READ AN EXISTING DISPUTE ───────────────────────────────────────
 *
 * The reporter, the named respondent, and nobody else who is not still a party
 * to the subject.
 *
 * RE-DERIVED FROM THE SUBJECT, not trusted from the row: a supplier removed
 * from a project after filing keeps access to their own dispute (they are the
 * reporter) but gains nothing new, and a party added to the subject later can
 * see a dispute about it. The alternative - a frozen participant list on the
 * dispute - drifts from reality the first time membership changes.
 */
export async function canReadDispute(
  db: any, dispute: { id: number; reporterId: number; respondentId: number | null; subjectType: string; subjectId: number },
  userId: number,
): Promise<boolean> {
  if (Number(dispute.reporterId) === userId) return true;
  if (dispute.respondentId != null && Number(dispute.respondentId) === userId) return true;
  const found = await relationToSubject(db, dispute.subjectType as DisputeSubjectType, Number(dispute.subjectId), userId);
  return found !== null;
}

export async function requireDisputeAccess(
  db: any, disputeId: number, userId: number,
): Promise<any> {
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  // NOT_FOUND for a dispute that does not exist AND for one this account may
  // not see, so an id cannot be probed for existence.
  if (!dispute || !(await canReadDispute(db, dispute, userId))) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Dispute not found' });
  }
  return dispute;
}
