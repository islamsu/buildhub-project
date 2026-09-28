/**
 * ── READING BACK WHAT WAS ASKED FOR ─────────────────────────────────────
 *
 * The finishing brief was write-only: stored on create and rendered by nothing.
 * The requester could not reopen what they had written, and the contractor
 * pricing the job could not see the property type, the area, the finishing
 * level, or - most importantly - which questions the customer had said they did
 * not know.
 *
 * ── "NOT STATED" IS A FINDING, NOT A BLANK ──────────────────────────────
 *
 * The whole point of لا أعرف / ساعدني في الاختيار is that it survives to this
 * screen. A contractor who can see that the customer does not know their
 * finishing level knows to ask, or to quote a range, or to offer the three
 * packages. A blank would have told them nothing and a guessed "Standard" would
 * have told them something false.
 *
 * So an explicit unknown renders as its own thing, visibly different from a
 * field nobody was asked. Three states, shown as three states.
 */
import { Badge } from '@/components/ui/badge';
import {
  isUnknown, UNKNOWN_LABEL,
  finishingKindLabel, propertyTypeLabel, currentConditionLabel, finishingLevelLabel,
  finishingAreaLabel, finishingTradeLabel, pricingPreferenceLabel, isPricingPreference,
  type FinishingBrief,
} from '@shared/finishing';

type Row = { label: string; value: string | null; unknown: boolean };

/**
 * One brief field, reduced to what the reader sees.
 *
 * `null` means the question was never answered and the row is dropped entirely.
 * `unknown` means it was answered with "I don't know" and the row STAYS, because
 * that is information.
 */
function state<T extends string>(
  label: string,
  raw: T | 'unknown' | null | undefined,
  render: (value: T, lang: 'en' | 'ar') => string,
  lang: 'en' | 'ar',
): Row | null {
  if (raw === null || raw === undefined) return null;
  if (isUnknown(raw)) return { label, value: UNKNOWN_LABEL[lang], unknown: true };
  return { label, value: render(raw as T, lang), unknown: false };
}

export default function FinishingBriefSummary({
  brief, pricingPreference, lang,
}: {
  brief: FinishingBrief | null | undefined;
  pricingPreference?: string | null;
  lang: 'en' | 'ar';
}) {
  if (!brief) return null;
  const ar = lang === 'ar';

  const area = brief.areaSqm;
  const areaRow: Row | null = area === null || area === undefined
    ? null
    : isUnknown(area)
      ? { label: ar ? 'المساحة' : 'Area', value: UNKNOWN_LABEL[lang], unknown: true }
      : { label: ar ? 'المساحة' : 'Area', value: `${area} ${ar ? 'م²' : 'm²'}`, unknown: false };

  const text = (label: string, raw: string | 'unknown' | null | undefined): Row | null =>
    raw === null || raw === undefined || raw === ''
      ? null
      : isUnknown(raw)
        ? { label, value: UNKNOWN_LABEL[lang], unknown: true }
        : { label, value: raw, unknown: false };

  const rows: (Row | null)[] = [
    state(ar ? 'نوع التشطيب' : 'Finishing kind', brief.kind as never, finishingKindLabel, lang),
    state(ar ? 'نوع العقار' : 'Property', brief.propertyType as never, propertyTypeLabel, lang),
    state(ar ? 'الحالة الحالية' : 'Current condition', brief.currentCondition as never, currentConditionLabel, lang),
    areaRow,
    state(ar ? 'مستوى التشطيب' : 'Finishing level', brief.level as never, finishingLevelLabel, lang),
    brief.areas?.length
      ? { label: ar ? 'الغرف والمساحات' : 'Rooms and areas',
          value: brief.areas.map(value => finishingAreaLabel(value, lang)).join(ar ? '، ' : ', '),
          unknown: false }
      : null,
    brief.trades?.length
      ? { label: ar ? 'البنود المطلوبة' : 'Trades required',
          value: brief.trades.map(value => finishingTradeLabel(value, lang)).join(ar ? '، ' : ', '),
          unknown: false }
      : null,
    text(ar ? 'الخامات المفضلة' : 'Material preferences', brief.materialPreferences as never),
    text(ar ? 'قيود الموقع' : 'Site constraints', brief.siteConstraints as never),
    text(ar ? 'متطلبات خاصة' : 'Special requirements', brief.specialRequirements ?? null),
    text(ar ? 'تفاصيل إضافية' : 'Additional detail', brief.scopeNotes ?? null),
    pricingPreference && isPricingPreference(pricingPreference)
      ? { label: ar ? 'طريقة التسعير المطلوبة' : 'Preferred pricing method',
          value: pricingPreferenceLabel(pricingPreference, lang), unknown: false }
      : null,
  ];

  const present = rows.filter((row): row is Row => row !== null);
  if (present.length === 0) return null;
  const unknownCount = present.filter(row => row.unknown).length;

  return (
    <div className="space-y-2" data-testid="finishing-brief-summary">
      <dl className="grid gap-x-4 gap-y-2 @[26rem]/brief-summary:grid-cols-2">
        {present.map(row => (
          <div key={row.label} className="min-w-0" data-testid="brief-summary-row">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className={`text-sm ${row.unknown ? 'text-muted-foreground italic' : 'font-medium'}`}
              data-testid={row.unknown ? 'brief-summary-unknown' : 'brief-summary-value'}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {unknownCount > 0 && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
          data-testid="brief-summary-unknown-note">
          <Badge variant="outline">
            {ar ? `${unknownCount} بند غير محدد` : `${unknownCount} not stated`}
          </Badge>
          {/* Addressed to whoever is reading: the customer sees what they left
              open, the contractor sees what to ask about. */}
          {ar
            ? 'قال صاحب الطلب إنه لا يعرف هذه البنود. اسأله عنها أو قدّم خيارات.'
            : 'The requester said they do not know these. Ask about them, or offer options.'}
        </p>
      )}
    </div>
  );
}
