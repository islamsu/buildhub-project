/**
 * TELLING THE PARTIES WHAT HAPPENED TO THEIR DISPUTE.
 *
 * `admin.updateDispute` notified nobody. A dispute could be investigated,
 * resolved and closed without either party learning of it - they would find out
 * by going back to look, if they thought to.
 *
 * BOTH SIDES, ALWAYS, except the person who did it: telling somebody about
 * their own action is noise, and telling only one side makes the record look
 * like a private conversation with the platform.
 */
import { notifyUser } from './notifications';
import { recordAccountEvent } from './_core/accountAudit';
import type { DisputeStatus } from '../shared/disputes';

export async function notifyDisputeParties(db: any, dispute: {
  id: number; reference: string | null; title: string;
  reporterId: number; respondentId: number | null;
}, change: {
  actorId: number;
  from: DisputeStatus;
  to: DisputeStatus;
  reason?: string | null;
}): Promise<void> {
  const reference = dispute.reference ?? String(dispute.id);
  const recipients = [dispute.reporterId, dispute.respondentId]
    .filter((id): id is number => id != null && id !== change.actorId);

  for (const userId of recipients) {
    await notifyUser(db, {
      userId,
      title: 'A dispute you are part of has changed',
      body: `${reference}: ${change.from} -> ${change.to}`,
      type: 'dispute',
      link: `/disputes/${dispute.id}`,
      messageKey: `notif.dispute.${change.to}`,
      messageParams: {
        reference,
        // The administrator's own words, passed through rather than translated.
        ...(String(change.reason ?? '').trim() ? { note: String(change.reason).trim() } : {}),
      },
    });
  }

  // Audited against the REPORTER, whose record this is, whoever moved it.
  await recordAccountEvent(db, {
    userId: dispute.reporterId,
    actorId: change.actorId,
    action: change.to === 'withdrawn' ? 'dispute_withdrawn'
      : change.to === 'resolved' ? 'dispute_resolved'
        : change.from !== 'open' && change.to === 'open' ? 'dispute_reopened'
          : 'dispute_status_changed',
    source: 'dispute',
    note: `${reference}: ${change.from} -> ${change.to}${change.reason ? ` (${change.reason})` : ''}`,
  });
}
