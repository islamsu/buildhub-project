/**
 * ── THE PLACEMENT VOCABULARY, IN ONE PLACE ────────────────────────────────
 *
 * Commercial placements have three enums - the package sold, the surface it
 * runs on, and the kind of entity placed - and all three were printed to the
 * screen exactly as they are stored. An administrator booking a placement
 * chose between SEARCH_RESULTS_BOOST, TYPE_CATEGORY_SPOTLIGHT and
 * MASTER_DISCOVERY, and the table below the form reported BOOST and PROVIDER.
 *
 * That is a column of a database table shown to a person as though it were
 * the product's own language. It also cannot be translated: an Arabic
 * administrator got the same SCREAMING_SNAKE_CASE, so the screen was neither
 * English nor Arabic. Found by rendering the console in Arabic and comparing
 * its words with the English ones - the tokens were identical in both, which
 * is what "never translated" looks like from the outside.
 *
 * One table, both languages, used by the form, the rows and the performance
 * report, so a placement is called the same thing wherever it appears.
 *
 * THE STORED VALUE IS UNCHANGED. This is a vocabulary for reading, not a
 * rename: the enums still travel to the server exactly as before.
 */
type Lang = 'en' | 'ar';

const PACKAGES: Record<string, [string, string]> = {
  BOOST: ['Boost', 'تعزيز'],
  SPOTLIGHT: ['Spotlight', 'تسليط الضوء'],
  PREMIER: ['Premier', 'الباقة المتميزة'],
};

const SURFACES: Record<string, [string, string]> = {
  SEARCH_RESULTS_BOOST: ['Search results', 'نتائج البحث'],
  TYPE_CATEGORY_SPOTLIGHT: ['Category spotlight', 'واجهة الفئة'],
  MASTER_DISCOVERY: ['Marketplace discovery', 'استكشاف السوق'],
};

const ENTITY_TYPES: Record<string, [string, string]> = {
  PROVIDER: ['Provider', 'مورّد'],
  PRODUCT: ['Product', 'منتج'],
};

/**
 * An unknown value is shown AS IT IS STORED, not hidden behind a dash.
 *
 * A surface this table has not learned about is a gap in the table, and an
 * administrator who can see the raw token can at least say what it was. A
 * dash would report the same thing as an absent value, which is the one
 * reading that is certainly wrong.
 */
const lookup = (table: Record<string, [string, string]>, value: string | null | undefined, lang: Lang) => {
  if (value === null || value === undefined || value === '') return '—';
  return table[value]?.[lang === 'ar' ? 1 : 0] ?? value;
};

export const PLACEMENT_PACKAGES = Object.keys(PACKAGES);
export const PLACEMENT_SURFACES = Object.keys(SURFACES);
export const PLACEMENT_ENTITY_TYPES = Object.keys(ENTITY_TYPES);

export const packageLabel = (value: string | null | undefined, lang: Lang) => lookup(PACKAGES, value, lang);
export const surfaceLabel = (value: string | null | undefined, lang: Lang) => lookup(SURFACES, value, lang);
export const entityTypeLabel = (value: string | null | undefined, lang: Lang) => lookup(ENTITY_TYPES, value, lang);

/**
 * ── THE METRICS, AND THE FORMULAS UNDER THEM ──────────────────────────────
 *
 * The performance table names seven columns in both languages and then names
 * the eighth "CTR" in neither, with the three formula badges above it written
 * only in English. An Arabic administrator reading that report gets an Arabic
 * table with English arithmetic in the middle of it.
 *
 * THE DEFINITION STAYS WHERE IT IS. shared/placementAnalytics.ts holds
 * PLACEMENT_METRIC_FORMULAS deliberately, so the screen and the tests read
 * the same arithmetic and cannot drift into arguing about a number. This is
 * not a second copy of that: it is how each one READS, keyed by the same
 * names, and a test asserts that every metric defined there has a reading
 * here - so adding a metric cannot quietly leave it untranslated.
 */
const METRICS: Record<string, [string, string]> = {
  ctr: ['CTR', 'نسبة النقر'],
  viewRate: ['View rate', 'معدل المشاهدة'],
  conversionRate: ['Conversion', 'معدل التحويل'],
};

const FORMULAS: Record<string, string> = {
  ctr: 'إجراءات الدعوة ÷ مرات الظهور',
  viewRate: 'مشاهدات الجهة ÷ مرات الظهور',
  conversionRate: 'الطلبات المؤهلة المنسوبة ÷ مشاهدات الجهة',
};

export const PLACEMENT_METRICS = Object.keys(METRICS);

export const metricLabel = (key: string, lang: Lang) =>
  METRICS[key]?.[lang === 'ar' ? 1 : 0] ?? key;

/**
 * The English reading is the canonical definition itself, passed in by the
 * caller, so the badge shows exactly what the server and the tests agree on.
 * Only the Arabic reading lives here.
 */
export const formulaText = (key: string, english: string, lang: Lang) =>
  lang === 'ar' ? (FORMULAS[key] ?? english) : english;
