import type { JurisdictionCode } from '@shared/knowledgeTaxonomy';

/**
 * WHICH CODE GOVERNS, WHO PUBLISHES IT, AND WHICH EDITION - and nothing else.
 *
 * This module deliberately contains NO clause content, NO numeric requirement
 * and NO design rule. Two separate reasons, and both are firm:
 *
 *   COPYRIGHT. Building codes and standards are copyrighted works. Summarising
 *   what a code IS and citing where to obtain it is fair; reproducing its
 *   tables or clause text is not, and "the model paraphrased it" does not
 *   change that.
 *
 *   ACCURACY. A clause quoted from memory is the single most dangerous thing an
 *   assistant can produce in this domain, because it is exactly the kind of
 *   answer a person acts on without checking. A cover depth, a fire rating or a
 *   setback that is confidently wrong is worse than no answer at all - it costs
 *   a rejected inspection at best.
 *
 * So what BuildHub AI can honestly do for a regulatory question is: name the
 * governing instrument, name its publisher, state the edition it knows about
 * and when that was last checked, say whether a newer edition exists, and send
 * the person to the authority. That is genuinely useful and it is true.
 *
 * EVERY RECORD BELOW WAS VERIFIED against the publishing authority or its
 * documentation on `lastVerified`. Records are NOT invented and are NOT
 * inferred from how neighbouring countries do it.
 */

export type RegulatoryStatus =
  /** The edition the authority currently points to. */
  | 'current'
  /** Still in force, but the authority has published something newer. */
  | 'superseded-in-part'
  /** Known to exist; BuildHub has not verified its status recently enough. */
  | 'unverified';

export type RegulatoryReference = {
  id: string;
  jurisdiction: JurisdictionCode;
  /** The body that publishes and maintains it. */
  authority: string;
  authorityAr: string;
  /** The instrument's own name and designation. */
  code: string;
  codeAr: string;
  /** What it governs, in a sentence. Not a summary of its contents. */
  scope: string;
  scopeAr: string;
  edition: string;
  status: RegulatoryStatus;
  /**
   * What the reader most needs to know beyond the edition - a newer edition in
   * transition, emirate-level amendments, an official language. Facts about the
   * instrument, never facts FROM it.
   */
  note: string;
  noteAr: string;
  sourceUrl: string;
  /** When a human last checked this against the authority. ISO date. */
  lastVerified: string;
  keywords: string[];
};

