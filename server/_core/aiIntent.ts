import { PROVIDER_ROLES } from '../vendorDirectory';
import type { JurisdictionCode } from '@shared/knowledgeTaxonomy';

/**
 * Which sources a question needs, decided in code rather than by the model.
 *
 * WHY NOT ASK THE MODEL. Routing decides whether BuildHub's database gets
 * queried and whether a paid web search runs. A model deciding that is a model
 * deciding when to spend money and when to reach for live data, non
 * deterministically, on every request. This is a small, boring, testable
 * classifier instead - and when it is unsure it prefers the cheap, safe branch.
 *
 * It deliberately does NOT try to be clever. It detects the two cases where
 * getting it wrong is expensive:
 *   - a provider recommendation, where answering from general knowledge would
 *     mean inventing companies;
 *   - a time-sensitive question, where answering from model memory would mean
 *     confidently quoting a stale price or a superseded code edition.
 * Everything else falls through to the knowledge briefing plus the model's own
 * construction expertise, which costs nothing extra.
 */

export type AiIntent = {
  wantsProviderRecommendation: boolean;
  wantsCurrentInformation: boolean;
  role?: string;
  category?: string;
  location?: string;
  /**
   * Qualifiers the person clearly asked for that BuildHub could NOT map to its
   * own vocabulary - an unlisted trade, an unserved city.
   *
   * This exists because of a real answer on staging. "I need a swimming pool
   * specialist contractor in Aswan" parses to role=contractor and nothing else:
   * "swimming pool" is not a BuildHub category and Aswan is not a served city,
   * so both are silently dropped. The search then succeeds on role alone and
   * reports matchQuality 'exact', because from its own point of view every
   * criterion it knew about was satisfied - and a generic contractor gets
   * presented as a match for a highly specific request.
   *
   * Nothing was fabricated and no ranking was wrong. The FRAMING was wrong, and
   * the fix is to carry the dropped terms forward so the answer can say what it
   * actually matched on.
   */
  unmappedQualifiers: string[];
  /**
   * The person is looking for WORK, not for a provider.
   *
   * Kept separate from wantsProviderRecommendation because they are opposite
   * sides of the same marketplace and answering one with the other is the
   * obvious failure: a contractor asking "find me finishing jobs in Cairo"
   * must not be handed a list of finishing contractors, who are their
   * competitors. The role check that gates this lives in the opportunity
   * engine, not here - this only reads the question.
   */
  wantsOpportunities: boolean;
  /**
   * The jurisdiction the QUESTION is about, when it names one.
   *
   * Deliberately read from the question and never from the user's account. A
   * Saudi question asked by an Egyptian customer is a Saudi question; ranking
   * regulatory content by where someone signed up would answer it with the
   * wrong country's code, which is the specific mistake the regulatory layer
   * exists to prevent.
   */
  jurisdiction?: JurisdictionCode;
};

/**
 * Asking for WORK. Deliberately requires a work noun - "find me projects",
 * "which RFQs" - rather than treating any "find me" as an opportunity search,
 * because "find me a contractor" is the recommendation case and shares the verb.
 */
const OPPORTUNITY_PATTERNS = [
  // "find me finishing projects", "show available fit-out work" - the verb and
  // the work-noun with anything in between. A fixed substring list missed
  // exactly this: an adjective between them is the normal way to ask.
  /\b(find|show|get|list|search)\b[^.?!]{0,40}?\b(work|jobs?|projects?|opportunit(y|ies)|rfqs?|tenders?|leads?)\b/i,
  /\b(rfqs?|projects?|jobs?|opportunit(y|ies)|leads?)\b[^.?!]{0,40}?\b(for me|need my|match my|suit my|available)\b/i,
  /\b(available|open)\b[^.?!]{0,20}?\b(work|jobs?|projects?|rfqs?|tenders?)\b/i,
];

const OPPORTUNITY_CUES = [
  'find work', 'find me work', 'find jobs', 'find me jobs', 'find projects',
  'find me projects', 'find opportunities', 'find me opportunities',
  'new opportunities', 'available work', 'available projects', 'available rfq',
  'open rfq', 'which rfq', 'what rfq', 'rfqs need', 'rfqs match', 'match my products',
  'need my products', 'bid on', 'tender', 'leads for me', 'any leads',
  'فرص', 'فرص عمل', 'مشاريع متاحة', 'طلبات عروض', 'أعمال متاحة', 'مناقصات',
];

