/**
 * ── طلب تشطيب, WRITTEN BY SOMEONE WHO HAS NEVER WRITTEN ONE ─────────────
 *
 * The person filling this in has usually just taken delivery of a shell
 * apartment. They do not know what "core and shell" is called, they have not
 * measured the area, and they have no opinion yet about a finishing level -
 * because nobody has told them what the levels are.
 *
 * A form that insists produces one of two things: an abandoned form, or an
 * invented answer that a contractor then prices and a customer then plans
 * around.
 *
 * ── SO EVERY QUESTION HAS THREE ANSWERS ─────────────────────────────────
 *
 *   a value          they know
 *   لا أعرف          they were asked and they do not know   ← STORED
 *   nothing          they have not been asked yet
 *
 * The middle one is the feature. It never blocks publication, it is never
 * quietly replaced with a default, and it is what the assistant reads to offer
 * "ساعدني في تحديد مستوى التشطيب" for that specific field and no other.
 *
 * ── AND IT IS PROGRESSIVE ───────────────────────────────────────────────
 *
 * Nothing here is required. A homeowner who answers two questions and publishes
 * has written a real request - it is, in fact, exactly the request a first-time
 * homeowner has - and a contractor reading it knows which questions to ask.
 */
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import AskAiAbout from '@/components/AskAiAbout';
import {
  UNKNOWN, UNKNOWN_LABEL, isUnknown,
  FINISHING_KINDS, finishingKindLabel,
  PROPERTY_TYPES, propertyTypeLabel,
  CURRENT_CONDITIONS, currentConditionLabel,
  FINISHING_LEVELS, finishingLevelLabel, FINISHING_LEVEL_HELP,
  FINISHING_AREAS, finishingAreaLabel,
  FINISHING_TRADES, finishingTradeLabel,
  REQUESTING_PARTIES, requestingPartyLabel, isProfessionalParty,
  PRICING_PREFERENCES, pricingPreferenceLabel,
  type FinishingBrief, type PricingPreference,
} from '@shared/finishing';

export type BriefDraft = FinishingBrief & { pricingPreference?: PricingPreference | null };

export const EMPTY_BRIEF: BriefDraft = {};

/**
 * The payload for `rfq.create`, or undefined when nothing was answered.
 *
 * NULLS ARE STRIPPED, not sent. In this form `null` is what a cleared chip
 * leaves behind and it means exactly what an absent key means - "not asked" -
 * so sending it would add a third spelling of one state. The stored `'unknown'`
 * sentinel is a different thing entirely and goes through untouched: that one
 * is a person saying they do not know.
 */
export function briefPayload(draft: BriefDraft): Record<string, unknown> | undefined {
  const { pricingPreference: _preference, ...brief } = draft;
  const stated = Object.entries(brief).filter(([, value]) =>
    value !== undefined && value !== null && value !== ''
    && !(Array.isArray(value) && value.length === 0));
  return stated.length > 0 ? Object.fromEntries(stated) : undefined;
}

/**
 * A row of choices, plus "I don't know".
 *
 * The unknown chip is styled as a real option rather than a way out, because it
 * IS a real answer. Making it look like a skip link teaches people it is a
 * failure to answer, and they invent something instead.
 */
/**
 * ── WHY THESE CHIPS NEED THEIR OWN CLASSES ──────────────────────────────
 *
 * `Button` is `whitespace-nowrap shrink-0`, which is right for a toolbar and
 * wrong here: "لا أعرف / ساعدني في الاختيار" and "Core and shell — nothing
 * finished" are sentences, and a chip that can neither wrap nor shrink pushes
 * its row sideways out of the dialog. That is what the owner's screenshot
 * shows.
 *
 * So the chip is allowed to wrap onto a second line and to shrink, and gets an
 * auto height with real vertical padding so a wrapped label still has a
 * comfortable touch target rather than a squashed one.
 */
const CHIP = 'h-auto min-w-0 max-w-full whitespace-normal py-2 text-start leading-snug';

