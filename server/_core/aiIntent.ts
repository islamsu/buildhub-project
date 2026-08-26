import { PROVIDER_ROLES } from '../vendorDirectory';

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
};

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

  return {
    wantsProviderRecommendation,
    wantsCurrentInformation,
    role: wantsProviderRecommendation ? role : undefined,
    category: wantsProviderRecommendation ? extractCategory(text) : undefined,
    location: wantsProviderRecommendation ? extractLocation(question) : undefined,
  };
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