const RECOMMENDATION_CUES = [
  'recommend', 'suggestion', 'suggest', 'find me', 'looking for', 'who can',
  'best company', 'which company', 'which provider', 'which vendor',
  'which supplier', 'which contractor', 'which engineer', 'should i use',
  'can you find', 'shortlist',
  // Asking who is ON the platform is a directory question, which is exactly a
  // recommendation request phrased as availability. Without these, "who is on
  // BuildHub?" never reached the directory and the model answered from its own
  // limits - "I cannot access BuildHub's vendor directory" - which is a worse
  // answer than the true one BuildHub can actually produce.
  'who is on', 'who are on', 'who do you have', 'do you have any',
  'anyone on buildhub', 'listed on buildhub',
  'من لديكم', 'هل لديكم', 'مين عندكم', 'المسجلين على',
  'أرشح', 'اقترح', 'رشح', 'أبحث عن', 'من يستطيع', 'أفضل شركة', 'أي شركة',
  'من تنصح', 'أحتاج مورد', 'أحتاج مقاول',
];

/**
 * Stating a NEED for a provider - "I need a contractor", "أحتاج مهندس".
 *
 * Deliberately NOT matched anywhere in the sentence. "I need a cost estimate
 * for finishing works, and what does a contractor usually charge?" states a
 * need and names a role, but is a pricing question: routing it to the directory
 * would answer "BuildHub has no listed contractor" to someone who asked about
 * costs. So the need must sit CLOSE TO the role word to count - which is how
 * the two relate when the sentence really is "I need one of these".
 */
const DEMAND_CUES = [
  'need', 'want', 'hiring', 'hire', 'searching for', 'in search of',
  'أحتاج', 'أريد', 'محتاج', 'عايز', 'ابحث عن', 'أبحث عن',
];

/** How far before the role word a demand cue may sit and still be about it. */
const DEMAND_WINDOW = 45;

/**
 * Words that mean "a company that does the work", mapped to the provider role
 * BuildHub actually stores. Arabic included because the Arabic site is a
 * first-class surface, not a translation of the English one.
 */
const ROLE_CUES: Record<string, string> = {
  contractor: 'contractor', contracting: 'contractor', builder: 'contractor',
  'مقاول': 'contractor', 'مقاولات': 'contractor',
  engineer: 'engineer', engineering: 'engineer', 'مهندس': 'engineer',
  architect: 'architect', architectural: 'architect', 'معماري': 'architect', 'معمارى': 'architect',
  supplier: 'supplier', vendor: 'supplier', 'مورد': 'supplier', 'موردين': 'supplier',
  'project manager': 'project_manager', 'مدير مشروع': 'project_manager',
  designer: 'architect', 'interior designer': 'architect', 'مصمم': 'architect',
};

/**
 * Explicitly temporal. These fire REGARDLESS of the timeless guard, because
 * "what is the current price of cement" is a "what is" question about a number
 * that moves weekly - exactly the case where model memory is most confidently
 * wrong.
 */
const EXPLICIT_CURRENCY_CUES = [
  'current price', 'latest', 'right now', 'currently', 'today', 'this year',
  'market price', 'newest edition', 'most recent', 'up to date', 'up-to-date',
  'السعر الحالي', 'أحدث', 'حالياً', 'حاليا', 'سعر السوق', 'اليوم',
];

/**
 * Weaker hints. "price of" appears in plenty of timeless questions - "how is
 * the price of concrete calculated" - so these defer to the guard below.
 */
const WEAK_CURRENCY_CUES = ['price of', 'cost of', 'prices', 'أسعار', 'سعر'];

/** Static concepts that read as time-sensitive but are not. */
const TIMELESS_GUARD = [
  'what is a', 'what is the difference', 'how do i calculate', 'how is', 'define',
  'ما هو', 'ما الفرق', 'كيف أحسب',
];

