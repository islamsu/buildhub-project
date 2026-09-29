/**
 * ── A FINISHING REQUEST A HOMEOWNER CAN ACTUALLY WRITE ──────────────────
 *
 * تشطيب is the most common thing an Egyptian homeowner needs priced and the
 * hardest thing for them to ask for. A request form built for professionals
 * asks for a scope of works and a bill of quantities; a person who has just
 * taken delivery of a shell apartment has neither, has never heard of either,
 * and abandons the form.
 *
 * ── THE ESCAPE HATCH IS THE FEATURE ─────────────────────────────────────
 *
 * The single most important value in this file is `UNKNOWN`. Every field that
 * is not genuinely mandatory accepts "لا أعرف / ساعدني في الاختيار", and that
 * answer:
 *
 *   NEVER blocks publication. A request with six unknowns is a real request -
 *     it is, in fact, exactly the request a first-time homeowner has - and a
 *     contractor reading it knows precisely which questions to ask.
 *
 *   IS NEVER SILENTLY REPLACED. It is stored as the sentinel and rendered as
 *     "not stated". Defaulting an unknown finishing level to "standard" would
 *     put a number on a bid for a standard nobody chose.
 *
 *   TRIGGERS HELP. It is the signal the suggestion engine reads to offer
 *     "ساعدني في تحديد مستوى التشطيب" for that specific field.
 *
 * A field left untouched and a field explicitly marked unknown are different
 * states and are stored differently: absent means "not asked yet", UNKNOWN
 * means "asked, and the person said they do not know". Only the second one
 * should make the assistant offer to explain.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────
 *
 * NO SECOND REQUEST TYPE. A finishing request IS an `rfqs` row, with the
 * canonical `Renovation` / تشطيب وترميم category, the canonical market,
 * currency, lifecycle, attachments and authorization. This file describes the
 * BRIEF that hangs off it and nothing else.
 *
 * NO SECOND IDENTITY TAXONOMY. The requesting parties below map onto the
 * account and relationship model BuildHub already has; the list exists so the
 * brief can record which hat the requester is wearing, not so a parallel set of
 * account types can grow.
 */

/**
 * "I don't know / help me choose."
 *
 * A string sentinel rather than null, because null already means "not asked".
 * The two are different and the difference is what drives the help.
 */
export const UNKNOWN = 'unknown' as const;
export type Unknown = typeof UNKNOWN;

export const isUnknown = (value: unknown): value is Unknown => value === UNKNOWN;

export const UNKNOWN_LABEL: Readonly<{ en: string; ar: string }> = {
  en: "I don't know — help me choose",
  ar: 'لا أعرف / ساعدني في الاختيار',
};

/** How a stated-or-unknown value reads to a person. Never a guessed value. */
export function statedOrUnknown<T extends string>(
  value: T | Unknown | null | undefined,
  label: (value: T, lang: 'en' | 'ar') => string,
  lang: 'en' | 'ar',
): string | null {
  if (value === null || value === undefined) return null;
  if (isUnknown(value)) return UNKNOWN_LABEL[lang];
  return label(value as T, lang);
}

type LabelPair = { en: string; ar: string };
const labelOf = <K extends string>(
  table: Readonly<Record<K, LabelPair>>,
) => (value: K, lang: 'en' | 'ar'): string => table[value][lang];

// ── Who is asking ──────────────────────────────────────────────────────────

/**
 * The hat the requester is wearing on THIS request.
 *
 * Recorded because it changes what a contractor needs to send back, not because
 * it changes who may ask: every one of these is an existing BuildHub account,
 * and authorization comes from the account, never from this field.
 */
export const REQUESTING_PARTIES = [
  'property_owner', 'developer', 'consultant', 'main_contractor',
  'subcontractor', 'property_manager', 'organization',
] as const;
export type RequestingParty = (typeof REQUESTING_PARTIES)[number];

