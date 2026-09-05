/**
 * THE DISPUTE VOCABULARY, IN BOTH LANGUAGES, ONCE.
 *
 * The closed sets themselves live in shared/disputes.ts, where the server reads
 * them too. What lives here is only their TRANSLATION - and it lives in one
 * place because three screens now render these words (the support queue, the
 * user's list, the user's detail page), and three copies of a label map is
 * exactly how this codebase ended up with four disagreeing category
 * vocabularies. A test holds these keys against the shared sets, so a value
 * added there cannot silently render as its own raw enum name.
 */
import {
  DISPUTE_CATEGORIES, DISPUTE_PRIORITIES, DISPUTE_RESOLUTION_TYPES,
  DISPUTE_STATUSES, DISPUTE_SUBJECT_TYPES,
} from '@shared/disputes';

type Dictionary = Record<string, string>;

const EN = {
  status: {
    open: 'Open', investigating: 'Investigating', resolved: 'Resolved',
    rejected: 'Rejected', withdrawn: 'Withdrawn',
  } as Dictionary,
  priority: { low: 'Low', medium: 'Medium', high: 'High' } as Dictionary,
  category: {
    quality: 'Quality', delivery: 'Delivery', quantity: 'Quantity',
    specification: 'Specification', communication: 'Communication',
    conduct: 'Conduct', pricing: 'Pricing', other: 'Other',
  } as Dictionary,
  subject: { project: 'Project', rfq: 'RFQ', quotation: 'Quotation' } as Dictionary,
  resolution: {
    resolved_by_agreement: 'Resolved by agreement',
    resolved_by_platform: 'Resolved by BuildHub',
    no_action_required: 'No action required',
    insufficient_evidence: 'Insufficient evidence',
    out_of_scope: 'Out of scope',
  } as Dictionary,
};

const AR = {
  status: {
    open: 'مفتوحة', investigating: 'قيد التحقيق', resolved: 'تم الحل',
    rejected: 'مرفوضة', withdrawn: 'مسحوبة',
  } as Dictionary,
  priority: { low: 'منخفضة', medium: 'متوسطة', high: 'عالية' } as Dictionary,
  category: {
    quality: 'الجودة', delivery: 'التسليم', quantity: 'الكمية',
    specification: 'المواصفات', communication: 'التواصل',
    conduct: 'السلوك', pricing: 'التسعير', other: 'أخرى',
  } as Dictionary,
  subject: { project: 'مشروع', rfq: 'طلب عرض سعر', quotation: 'عرض سعر' } as Dictionary,
  resolution: {
    resolved_by_agreement: 'اتفاق بين الطرفين',
    resolved_by_platform: 'قرار من المنصة',
    no_action_required: 'لا يلزم إجراء',
    insufficient_evidence: 'أدلة غير كافية',
    out_of_scope: 'خارج نطاق المنصة',
  } as Dictionary,
};

/**
 * The sets these dictionaries must cover. Exported so the test asserting the
 * coverage reads the same list the code does rather than restating it.
 */
export const DISPUTE_VOCABULARIES = {
  status: DISPUTE_STATUSES,
  priority: DISPUTE_PRIORITIES,
  category: DISPUTE_CATEGORIES,
  subject: DISPUTE_SUBJECT_TYPES,
  resolution: DISPUTE_RESOLUTION_TYPES,
} as const;

export type DisputeLabels = {
  status: (value: string) => string;
  priority: (value: string) => string;
  category: (value: string) => string;
  subject: (value: string) => string;
  resolution: (value: string) => string;
};

/**
 * An unknown value RENDERS AS ITSELF rather than as an empty cell. A blank
 * where a status should be reads as "no status", which no dispute has; the raw
 * value is ugly and true, and it is the string somebody can search for.
 */
export function disputeLabels(ar: boolean): DisputeLabels {
  const dict = ar ? AR : EN;
  const pick = (kind: keyof typeof EN) => (value: string) => dict[kind][value] ?? value;
  return {
    status: pick('status'), priority: pick('priority'), category: pick('category'),
    subject: pick('subject'), resolution: pick('resolution'),
  };
}

/**
 * Open work is the thing that needs attention, and reads as such. A resolved
 * dispute is not an alarm and a withdrawn one is not a failure.
 */
export function statusTone(value: string): 'destructive' | 'default' | 'secondary' {
  return value === 'open' ? 'destructive' : value === 'investigating' ? 'default' : 'secondary';
}