export const REGULATORY_REFERENCES: readonly RegulatoryReference[] = [
  {
    id: 'sa-sbc',
    jurisdiction: 'SA',
    authority: 'Saudi Building Code National Committee',
    authorityAr: 'اللجنة الوطنية لكود البناء السعودي',
    code: 'Saudi Building Code (SBC)',
    codeAr: 'كود البناء السعودي (SBC)',
    scope: 'The umbrella code for building work in Saudi Arabia, issued as a family of parts - General (SBC 201), Construction (SBC 301-306), Electrical (SBC 401), Mechanical (SBC 501), Energy (SBC 601-602), plus fire, plumbing and green building parts.',
    scopeAr: 'الكود المظلة لأعمال البناء في السعودية، ويصدر كمجموعة أجزاء: العام (SBC 201) والإنشائي (SBC 301-306) والكهربائي (SBC 401) والميكانيكي (SBC 501) والطاقة (SBC 601-602)، إضافة إلى أجزاء الحريق والسباكة والمباني الخضراء.',
    edition: '2018 (a 2024 edition has since been issued)',
    status: 'superseded-in-part',
    note: 'The 2018 edition was developed from the 2015 International Building Code under agreement with the ICC and adapted to Saudi requirements. A 2024 edition has been issued by the committee. WHICH EDITION APPLIES TO A GIVEN PROJECT DEPENDS ON ITS PERMIT DATE AND THE AUTHORITY REVIEWING IT - confirm with the committee or the municipality before designing to either.',
    noteAr: 'طُوِّرت نسخة 2018 من الكود الدولي للبناء IBC 2015 باتفاق مع ICC ومواءمتها مع المتطلبات السعودية. وقد أصدرت اللجنة نسخة 2024. النسخة السارية على مشروع بعينه تعتمد على تاريخ الترخيص والجهة المراجعة، لذا يجب التأكد من اللجنة أو الأمانة قبل التصميم على أي منهما.',
    sourceUrl: 'https://sbc.gov.sa/',
    lastVerified: '2026-08-26',
    keywords: ['saudi building code', 'sbc', 'sbc 201', 'sbc 301', 'sbc 401', 'sbc 501', 'sbc 601', 'saudi arabia code', 'riyadh code', 'jeddah code', 'كود البناء السعودي', 'الكود السعودي'],
  },
  {
    id: 'eg-ecp-203',
    jurisdiction: 'EG',
    authority: 'Housing and Building National Research Center (HBRC), Ministry of Housing, Utilities and Urban Communities',
    authorityAr: 'المركز القومي لبحوث الإسكان والبناء، وزارة الإسكان والمرافق والمجتمعات العمرانية',
    code: 'ECP 203 - Egyptian Code for Design and Construction of Reinforced Concrete Structures',
    codeAr: 'الكود المصري ECP 203 لتصميم وتنفيذ المنشآت الخرسانية المسلحة',
    scope: 'Design and construction of reinforced and prestressed concrete structures in Egypt - materials, mixes, members, connections, foundations and seismic provisions.',
    scopeAr: 'تصميم وتنفيذ المنشآت الخرسانية المسلحة وسابقة الإجهاد في مصر: المواد والخلطات والعناصر والوصلات والأساسات والاشتراطات الزلزالية.',
    edition: '2007 (with later appendices and revisions)',
    status: 'unverified',
    note: 'THE ARABIC TEXT IS THE OFFICIAL ONE. English versions in circulation are unofficial translations and should not be relied on for compliance. BuildHub has not verified whether a later edition or revision is now in force - confirm the current edition with HBRC before designing to it.',
    noteAr: 'النص العربي هو النص الرسمي، والنسخ الإنجليزية المتداولة ترجمات غير رسمية لا يُعتمد عليها في إثبات المطابقة. لم تتحقق BuildHub من صدور نسخة أحدث، لذا يجب مراجعة المركز القومي لبحوث الإسكان والبناء لمعرفة النسخة السارية.',
    sourceUrl: 'https://www.hbrc.edu.eg/',
    lastVerified: '2026-08-26',
    keywords: ['ecp 203', 'egyptian code', 'egypt concrete code', 'hbrc', 'reinforced concrete egypt', 'الكود المصري', 'كود الخرسانة', 'ايه سي بي'],
  },
  {
    id: 'ae-fire-code',
    jurisdiction: 'AE',
    authority: 'UAE Civil Defence (Ministry of Interior), administered at emirate level - e.g. Dubai Civil Defence, Abu Dhabi Civil Defence Authority',
    authorityAr: 'الدفاع المدني بدولة الإمارات (وزارة الداخلية)، ويُطبَّق على مستوى كل إمارة - مثل الدفاع المدني بدبي وهيئة الدفاع المدني بأبوظبي',
    code: 'UAE Fire and Life Safety Code of Practice',
    codeAr: 'كود الإمارات لممارسات السلامة من الحريق وحماية الأرواح',
    scope: 'Fire and life safety for buildings in the UAE - design, approval, installation, testing and handover of fire and life safety systems.',
    scopeAr: 'السلامة من الحريق وحماية الأرواح في المباني بالإمارات: التصميم والاعتماد والتركيب والاختبار والتسليم لأنظمة السلامة.',
    edition: '2018',
    status: 'superseded-in-part',
    note: 'Applied through emirate-level Civil Defence authorities, and AMENDED LOCALLY. Abu Dhabi Civil Defence Authority formally released local amendments to the 2018 edition on 12 March 2026, consolidating 54 amendments, many previously applied case by case. The code plus the amendments applicable in YOUR emirate is what governs - confirm with the relevant Civil Defence authority.',
    noteAr: 'يُطبَّق عبر جهات الدفاع المدني في كل إمارة، ويخضع لتعديلات محلية. أصدرت هيئة الدفاع المدني بأبوظبي تعديلاتها المحلية على نسخة 2018 رسميًا في 12 مارس 2026، وتضم 54 تعديلًا كان كثير منها يُطبَّق حالة بحالة. الحاكم هو الكود مضافًا إليه تعديلات إمارتك، فيجب التأكد من جهة الدفاع المدني المختصة.',
    sourceUrl: 'https://www.dcd.gov.ae/portal/en/preventive-safety/rules-regulations/uae-fire-and-life-safety-code-of-practice.jsp',
    lastVerified: '2026-08-26',
    keywords: ['uae fire code', 'fire and life safety', 'civil defence', 'dcd', 'adcda', 'dubai fire code', 'abu dhabi fire code', 'كود الحريق', 'الدفاع المدني', 'السلامة من الحريق'],
  },
];