function ChoiceRow<T extends string>({
  label, values, labelOf, value, onChange, lang, testId, help,
}: {
  label: string;
  values: readonly T[];
  labelOf: (value: T, lang: 'en' | 'ar') => string;
  value: T | typeof UNKNOWN | null | undefined;
  onChange: (value: T | typeof UNKNOWN | null) => void;
  lang: 'en' | 'ar';
  testId: string;
  help?: Readonly<Record<T, { en: string; ar: string }>>;
}) {
  const chosen = value;
  return (
    <div data-testid={testId}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {values.map(option => (
          <Button
            key={option}
            type="button"
            role="radio"
            aria-checked={chosen === option}
            variant={chosen === option ? 'default' : 'outline'}
            size="sm"
            className={CHIP}
            data-testid={`${testId}-${option}`}
            /* Choosing the same option again clears it: a person who clicked by
               accident should not have to know which chip means "actually, no". */
            onClick={() => onChange(chosen === option ? null : option)}
          >
            {labelOf(option, lang)}
          </Button>
        ))}
        <Button
          type="button"
          role="radio"
          aria-checked={isUnknown(chosen)}
          variant={isUnknown(chosen) ? 'secondary' : 'ghost'}
          size="sm"
          className={`border border-dashed ${CHIP}`}
          data-testid={`${testId}-unknown`}
          onClick={() => onChange(isUnknown(chosen) ? null : UNKNOWN)}
        >
          {UNKNOWN_LABEL[lang]}
        </Button>
      </div>
      {/* The explanation appears for the option under consideration, which is
          where it is useful - not as a wall of help text above the choices. */}
      {help && chosen && !isUnknown(chosen) ? (
        <p className="mt-1.5 text-xs text-muted-foreground" data-testid={`${testId}-help`}>
          {help[chosen as T][lang]}
        </p>
      ) : null}
      {isUnknown(chosen) ? (
        <p className="mt-1.5 text-xs text-muted-foreground" data-testid={`${testId}-unknown-note`}>
          {lang === 'ar'
            ? 'لا بأس — يمكنك النشر بدون هذه المعلومة، وسيقترح المساعد شرحاً لها.'
            : "That's fine — you can publish without it, and the assistant will offer to explain it."}
        </p>
      ) : null}
    </div>
  );
}