const includesAny = (haystack: string, needles: string[]): boolean =>
  needles.some(needle => haystack.includes(needle));

/**
 * Is the role word being ASKED FOR, rather than merely mentioned? True when a
 * demand cue ends within DEMAND_WINDOW characters before the role word.
 */
function demandsRole(text: string, roleIndex: number): boolean {
  if (roleIndex < 0) return false;
  const window = text.slice(Math.max(0, roleIndex - DEMAND_WINDOW), roleIndex);
  return includesAny(window, DEMAND_CUES);
}

export function detectIntent(question: string): AiIntent {
  const text = question.toLowerCase();

  const roleEntry = Object.entries(ROLE_CUES).find(([cue]) => text.includes(cue));
  const role = roleEntry?.[1];
  const roleIndex = roleEntry ? text.indexOf(roleEntry[0]) : -1;

  // A recommendation needs BOTH an asking cue and something to be recommended.
  // "What does a contractor do?" names a role but is not a request for one.
  const wantsProviderRecommendation = Boolean(role)
    && (includesAny(text, RECOMMENDATION_CUES) || demandsRole(text, roleIndex));

  const wantsCurrentInformation =
    includesAny(text, EXPLICIT_CURRENCY_CUES) ||
    (includesAny(text, WEAK_CURRENCY_CUES) && !includesAny(text, TIMELESS_GUARD));

  const wantsOpportunities = includesAny(text, OPPORTUNITY_CUES)
    || OPPORTUNITY_PATTERNS.some(pattern => pattern.test(question));

  // Category and location are extracted for EITHER branch. An opportunity
  // search filters on the same two things a recommendation does; extracting
  // them only for recommendations would leave "find me finishing work in
  // Cairo" unfiltered on both.
  const wantsMarketplaceSearch = wantsProviderRecommendation || wantsOpportunities;
  const category = wantsMarketplaceSearch ? extractCategory(text) : undefined;
  const location = wantsMarketplaceSearch ? extractLocation(question) : undefined;

  return {
    wantsProviderRecommendation,
    wantsOpportunities,
    wantsCurrentInformation,
    role: wantsProviderRecommendation ? role : undefined,
    category,
    location,
    unmappedQualifiers: wantsProviderRecommendation
      ? unmappedQualifiers(question, { category, location })
      : [],
    jurisdiction: extractJurisdiction(question),
  };
}

/**
 * Countries and their major cities, mapped to the jurisdiction code. Cities are
 * included because "is a permit needed in Jeddah" names a jurisdiction without
 * naming a country - and a regulatory answer that ignores that is answering a
 * different question.
 */
const JURISDICTION_CUES: Array<[RegExp, JurisdictionCode]> = [
  [/\begypt\b|\begyptian\b|\bcairo\b|\bgiza\b|\balexandria\b|مصر|القاهرة|الجيزة|الإسكندرية/i, 'EG'],
  [/\bsaudi\b|\bksa\b|\briyadh\b|\bjeddah\b|\bdammam\b|السعودية|الرياض|جدة|الدمام/i, 'SA'],
  [/\buae\b|\bemirates\b|\bdubai\b|\babu dhabi\b|\bsharjah\b|الإمارات|دبي|أبوظبي|ابوظبي|الشارقة/i, 'AE'],
  [/\bqatar\b|\bdoha\b|قطر|الدوحة/i, 'QA'],
  [/\bkuwait\b|الكويت/i, 'KW'],
  [/\bbahrain\b|\bmanama\b|البحرين|المنامة/i, 'BH'],
  [/\boman\b|\bmuscat\b|عُمان|عمان\s|مسقط/i, 'OM'],
  [/\bjordan\b|\bamman\b|الأردن/i, 'JO'],
];

export function extractJurisdiction(question: string): JurisdictionCode | undefined {
  return JURISDICTION_CUES.find(([pattern]) => pattern.test(question))?.[1];
}

/**
 * A place name the question names that BuildHub does not serve.
 *
 * Matched conservatively - "in <Capitalised Word>" and the Arabic "في <word>" -
 * because the cost of a false positive is only a slightly over-cautious
 * sentence, while the cost of a false negative is the silent-drop behaviour
 * this whole field exists to fix.
 */