/** Regulatory records whose keywords match, scored the same way as documents. */
export function findRegulatory(question: string, jurisdiction?: JurisdictionCode): RegulatoryReference[] {
  const text = question.toLowerCase();
  return REGULATORY_REFERENCES.filter(reference => {
    if (jurisdiction && reference.jurisdiction !== jurisdiction) return false;
    return reference.keywords.some(keyword => text.includes(keyword.toLowerCase()));
  });
}

/**
 * Jurisdictions BuildHub has verified regulatory records for. Everything else
 * in JURISDICTIONS is a supported market with NO regulatory coverage yet, and
 * the assistant is told to say so rather than reason by analogy from a
 * neighbouring country - which is how a Qatari project ends up designed to a
 * Saudi code.
 */
export const COVERED_JURISDICTIONS: readonly JurisdictionCode[] =
  REGULATORY_REFERENCES.map(reference => reference.jurisdiction)
    .filter((code, index, all) => all.indexOf(code) === index);

export function formatRegulatoryForModel(matches: RegulatoryReference[], lang: 'en' | 'ar'): string {
  if (matches.length === 0) return '';

  const blocks = matches.map(reference => {
    const authority = lang === 'ar' ? reference.authorityAr : reference.authority;
    const code = lang === 'ar' ? reference.codeAr : reference.code;
    const scope = lang === 'ar' ? reference.scopeAr : reference.scope;
    const note = lang === 'ar' ? reference.noteAr : reference.note;
    return `--- ${code}
  jurisdiction: ${reference.jurisdiction}
  authority: ${authority}
  scope: ${scope}
  edition BuildHub has on record: ${reference.edition}
  status: ${reference.status}
  what matters about it: ${note}
  official source: ${reference.sourceUrl}
  BuildHub last verified this: ${reference.lastVerified}`;
  }).join('\n\n');

  return `=== REGULATORY REFERENCE (BuildHub, authority tier 2-3) ===
These are POINTERS TO INSTRUMENTS, not their contents. BuildHub holds no clause
text, no table and no numeric requirement from any code, so you have none
either.

HOW TO USE THIS:
  - Name the governing code, its publisher and the edition on record, and give
    the official source so the person can obtain it.
  - STATE THE EDITION AND ITS STATUS EXPLICITLY. Where a newer edition exists
    or local amendments apply, say so - presenting a superseded edition as
    current is a serious error, not a rounding of detail.
  - DO NOT quote, paraphrase or reconstruct any clause, table, dimension,
    rating, cover, spacing or setback from a code. If you find yourself about
    to state a specific regulatory number, stop and say that the requirement
    must be read from the code itself or confirmed with the authority.
  - You may still give general engineering guidance - clearly labelled as
    general practice, NOT as the code's requirement.
  - If the person has not said which country the project is in, ASK. The answer
    changes with the jurisdiction and guessing it is worse than a question.

${blocks}
=== END REGULATORY REFERENCE ===`;
}