/** A multi-select of areas or trades. No unknown state: an empty list IS one. */
function MultiRow<T extends string>({
  label, values, labelOf, selected, onChange, lang, testId,
}: {
  label: string;
  values: readonly T[];
  labelOf: (value: T, lang: 'en' | 'ar') => string;
  selected: T[] | null | undefined;
  onChange: (values: T[] | null) => void;
  lang: 'en' | 'ar';
  testId: string;
}) {
  const list = selected ?? [];
  return (
    <div data-testid={testId}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="flex flex-wrap gap-2">
        {values.map(option => {
          const on = list.includes(option);
          return (
            <Button
              key={option} type="button" size="sm"
              variant={on ? 'default' : 'outline'}
              className={CHIP}
              aria-pressed={on}
              data-testid={`${testId}-${option}`}
              onClick={() => {
                const next = on ? list.filter(item => item !== option) : [...list, option];
                onChange(next.length > 0 ? next : null);
              }}
            >
              {labelOf(option, lang)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** A number, or "I don't know". */
function NumberOrUnknown({
  label, value, onChange, lang, testId, suffix,
}: {
  label: string;
  value: number | typeof UNKNOWN | null | undefined;
  onChange: (value: number | typeof UNKNOWN | null) => void;
  lang: 'en' | 'ar';
  testId: string;
  suffix?: string;
}) {
  return (
    <div data-testid={testId}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number" min="1" step="1" className="w-40"
          data-testid={`${testId}-input`}
          value={isUnknown(value) || value == null ? '' : String(value)}
          placeholder={isUnknown(value) ? UNKNOWN_LABEL[lang] : suffix}
          onChange={event => {
            const parsed = Number(event.target.value);
            onChange(event.target.value === '' ? null : (Number.isFinite(parsed) ? parsed : null));
          }}
        />
        {suffix ? <span className="text-sm text-muted-foreground">{suffix}</span> : null}
        <Button
          type="button" size="sm"
          variant={isUnknown(value) ? 'secondary' : 'ghost'}
          className={`border border-dashed ${CHIP}`}
          aria-pressed={isUnknown(value)}
          data-testid={`${testId}-unknown`}
          onClick={() => onChange(isUnknown(value) ? null : UNKNOWN)}
        >
          {UNKNOWN_LABEL[lang]}
        </Button>
      </div>
    </div>
  );
}

/** Free text, or "I don't know". */
function TextOrUnknown({
  label, value, onChange, lang, testId, rows = 2,
}: {
  label: string;
  value: string | typeof UNKNOWN | null | undefined;
  onChange: (value: string | typeof UNKNOWN | null) => void;
  lang: 'en' | 'ar';
  testId: string;
  rows?: number;
}) {
  return (
    <div data-testid={testId}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <Textarea
        rows={rows} maxLength={1000}
        data-testid={`${testId}-input`}
        value={isUnknown(value) || value == null ? '' : value}
        placeholder={isUnknown(value) ? UNKNOWN_LABEL[lang] : undefined}
        onChange={event => onChange(event.target.value || null)}
      />
      <Button
        type="button" size="sm" className={`mt-1.5 border border-dashed ${CHIP}`}
        variant={isUnknown(value) ? 'secondary' : 'ghost'}
        aria-pressed={isUnknown(value)}
        data-testid={`${testId}-unknown`}
        onClick={() => onChange(isUnknown(value) ? null : UNKNOWN)}
      >
        {UNKNOWN_LABEL[lang]}
      </Button>
    </div>
  );
}

export function FinishingBriefFields({
  draft, onChange, lang,
}: { draft: BriefDraft; onChange: (next: BriefDraft) => void; lang: 'en' | 'ar' }) {
  const ar = lang === 'ar';
  const set = <K extends keyof BriefDraft>(key: K) => (value: BriefDraft[K]) =>
    onChange({ ...draft, [key]: value });
  /**
   * A MAIN CONTRACTOR IS NOT A HOMEOWNER WITH MORE FIELDS.
   *
   * A professional party already works in trades and quantities, so they get
   * the trade breakdown; a property owner gets rooms, which is how they think
   * about their own flat. The homeowner form is not a reduced version of the
   * professional one - it asks different questions.
   */
  const professional = isProfessionalParty(draft.requestingParty as never);

  return (
    /*
     * ── @container, NOT sm: ──────────────────────────────────────────────
     *
     * The pairs below were `sm:grid-cols-2`, and `sm:` asks about the VIEWPORT.
     * Inside a max-w-lg dialog on a 1440px desktop that condition is satisfied,
     * so two columns were rendered into roughly 230px each however much screen
     * there was - the cramped Materials / Site constraints pair in the owner's
     * screenshot. A container query asks the question that actually matters:
     * how wide is THIS box.
     */
    <div className="@container/brief space-y-5" data-testid="finishing-brief">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground" data-testid="finishing-brief-intro">
          {ar
            ? 'أجب عمّا تعرفه فقط. كل سؤال هنا اختياري، ويمكنك النشر مع ترك أي منها بلا إجابة.'
            : 'Answer only what you know. Every question here is optional, and you can publish with any of them unanswered.'}
        </p>
        {/* THE HELP IS HERE, WHERE THE QUESTIONS ARE. A homeowner who does not
            know what a finishing level is should not have to leave the form to
            find out - and this opens the assistant on the تشطيب category, so it
            offers the four finishing actions rather than six generic prompts.
            It asks nothing; the person chooses. */}
        <AskAiAbout
          subject="category" subtype="Renovation" lang={lang} variant="ghost"
          label={ar ? 'ساعدني في الإجابة' : 'Help me answer these'} />
      </div>

      <ChoiceRow
        label={ar ? 'من يقدّم الطلب؟' : 'Who is asking?'}
        values={REQUESTING_PARTIES} labelOf={requestingPartyLabel}
        value={draft.requestingParty as never} onChange={set('requestingParty') as never}
        lang={lang} testId="brief-party" />

      <ChoiceRow
        label={ar ? 'نوع التشطيب' : 'What kind of finishing?'}
        values={FINISHING_KINDS} labelOf={finishingKindLabel}
        value={draft.kind as never} onChange={set('kind') as never}
        lang={lang} testId="brief-kind" />

      <div className="grid gap-5 @[30rem]/brief:grid-cols-2">
        <ChoiceRow
          label={ar ? 'نوع العقار' : 'Property type'}
          values={PROPERTY_TYPES} labelOf={propertyTypeLabel}
          value={draft.propertyType as never} onChange={set('propertyType') as never}
          lang={lang} testId="brief-property" />
        <ChoiceRow
          label={ar ? 'حالة الوحدة الآن' : 'Condition right now'}
          values={CURRENT_CONDITIONS} labelOf={currentConditionLabel}
          value={draft.currentCondition as never} onChange={set('currentCondition') as never}
          lang={lang} testId="brief-condition" />
      </div>

      <NumberOrUnknown
        label={ar ? 'المساحة التقريبية' : 'Approximate area'}
        value={draft.areaSqm as never} onChange={set('areaSqm') as never}
        lang={lang} testId="brief-area" suffix={ar ? 'م²' : 'm²'} />

      <ChoiceRow
        label={ar ? 'مستوى التشطيب المطلوب' : 'Finishing level you want'}
        values={FINISHING_LEVELS} labelOf={finishingLevelLabel}
        value={draft.level as never} onChange={set('level') as never}
        lang={lang} testId="brief-level" help={FINISHING_LEVEL_HELP} />

      {professional ? (
        <MultiRow
          label={ar ? 'البنود المطلوبة' : 'Trades required'}
          values={FINISHING_TRADES} labelOf={finishingTradeLabel}
          selected={draft.trades as never} onChange={set('trades') as never}
          lang={lang} testId="brief-trades" />
      ) : (
        <MultiRow
          label={ar ? 'الغرف والمساحات' : 'Rooms and areas'}
          values={FINISHING_AREAS} labelOf={finishingAreaLabel}
          selected={draft.areas as never} onChange={set('areas') as never}
          lang={lang} testId="brief-areas" />
      )}

      <div className="grid gap-5 @[30rem]/brief:grid-cols-2">
        <TextOrUnknown
          label={ar ? 'خامات أو ماركات تفضّلها' : 'Materials or brands you prefer'}
          value={draft.materialPreferences as never} onChange={set('materialPreferences') as never}
          lang={lang} testId="brief-materials" />
        <TextOrUnknown
          label={ar ? 'قيود الموقع' : 'Site constraints'}
          value={draft.siteConstraints as never} onChange={set('siteConstraints') as never}
          lang={lang} testId="brief-constraints" />
      </div>

      <div>
        <span className="mb-1.5 block text-sm font-medium">
          {ar ? 'تفاصيل إضافية' : 'Anything else'}
        </span>
        <Textarea rows={3} maxLength={4000} data-testid="brief-scope-notes"
          value={draft.scopeNotes ?? ''}
          onChange={event => set('scopeNotes')(event.target.value || null)} />
      </div>

      {/* ── THE PRICING PREFERENCE ─────────────────────────────────────── */}
      <div data-testid="brief-pricing-preference">
        <span className="mb-1.5 block text-sm font-medium">
          {ar ? 'كيف تفضّل أن يُسعَّر العمل؟' : 'How would you like it priced?'}
        </span>
        <p className="mb-2 text-xs text-muted-foreground">
          {/* A PREFERENCE, NEVER A GATE. Publication does not require it, and
              "let the contractor propose" is a real answer, not a cop-out. */}
          {ar
            ? 'اختياري تماماً. إن لم تكن متأكداً، اترك الأمر للمقاول.'
            : "Entirely optional. If you are not sure, let the contractor propose."}
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup"
          aria-label={ar ? 'طريقة التسعير المفضلة' : 'Preferred pricing method'}>
          {PRICING_PREFERENCES.map(preference => (
            <Button
              key={preference} type="button" role="radio" size="sm"
              className={CHIP}
              aria-checked={draft.pricingPreference === preference}
              variant={draft.pricingPreference === preference ? 'default' : 'outline'}
              data-testid={`brief-preference-${preference}`}
              onClick={() => set('pricingPreference')(
                draft.pricingPreference === preference ? null : preference)}
            >
              {pricingPreferenceLabel(preference, lang)}
            </Button>
          ))}
        </div>
        {draft.pricingPreference && draft.pricingPreference !== 'provider_choice' ? (
          <p className="mt-1.5 text-xs text-muted-foreground" data-testid="brief-preference-note">
            {ar
              ? 'سيُطلب من المقاولين التسعير بهذه الطريقة.'
              : 'Contractors will be asked to price this way.'}
          </p>
        ) : null}
      </div>

      {/* A quiet, honest summary of what is going out unanswered. */}
      <UnknownSummary draft={draft} lang={lang} />
    </div>
  );
}

/**
 * What this request will say it does not know.
 *
 * Shown so the person is not surprised, and framed as normal rather than as a
 * list of failures - because it IS normal, and because a customer who feels
 * caught out by it will go back and invent answers.
 */
function UnknownSummary({ draft, lang }: { draft: BriefDraft; lang: 'en' | 'ar' }) {
  const ar = lang === 'ar';
  const unknowns = (['kind', 'propertyType', 'currentCondition', 'areaSqm', 'level',
    'materialPreferences', 'siteConstraints'] as const)
    .filter(field => isUnknown((draft as Record<string, unknown>)[field]));
  if (unknowns.length === 0) return null;
  return (
    <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground"
      data-testid="brief-unknown-summary">
      <Badge variant="outline" className="mb-1.5">
        {ar ? `${unknowns.length} بند بلا إجابة` : `${unknowns.length} left open`}
      </Badge>
      <p>
        {ar
          ? 'سيظهر هذا للمقاولين كـ«غير محدد» — وهو أمر طبيعي تماماً. يمكنهم سؤالك، ويمكن للمساعد شرح أي منها لك.'
          : 'Contractors will see these as "not stated", which is completely normal. They can ask you, and the assistant can explain any of them.'}
      </p>
    </div>
  );
}