export const REQUESTING_PARTY_LABELS: Readonly<Record<RequestingParty, LabelPair>> = {
  property_owner:   { en: 'Property owner',    ar: 'مالك العقار' },
  developer:        { en: 'Developer',         ar: 'مطوّر عقاري' },
  consultant:       { en: 'Consultant',        ar: 'استشاري' },
  main_contractor:  { en: 'Main contractor',   ar: 'مقاول رئيسي' },
  subcontractor:    { en: 'Subcontractor',     ar: 'مقاول باطن' },
  property_manager: { en: 'Property manager',  ar: 'إدارة أملاك' },
  organization:     { en: 'Company / organization', ar: 'شركة أو جهة' },
};
export const requestingPartyLabel = labelOf(REQUESTING_PARTY_LABELS);

/**
 * Whether this party gets the denser professional intake.
 *
 * A main contractor asking a subcontractor to price a package already works in
 * quantities; a property owner does not. The homeowner form is not a reduced
 * version of the professional one - it asks different questions.
 */
export const isProfessionalParty = (party: RequestingParty | Unknown | null | undefined): boolean =>
  party !== null && party !== undefined && !isUnknown(party) && party !== 'property_owner';

// ── What kind of finishing ─────────────────────────────────────────────────

export const FINISHING_KINDS = ['full', 'partial', 'renovation', 'specific_area'] as const;
export type FinishingKind = (typeof FINISHING_KINDS)[number];

export const FINISHING_KIND_LABELS: Readonly<Record<FinishingKind, LabelPair>> = {
  full:          { en: 'Full finishing',        ar: 'تشطيب كامل' },
  partial:       { en: 'Partial finishing',     ar: 'تشطيب جزئي' },
  renovation:    { en: 'Renovation',            ar: 'تجديد' },
  specific_area: { en: 'A specific area',       ar: 'منطقة محددة' },
};
export const finishingKindLabel = labelOf(FINISHING_KIND_LABELS);