const PLACE_PHRASE = /\b(?:in|near)\s+([A-Z][a-z]{2,})\b/;
const PLACE_PHRASE_AR = /\bفي\s+([\u0600-\u06FF]{3,})/;

/** Words that follow "in" but are not places, so they are never reported as one. */
const NOT_A_PLACE = new Set([
  'the', 'this', 'that', 'my', 'our', 'general', 'total', 'egypt', 'saudi',
  'order', 'time', 'cash', 'advance', 'fact', 'writing', 'person',
]);

function unmappedQualifiers(
  question: string,
  mapped: { category?: string; location?: string },
): string[] {
  const found: string[] = [];

  if (!mapped.location) {
    const place = PLACE_PHRASE.exec(question)?.[1] ?? PLACE_PHRASE_AR.exec(question)?.[1];
    if (place && !NOT_A_PLACE.has(place.toLowerCase())) found.push(place);
  }

  // No recognised trade at all. Said plainly rather than guessed: BuildHub
  // filters on categories its vendors actually declare, and inventing one to
  // look responsive would filter real providers out of the search.
  if (!mapped.category) found.push('the specific trade asked for');

  return found;
}

/**
 * The trade being asked for, when one is named. Matched against the service
 * vocabulary BuildHub vendors actually declare, so an unrecognised word yields
 * NO category rather than a guessed one - the search then broadens honestly
 * instead of filtering on something invented.
 */
const CATEGORY_CUES: Record<string, string> = {
  waterproofing: 'waterproofing', 'عزل': 'waterproofing',
  finishing: 'finishing', 'تشطيب': 'finishing', 'تشطيبات': 'finishing',
  electrical: 'electrical', 'كهرباء': 'electrical',
  plumbing: 'plumbing', 'سباكة': 'plumbing',
  hvac: 'hvac', 'تكييف': 'hvac',
  painting: 'painting', 'دهان': 'painting', 'دهانات': 'painting',
  flooring: 'flooring', 'أرضيات': 'flooring',
  joinery: 'joinery', 'نجارة': 'joinery',
  aluminium: 'aluminium', 'ألمنيوم': 'aluminium',
  concrete: 'concrete', 'خرسانة': 'concrete',
  steel: 'steel', 'حديد': 'steel',
  roofing: 'roofing', 'أسقف': 'roofing',
  landscaping: 'landscaping', 'تنسيق حدائق': 'landscaping',
};

export function extractCategory(text: string): string | undefined {
  return Object.entries(CATEGORY_CUES).find(([cue]) => text.includes(cue))?.[1];
}

/**
 * A city, when one is named from the list BuildHub actually serves.
 *
 * Deliberately NOT a general place-name parser. Guessing a location wrongly
 * filters real providers out of a search, which is worse than not filtering at
 * all - so an unrecognised place yields undefined and the search stays wide.
 */
const CITIES: Array<[RegExp, string]> = [
  [/\bcairo\b|القاهرة/i, 'Cairo'],
  [/\bgiza\b|الجيزة/i, 'Giza'],
  [/\balexandria\b|الإسكندرية|الاسكندرية/i, 'Alexandria'],
  [/\briyadh\b|الرياض/i, 'Riyadh'],
  [/\bjeddah\b|جدة/i, 'Jeddah'],
  [/\bdammam\b|الدمام/i, 'Dammam'],
  [/\bdubai\b|دبي/i, 'Dubai'],
  [/\babu dhabi\b|أبوظبي|ابوظبي/i, 'Abu Dhabi'],
  [/\bdoha\b|الدوحة/i, 'Doha'],
  [/\bkuwait\b|الكويت/i, 'Kuwait'],
  [/\bmanama\b|المنامة/i, 'Manama'],
  [/\bmuscat\b|مسقط/i, 'Muscat'],
  [/\bamman\b|عمان/i, 'Amman'],
];

export function extractLocation(question: string): string | undefined {
  return CITIES.find(([pattern]) => pattern.test(question))?.[1];
}

export const KNOWN_PROVIDER_ROLES = PROVIDER_ROLES;
