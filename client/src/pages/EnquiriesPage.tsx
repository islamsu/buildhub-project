import { Link, useSearch } from 'wouter';
import { useLanguage } from '@/contexts/LanguageContext';
import { trpc } from '@/lib/trpc';
import DashboardLayout from '@/components/DashboardLayout';
import EnquiryQueue from '@/components/EnquiryQueue';
import {
  ENQUIRY_OPPORTUNITY_STATES, enquiryStateLabel,
  type EnquiryResponseState,
} from '@shared/enquiryStates';

/**
 * ── THE PROVIDER'S ENQUIRIES DESTINATION ─────────────────────────────────
 *
 * ONE SYSTEM, TWO QUESTIONS. This page used to stack two cards over the same
 * rows - an eligible list above a work queue - and a screenshot of a real
 * provider's screen showed the same six requests rendered twice, one above
 * the other, in two different vocabularies. Nothing was missing; everything
 * was doubled, which is worse, because the reader has to work out whether the
 * two lists disagree before they can trust either.
 *
 * The two questions a provider actually has are:
 *
 *   WHAT CAN I STILL TAKE?     Opportunity Centre
 *   WHAT HAVE I TAKEN, AND HOW DID IT END?   My Leads
 *
 * Both are served by ONE query (`rfq.queue`) and one component, split by a
 * `scope` the SERVER resolves from `shared/enquiryStates.ts`. A request is in
 * exactly one of them - the two state sets partition the vocabulary, and the
 * suite fails if a new state is ever added to neither - so the duplicate
 * cannot come back by someone adding a filter in the wrong place.
 *
 * THE DEEP LINK IS PRESERVED and is now better than it was: `?rfq=` still
 * selects and highlights the request, and because the page knows which half
 * it landed in, it can SAY so rather than leaving the provider to scan two
 * lists for it.
 */
export default function EnquiriesPage() {
  const { lang, t } = useLanguage();
  const ar = lang === 'ar';
  const search = useSearch();
  const rfqParam = new URLSearchParams(search).get('rfq');
  const highlightRfqId = rfqParam && /^\d+$/.test(rfqParam) ? Number(rfqParam) : undefined;

  /**
   * WHERE DID THE NOTIFICATION LAND?
   *
   * Asked over the WHOLE queue rather than either half, because the point is
   * to tell the two apart. One small search by reference; the component below
   * runs its own scoped query and highlights the row.
   */
  const located = trpc.rfq.queue.useQuery(
    { scope: 'all', search: `#${highlightRfqId ?? 0}`, pageSize: 5 },
    { enabled: highlightRfqId !== undefined, retry: false },
  );
  /**
   * AND WHEN IT IS IN NEITHER, ASK THE SERVER WHY.
   *
   * The notice below used to name both possible reasons - closed, or outside
   * the declared categories - because nothing could tell them apart.
   * `responseAccess` reports whether this provider already HAS access, which
   * is the one thing that distinguishes "not yours" from "not found here".
   */
  const linkedAccess = trpc.rfq.responseAccess.useQuery(
    { rfqId: highlightRfqId ?? 0 },
    { enabled: highlightRfqId !== undefined, retry: false },
  );

  const linkedRow = located.data?.rows.find(row => row.rfqId === highlightRfqId);
  const linkedIsOpportunity = linkedRow
    ? (ENQUIRY_OPPORTUNITY_STATES as readonly string[]).includes(linkedRow.responseState)
    : false;
  // Only claimed once the lookup has actually answered. A notice rendered
  // while the query is still in flight would announce "not in your list" over
  // a request that is in it, every single time the page loads.
  const linkedMissing = highlightRfqId !== undefined
    && located.isSuccess && !linkedRow;

  return (
    <DashboardLayout>
      <div className="space-y-6" dir={ar ? 'rtl' : 'ltr'} data-testid="enquiries-page">
        <div>
          <h1 className="text-xl font-bold">{ar ? 'الطلبات' : 'Enquiries'}</h1>
          <p className="text-sm text-muted-foreground">
            {ar
              ? 'الفرص التي ما زال بإمكانك أخذها، والطلبات التي أخذتها بالفعل — في قائمتين لا تتكرران.'
              : 'The opportunities you can still take, and the leads you have already taken — two lists, never the same request twice.'}
          </p>
        </div>

        {/* WHERE THE NOTIFICATION LANDED. Orientation, not decoration: the
            provider followed a link to one specific request and both lists
            below are long. */}
        {linkedRow && (
          <div className="rounded-lg border p-3 text-sm" data-testid="enquiry-linked-located">
            <p>
              {ar
                ? `الطلب #${linkedRow.rfqId} في ${linkedIsOpportunity ? 'مركز الفرص' : 'طلباتي'} — الحالة: ${enquiryStateLabel(linkedRow.responseState as EnquiryResponseState, 'ar')}.`
                : `Request #${linkedRow.rfqId} is in ${linkedIsOpportunity ? 'your Opportunity Centre' : 'My Leads'} — ${enquiryStateLabel(linkedRow.responseState as EnquiryResponseState, 'en')}.`}
            </p>
            <Link href={`/rfq/${linkedRow.rfqId}`} className="mt-1 inline-block underline" data-testid="enquiry-linked-open">
              {ar ? 'افتح الطلب' : 'Open the request'}
            </Link>
          </div>
        )}

        {/* THE HONEST ANSWER TO "why can't I respond to this?".
            The provider followed a link from a specific request and it is in
            neither list. Only the server knows which of the reasons applies,
            and it is not asked here - so both are stated rather than one being
            guessed at and shown as fact. Silence would leave the provider
            scanning two lists for something that was never going to be in
            either. */}
        {linkedMissing && (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            data-testid="enquiry-not-eligible"
          >
            {/* TWO DIFFERENT FACTS, AND THE SERVER DECIDES WHICH. A request
                the provider opened and PAID FOR is in their record even when
                it has aged out of both lists; announcing "not in your
                qualified enquiries" over a bought lead would be this page
                contradicting the receipt. The canonical bilingual copy for
                the other case stays in the translation table. */}
            <p data-testid={linkedAccess.data?.canRespond === true ? 'enquiry-already-yours' : 'enquiry-not-in-list'}>
              {linkedAccess.data?.canRespond === true
                ? (ar
                    ? 'هذا الطلب في سجلّك بالفعل، لكنه لم يعد ضمن هاتين القائمتين. افتح صفحة الطلب.'
                    : 'This request is already in your record but is no longer in either list. Open the request itself.')
                : t('enquiries.notInList')}
            </p>
            {/* AND A WAY TO THE AUTHORITATIVE ANSWER. The two reasons are the
                honest summary of the possibilities from here; the request's own
                page asks the server which one actually applies and says so. */}
            <Link href={`/rfq/${highlightRfqId}`} className="mt-1 inline-block underline" data-testid="enquiry-not-eligible-open">
              {ar ? 'افتح الطلب لمعرفة السبب' : 'Open the request to see why'}
            </Link>
          </div>
        )}

        {/* WHAT CAN STILL BE TAKEN. First, because it is the only half with a
            deadline attached to it. */}
        <EnquiryQueue scope="opportunities" highlightRfqId={linkedIsOpportunity ? highlightRfqId : undefined} />
        {/* WHAT HAS BEEN TAKEN. The record, and the pipeline. */}
        <EnquiryQueue scope="leads" highlightRfqId={linkedRow && !linkedIsOpportunity ? highlightRfqId : undefined} />
      </div>
    </DashboardLayout>
  );
}