export const PROPERTY_TYPES = ['apartment', 'villa', 'duplex', 'office', 'retail', 'other'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PROPERTY_TYPE_LABELS: Readonly<Record<PropertyType, LabelPair>> = {
  apartment: { en: 'Apartment', ar: 'شقة' },
  villa:     { en: 'Villa',     ar: 'فيلا' },
  duplex:    { en: 'Duplex',    ar: 'دوبلكس' },
  office:    { en: 'Office',    ar: 'مكتب' },
  retail:    { en: 'Retail unit', ar: 'محل تجاري' },
  other:     { en: 'Other',     ar: 'أخرى' },
};
export const propertyTypeLabel = labelOf(PROPERTY_TYPE_LABELS);

/** The state the space is in now, in the words a homeowner would use. */
export const CURRENT_CONDITIONS = ['core_shell', 'semi_finished', 'finished', 'occupied'] as const;
export type CurrentCondition = (typeof CURRENT_CONDITIONS)[number];

export const CURRENT_CONDITION_LABELS: Readonly<Record<CurrentCondition, LabelPair>> = {
  core_shell:    { en: 'Core and shell — nothing finished', ar: 'على المحارة / نصف تشطيب' },
  semi_finished: { en: 'Partly finished',                   ar: 'تشطيب جزئي قائم' },
  finished:      { en: 'Finished, being redone',            ar: 'مُشطّب ويُعاد تشطيبه' },
  occupied:      { en: 'Finished and occupied',             ar: 'مُشطّب ومسكون' },
};
export const currentConditionLabel = labelOf(CURRENT_CONDITION_LABELS);

/**
 * The finishing standard.
 *
 * NOT the same list as a package tier, and deliberately so. This is the
 * REQUESTER's statement of the standard they want; a package tier is the
 * CONTRACTOR's product name. Merging them would make "the customer asked for
 * premium" and "the contractor sells a Premium package" the same claim, and
 * they are not.
 */
export const FINISHING_LEVELS = ['basic', 'standard', 'high', 'luxury'] as const;
export type FinishingLevel = (typeof FINISHING_LEVELS)[number];

export const FINISHING_LEVEL_LABELS: Readonly<Record<FinishingLevel, LabelPair>> = {
  basic:    { en: 'Basic',        ar: 'بسيط' },
  standard: { en: 'Standard',     ar: 'متوسط' },
  high:     { en: 'High quality', ar: 'عالي' },
  luxury:   { en: 'Luxury',       ar: 'فاخر' },
};
export const finishingLevelLabel = labelOf(FINISHING_LEVEL_LABELS);

export const FINISHING_LEVEL_HELP: Readonly<Record<FinishingLevel, LabelPair>> = {
  basic:    { en: 'Sound and plain: local materials, simple fittings.',       ar: 'تشطيب سليم وبسيط: خامات محلية وتجهيزات عادية.' },
  standard: { en: 'The usual standard for a family home.',                    ar: 'المستوى المعتاد لشقة عائلية.' },
  high:     { en: 'Better materials and joinery, more detailed work.',        ar: 'خامات ونجارة أفضل وتفاصيل أدق.' },
  luxury:   { en: 'Imported materials, bespoke joinery, detailed finishes.',  ar: 'خامات مستوردة ونجارة خاصة وتفاصيل دقيقة.' },
};

/** The rooms and areas a brief can name, in the vocabulary a homeowner uses. */
export const FINISHING_AREAS = [
  'reception', 'living', 'bedroom', 'kitchen', 'bathroom',
  'balcony', 'stairs', 'roof', 'garage', 'garden', 'facade',
] as const;
export type FinishingArea = (typeof FINISHING_AREAS)[number];

export const FINISHING_AREA_LABELS: Readonly<Record<FinishingArea, LabelPair>> = {
  reception: { en: 'Reception', ar: 'ريسبشن' },
  living:    { en: 'Living room', ar: 'غرفة معيشة' },
  bedroom:   { en: 'Bedroom',   ar: 'غرفة نوم' },
  kitchen:   { en: 'Kitchen',   ar: 'مطبخ' },
  bathroom:  { en: 'Bathroom',  ar: 'حمام' },
  balcony:   { en: 'Balcony',   ar: 'بلكونة' },
  stairs:    { en: 'Stairs',    ar: 'سلالم' },
  roof:      { en: 'Roof',      ar: 'سطح' },
  garage:    { en: 'Garage',    ar: 'جراج' },
  garden:    { en: 'Garden',    ar: 'حديقة' },
  facade:    { en: 'Facade',    ar: 'واجهة' },
};
export const finishingAreaLabel = labelOf(FINISHING_AREA_LABELS);

/** The trades a brief can request, matching the BOQ grouping vocabulary. */
export const FINISHING_TRADES = [
  'plaster', 'flooring', 'painting', 'electrical', 'plumbing',
  'carpentry', 'aluminium', 'gypsum', 'kitchen', 'sanitary', 'hvac',
] as const;
export type FinishingTrade = (typeof FINISHING_TRADES)[number];

export const FINISHING_TRADE_LABELS: Readonly<Record<FinishingTrade, LabelPair>> = {
  plaster:    { en: 'Plastering',        ar: 'محارة' },
  flooring:   { en: 'Flooring',          ar: 'أرضيات' },
  painting:   { en: 'Painting',          ar: 'دهانات' },
  electrical: { en: 'Electrical',        ar: 'كهرباء' },
  plumbing:   { en: 'Plumbing',          ar: 'سباكة' },
  carpentry:  { en: 'Carpentry / doors', ar: 'نجارة وأبواب' },
  aluminium:  { en: 'Aluminium / glazing', ar: 'ألوميتال وزجاج' },
  gypsum:     { en: 'Gypsum board',      ar: 'جبس بورد' },
  kitchen:    { en: 'Kitchen',           ar: 'مطبخ' },
  sanitary:   { en: 'Sanitary ware',     ar: 'أطقم حمامات' },
  hvac:       { en: 'Air conditioning',  ar: 'تكييف' },
};
export const finishingTradeLabel = labelOf(FINISHING_TRADE_LABELS);

// ── The pricing preference ─────────────────────────────────────────────────

/**
 * What the requester would LIKE, not what they must understand.
 *
 * `provider_choice` - دع المقاول يقترح طريقة التسعير - is a real answer and the
 * right default for a homeowner. Note that it is NOT the same as the field
 * being absent: "let the contractor decide" is a decision, and "nothing was
 * said" is not. Both permit any method; only one of them was chosen.
 */
export const PRICING_PREFERENCES = ['percentage', 'package', 'detailed', 'provider_choice'] as const;
export type PricingPreference = (typeof PRICING_PREFERENCES)[number];

export const PRICING_PREFERENCE_LABELS: Readonly<Record<PricingPreference, LabelPair>> = {
  percentage:      { en: 'Percentage of material cost', ar: 'نسبة من تكلفة المواد' },
  package:         { en: 'A finishing package',         ar: 'باقة تشطيب' },
  detailed:        { en: 'Detailed / itemized',         ar: 'تسعير تفصيلي' },
  provider_choice: { en: 'Let the contractor propose',  ar: 'دع المقاول يقترح طريقة التسعير' },
};
export const pricingPreferenceLabel = labelOf(PRICING_PREFERENCE_LABELS);

export const isPricingPreference = (value: unknown): value is PricingPreference =>
  typeof value === 'string' && (PRICING_PREFERENCES as readonly string[]).includes(value);

/**
 * Whether a quotation method is allowed against a stated preference.
 *
 * ABSENT AND `provider_choice` BOTH PERMIT ANYTHING. A stated method is a
 * constraint the server enforces, which is what makes stating one worth
 * anything - otherwise the preference is decoration.
 */
export function methodAllowedByPreference(
  preference: PricingPreference | Unknown | null | undefined,
  method: string,
): boolean {
  if (preference === null || preference === undefined) return true;
  if (isUnknown(preference)) return true;
  if (preference === 'provider_choice') return true;
  return preference === method;
}

// ── The brief itself ───────────────────────────────────────────────────────

/** A value a person may decline to give. */
export type Statable<T> = T | Unknown | null;

/**
 * The structured brief carried by a finishing request.
 *
 * Every field is optional and every meaningful one is `Statable`, because the
 * form is progressive: a homeowner answers what they know and publishes.
 */
export type FinishingBrief = {
  requestingParty?: Statable<RequestingParty>;
  kind?: Statable<FinishingKind>;
  propertyType?: Statable<PropertyType>;
  currentCondition?: Statable<CurrentCondition>;
  /** Square metres. A number, or UNKNOWN, or absent. */
  areaSqm?: number | Unknown | null;
  level?: Statable<FinishingLevel>;
  areas?: FinishingArea[] | null;
  trades?: FinishingTrade[] | null;
  /** Free text the requester wrote about materials or brands they want. */
  materialPreferences?: string | Unknown | null;
  /** Free text: access, working hours, lift, occupied unit, and so on. */
  siteConstraints?: string | Unknown | null;
  specialRequirements?: string | null;
  /** Their own words for the scope, always allowed alongside the structure. */
  scopeNotes?: string | null;
};

/** Every brief field a person can explicitly mark unknown, for the help engine. */
export const HELPABLE_BRIEF_FIELDS = [
  'kind', 'propertyType', 'currentCondition', 'areaSqm', 'level',
  'materialPreferences', 'siteConstraints',
] as const;
export type HelpableBriefField = (typeof HELPABLE_BRIEF_FIELDS)[number];

/**
 * The fields this person said they do not know.
 *
 * This is what makes the escape hatch more than a way to skip a question: the
 * suggestion engine reads it and offers to explain exactly these, and nothing
 * the person already answered.
 */
export function unknownFields(brief: FinishingBrief | null | undefined): HelpableBriefField[] {
  if (!brief) return [];
  return HELPABLE_BRIEF_FIELDS.filter(field => isUnknown((brief as Record<string, unknown>)[field]));
}

/**
 * The area a comparison may use, or null.
 *
 * UNKNOWN and absent both yield null, and a non-positive number does too. A
 * rate per square metre computed from an area nobody stated is exactly the
 * fabricated figure §6 of the spec forbids.
 */
export function briefArea(brief: FinishingBrief | null | undefined): number | null {
  const value = brief?.areaSqm;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * A brief never blocks publication.
 *
 * Stated as a function rather than left implicit so that a future edit adding a
 * required field has to delete this and explain itself. The request's OWN
 * requirements - title, category, market - are unchanged and still apply; this
 * says only that nothing in the brief adds to them.
 */
export function briefBlocksPublication(_brief: FinishingBrief | null | undefined): false {
  return false;
}
