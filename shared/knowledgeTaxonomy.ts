/**
 * The BuildHub knowledge taxonomy and its authority model.
 *
 * TWO THINGS LIVE HERE and nothing else: what a knowledge document may be
 * ABOUT, and how much weight it carries when documents disagree. The documents
 * themselves are in server/knowledge/.
 */

/**
 * Source authority, highest first. When two documents conflict, the lower
 * number wins - and the retrieval layer says so rather than silently dropping
 * the loser, because a conflict between a regulator and a trade blog is worth
 * surfacing.
 *
 * Tier 1 is BuildHub itself and is deliberately above every external source:
 * no standards body can tell you what BuildHub's RFQ rules are.
 */
export const AUTHORITY_TIERS = {
  1: 'BuildHub official product and business rules',
  2: 'Government and regulatory authorities',
  3: 'Building codes and standards organisations',
  4: 'Recognised professional institutions',
  5: 'Manufacturer and technical documentation',
  6: 'Reputable industry sources',
  7: 'General model knowledge',
} as const;

export type AuthorityLevel = keyof typeof AUTHORITY_TIERS;

export type SourceType =
  | 'buildhub-source-of-truth'
  | 'regulator'
  | 'standard'
  | 'professional-body'
  | 'manufacturer'
  | 'industry'
  | 'synthesised';

/**
 * Domains. Numbered so a document's domain is stable when the list is
 * reordered, and so a gap in coverage is countable rather than a feeling.
 *
 * COVERAGE IS NOT IMPLIED BY THIS LIST. A domain appearing here means the
 * taxonomy has a slot for it, not that BuildHub holds authoritative content
 * about it. server/_core/knowledgeRetrieval.ts reports which domains actually
 * have documents, and the assistant is told to say so when a domain is empty.
 */
export const KNOWLEDGE_DOMAINS = {
  1: 'Architecture', 2: 'Structural Engineering', 3: 'Civil Engineering',
  4: 'Construction Fundamentals', 5: 'Building Materials', 6: 'Concrete',
  7: 'Steel', 8: 'Masonry', 9: 'Foundations', 10: 'Earthworks',
  11: 'Roofing', 12: 'Waterproofing', 13: 'Insulation', 14: 'Flooring',
  15: 'Walls', 16: 'Paints and Coatings', 17: 'Ceilings', 18: 'Partitions',
  19: 'Doors and Windows', 20: 'Aluminium and Glass', 21: 'Joinery and Woodwork',
  22: 'Kitchens', 23: 'Bathrooms and Sanitaryware', 24: 'Lighting',
  25: 'Electrical', 26: 'Plumbing', 27: 'Drainage', 28: 'HVAC',
  29: 'Fire Protection', 30: 'Fire Alarm', 31: 'ELV and Low Voltage',
  32: 'Solar and Energy', 33: 'BMS and Smart Buildings', 34: 'Quantity Surveying',
  35: 'BOQ and Takeoff', 36: 'Cost Estimation', 37: 'Rate Analysis',
  38: 'Labour and Productivity', 39: 'Procurement', 40: 'Tendering, RFQ and RFP',
  41: 'Supplier Evaluation', 42: 'Contractor Evaluation', 43: 'Project Management',
  44: 'Scheduling', 45: 'Cost Control', 46: 'Risk Management', 47: 'QA and QC',
  48: 'Inspection and Testing', 49: 'Method Statements', 50: 'Safety',
  51: 'Contracts', 52: 'Claims and Variations', 53: 'Handover and Commissioning',
  54: 'Maintenance', 55: 'Renovation', 56: 'Fit-Out', 57: 'BIM',
  58: 'Digital Construction', 59: 'Sustainability', 60: 'Real Estate and Development',
  61: 'Construction Finance', 62: 'Construction Technology',
  63: 'Construction Terminology', 64: 'Arabic-English Construction Dictionary',
  65: 'Jurisdiction and Regulation', 66: 'Manufacturer and Product Knowledge',
  67: 'BuildHub Platform Knowledge', 68: 'Marketplace Knowledge',
  69: 'Recommendation Intelligence', 70: 'AI Evaluation and Tricky Questions',
} as const;

export type DomainId = keyof typeof KNOWLEDGE_DOMAINS;

export const JURISDICTIONS = {
  EG: 'Egypt', SA: 'Saudi Arabia', AE: 'United Arab Emirates', QA: 'Qatar',
  KW: 'Kuwait', BH: 'Bahrain', OM: 'Oman', JO: 'Jordan',
  GLOBAL: 'Not jurisdiction-specific',
} as const;

export type JurisdictionCode = keyof typeof JURISDICTIONS;

export type KnowledgeStatus = 'current' | 'under-review' | 'superseded';

/**
 * Metadata carried by every document.
 *
 * Every field here is READ by something - retrieval scoring, conflict
 * resolution, or the staleness report. None of it exists for appearance. If a
 * field stopped being used it should be deleted rather than kept for the look
 * of rigour.
 */
export type KnowledgeMetadata = {
  knowledgeId: string;
  domain: DomainId;
  subcategory?: string;
  topic: string;
  /** Retrieval matches on these. Include the words a person would actually type. */
  keywords: string[];
  jurisdiction: JurisdictionCode;
  language: 'en' | 'ar' | 'bilingual';
  authorityLevel: AuthorityLevel;
  sourceType: SourceType;
  sourceName: string;
  sourceUrl?: string;
  publicationDate?: string;
  effectiveDate?: string;
  /** When this should be re-checked. Past this date the retrieval layer flags it. */
  reviewDate: string;
  status: KnowledgeStatus;
  version: string;
  buildhubSpecific: boolean;
  /** True when the content moves faster than the review cycle - prices, code editions. */
  dynamic: boolean;
  relatedTopics?: string[];
};

export type KnowledgeDocument = KnowledgeMetadata & {
  /** English body. Substantive prose, not a stub. */
  en: string;
  /** Arabic body. The SAME facts - a translation, never a second knowledge base. */
  ar: string;
};

export const isStale = (document: KnowledgeMetadata, now: Date): boolean =>
  new Date(document.reviewDate) < now;
