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
  /**
   * The edition BuildHub has on record, or UNDEFINED when BuildHub has not
   * established it.
   *
   * Optional on purpose. For several markets the publishing authority is
   * verifiable and the current edition is not, and the honest record says so -
   * "the Kuwait Fire Force sets fire requirements, confirm the current edition
   * with them" is useful and true, whereas naming an edition to fill the field
   * would be the exact failure this module exists to prevent.
   */
  edition?: string;
  /** When the edition on record was published, where BuildHub established it. */
  publicationDate?: string;
  /** When it came into force, where BuildHub established it. */
  effectiveDate?: string;
  /** The instrument that replaced this one, where one is known. */
  supersededBy?: string;
  /** When this record should be re-checked against the authority. */
  reviewDate: string;
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
    publicationDate: '2018',
    supersededBy: 'Saudi Building Code 2024 edition',
    reviewDate: '2027-02-01',
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
    publicationDate: '2007',
    reviewDate: '2027-02-01',
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
    publicationDate: '2018-09',
    supersededBy: 'Emirate-level amendments - Abu Dhabi Civil Defence consolidated 54 on 12 March 2026',
    reviewDate: '2027-02-01',
    status: 'superseded-in-part',
    note: 'Applied through emirate-level Civil Defence authorities, and AMENDED LOCALLY. Abu Dhabi Civil Defence Authority formally released local amendments to the 2018 edition on 12 March 2026, consolidating 54 amendments, many previously applied case by case. The code plus the amendments applicable in YOUR emirate is what governs - confirm with the relevant Civil Defence authority.',
    noteAr: 'يُطبَّق عبر جهات الدفاع المدني في كل إمارة، ويخضع لتعديلات محلية. أصدرت هيئة الدفاع المدني بأبوظبي تعديلاتها المحلية على نسخة 2018 رسميًا في 12 مارس 2026، وتضم 54 تعديلًا كان كثير منها يُطبَّق حالة بحالة. الحاكم هو الكود مضافًا إليه تعديلات إمارتك، فيجب التأكد من جهة الدفاع المدني المختصة.',
    sourceUrl: 'https://www.dcd.gov.ae/portal/en/preventive-safety/rules-regulations/uae-fire-and-life-safety-code-of-practice.jsp',
    lastVerified: '2026-08-26',
    keywords: ['uae fire code', 'fire and life safety', 'civil defence', 'dcd', 'adcda', 'dubai fire code', 'abu dhabi fire code', 'كود الحريق', 'الدفاع المدني', 'السلامة من الحريق'],
  },
  {
    id: 'qa-qcs',
    jurisdiction: 'QA',
    authority: 'Ashghal - Public Works Authority, with Qatari ministries and authorities',
    authorityAr: 'أشغال - هيئة الأشغال العامة، بمشاركة وزارات وجهات قطرية',
    code: 'Qatar Construction Specifications (QCS)',
    codeAr: 'المواصفات القطرية للإنشاءات (QCS)',
    scope: 'The construction specification used on Qatari projects - general requirements, quality assurance, ground investigation, foundations, concrete, roadworks, drainage, mechanical and electrical, instrumentation, and health and safety.',
    scopeAr: 'المواصفة الإنشائية المعتمدة في مشاريع قطر: المتطلبات العامة وتوكيد الجودة وجسّ التربة والأساسات والخرسانة وأعمال الطرق والصرف والأعمال الميكانيكية والكهربائية والقياس والصحة والسلامة.',
    edition: '2014 (Revision IV), which replaced QCS 2010',
    publicationDate: '2014-10',
    reviewDate: '2027-02-01',
    status: 'superseded-in-part',
    note: 'AMENDED CONTINUOUSLY. Ashghal issues Interim Advice Notes (IANs) that supplement and amend QCS 2014 and take effect on Ashghal projects, so the specification plus the IANs current for your project is what governs - not the bound 2014 document alone. Check the Ashghal library for the IANs in force before designing to it.',
    noteAr: 'يخضع لتعديل مستمر. تصدر أشغال إشعارات إرشادية مؤقتة (IANs) تكمّل وتعدّل QCS 2014 وتسري على مشاريعها، فالحاكم هو المواصفة مضافًا إليها الإشعارات السارية على مشروعك، وليس وثيقة 2014 وحدها. راجع مكتبة أشغال للإشعارات النافذة قبل التصميم عليها.',
    sourceUrl: 'https://www.ashghal.gov.qa/',
    lastVerified: '2026-08-27',
    keywords: ['qcs', 'qatar construction specifications', 'ashghal', 'qatar code', 'doha construction', 'المواصفات القطرية', 'أشغال', 'قطر'],
  },
  {
    id: 'kw-authorities',
    jurisdiction: 'KW',
    authority: 'Kuwait Municipality (building regulation) and Kuwait Fire Force (fire and life safety)',
    authorityAr: 'بلدية الكويت (تنظيم البناء) والإدارة العامة للإطفاء (السلامة من الحريق وحماية الأرواح)',
    code: 'Kuwaiti building regulation and Kuwait Fire Force fire safety requirements',
    codeAr: 'أنظمة البناء الكويتية ومتطلبات السلامة من الحريق الصادرة عن الإطفاء',
    scope: 'Building permitting and construction regulation in Kuwait, and mandatory fire protection and life safety requirements for buildings - design, approval, inspection and compliance.',
    scopeAr: 'تراخيص البناء وتنظيم الإنشاء في الكويت، ومتطلبات الحماية من الحريق وحماية الأرواح الإلزامية للمباني: التصميم والاعتماد والتفتيش والمطابقة.',
    // No edition claimed. BuildHub has verified WHO regulates; it has not
    // established which edition is in force, and inventing one is worse than
    // naming the authority and stopping.
    reviewDate: '2027-02-01',
    status: 'unverified',
    note: 'BUILDHUB HAS NOT ESTABLISHED THE CURRENT EDITION for Kuwait and does not claim one. What is verified is who regulates: Kuwait Municipality for building permitting and the Kuwait Fire Force for fire and life safety. Obtain the current requirements from those authorities directly - do not rely on a neighbouring country\'s code.',
    noteAr: 'لم تتحقق BuildHub من النسخة السارية في الكويت ولا تدّعي معرفتها. المؤكَّد هو الجهة المنظِّمة: بلدية الكويت لتراخيص البناء، والإدارة العامة للإطفاء للسلامة من الحريق وحماية الأرواح. احصل على المتطلبات السارية من هاتين الجهتين مباشرة، ولا تعتمد على كود دولة مجاورة.',
    sourceUrl: 'https://e.gov.kw/sites/kgoenglish/Pages/Services/FireDep/KuwaitFireForceServicesManual.aspx',
    lastVerified: '2026-08-27',
    keywords: ['kuwait building', 'kuwait fire', 'kuwait municipality', 'kuwait fire force', 'kff', 'kuwait code', 'الكويت', 'بلدية الكويت', 'الإطفاء'],
  },
  {
    id: 'bh-standard-specs',
    jurisdiction: 'BH',
    authority: 'Ministry of Works, Municipalities Affairs and Urban Planning',
    authorityAr: 'وزارة الأشغال وشؤون البلديات والتخطيط العمراني',
    code: 'Standard Specifications for Construction Works, and the Unified Guidebook of Building Permit Regulations',
    codeAr: 'المواصفات القياسية لأعمال الإنشاء، والدليل الموحد لاشتراطات تراخيص البناء',
    scope: 'Construction specification for works in Bahrain, alongside the permit guidebook that consolidates what the concerned government entities require before a building permit is issued.',
    scopeAr: 'المواصفة القياسية لأعمال الإنشاء في البحرين، إلى جانب الدليل الذي يجمع اشتراطات الجهات الحكومية المعنية قبل إصدار رخصة البناء.',
    edition: 'Standard Specifications 2nd edition (2019); Unified Guidebook v1.1 (2019)',
    publicationDate: '2019',
    reviewDate: '2027-02-01',
    status: 'unverified',
    note: 'The 2019 editions are what BuildHub has on record. BuildHub has NOT confirmed whether a later edition has been issued since, and the guidebook is explicitly updated as entity requirements change - confirm the current version with the Ministry before relying on either.',
    noteAr: 'نسختا 2019 هما ما لدى BuildHub. ولم تتأكد BuildHub من صدور نسخة أحدث، كما أن الدليل يُحدَّث كلما تغيّرت اشتراطات الجهات؛ فتأكد من النسخة السارية لدى الوزارة قبل الاعتماد على أي منهما.',
    sourceUrl: 'https://www.works.gov.bh/English/Publications/standards/Pages/standardone.aspx',
    lastVerified: '2026-08-27',
    keywords: ['bahrain', 'ministry of works bahrain', 'standard specifications', 'building permit bahrain', 'manama', 'البحرين', 'وزارة الأشغال', 'المنامة'],
  },
  {
    id: 'om-muscat-building',
    jurisdiction: 'OM',
    authority: 'Muscat Municipality, with the Ministry of Housing and Urban Planning',
    authorityAr: 'بلدية مسقط، مع وزارة الإسكان والتخطيط العمراني',
    code: 'Muscat Building Regulations (Local Order 23/92) and Ministry building requirements',
    codeAr: 'نظام المباني بمسقط (الأمر المحلي 23/92) واشتراطات البناء الصادرة عن الوزارة',
    scope: 'Building permitting and construction regulation within Muscat, alongside the building requirements and construction guidelines issued at ministry level.',
    scopeAr: 'تراخيص البناء وتنظيم الإنشاء داخل مسقط، إلى جانب اشتراطات البناء وأدلة التنفيذ الصادرة على مستوى الوزارة.',
    edition: 'Local Order 23/92',
    publicationDate: '1992',
    reviewDate: '2027-02-01',
    status: 'unverified',
    note: 'REGULATION IS LOCAL IN OMAN. Muscat Municipality regulates within Muscat; other governorates have their own municipal authorities, so a Muscat rule is not an Omani rule. Local Order 23/92 is long-standing and BuildHub has not confirmed which amendments are in force - confirm with the relevant municipality for your governorate.',
    noteAr: 'التنظيم في عُمان محلي. تنظّم بلدية مسقط داخل مسقط، ولكل محافظة أخرى جهتها البلدية، فما يسري في مسقط ليس بالضرورة ساريًا في عموم السلطنة. والأمر المحلي 23/92 قديم ولم تتأكد BuildHub من التعديلات النافذة عليه، فراجع بلدية محافظتك.',
    sourceUrl: 'https://www.mm.gov.om/',
    lastVerified: '2026-08-27',
    keywords: ['oman', 'muscat', 'muscat municipality', 'local order 23/92', 'oman building', 'عُمان', 'مسقط', 'بلدية مسقط'],
  },
  {
    id: 'jo-national-codes',
    jurisdiction: 'JO',
    authority: 'Jordanian National Building Council, Ministry of Public Works and Housing, assisted by the Royal Scientific Society',
    authorityAr: 'مجلس البناء الوطني الأردني، وزارة الأشغال العامة والإسكان، بمساندة الجمعية العلمية الملكية',
    code: 'Jordan National Building Codes',
    codeAr: 'كودات البناء الوطنية الأردنية',
    scope: 'A family of national codes covering structural, mechanical, electrical, safety, insulation and energy-efficiency requirements for building work in Jordan.',
    scopeAr: 'مجموعة كودات وطنية تغطي الاشتراطات الإنشائية والميكانيكية والكهربائية والسلامة والعزل وكفاءة الطاقة لأعمال البناء في الأردن.',
    reviewDate: '2027-02-01',
    status: 'unverified',
    note: 'ISSUED AS A FAMILY, NOT ONE DOCUMENT, and the individual codes are revised on their own timetables - so "the Jordanian code" has no single edition and asking which code and which edition is the right first question. BuildHub has verified the issuing bodies only. Confirm the applicable code and its current edition with the National Building Council.',
    noteAr: 'تصدر ككودات متعددة لا كوثيقة واحدة، ويُحدَّث كل كود وفق جدوله الخاص، فلا توجد نسخة واحدة لـ"الكود الأردني"، والسؤال الصحيح هو أي كود وأي نسخة. وقد تحققت BuildHub من الجهات المصدِرة فقط، فراجع مجلس البناء الوطني لتحديد الكود السارية ونسخته.',
    sourceUrl: 'https://www.rss.jo',
    lastVerified: '2026-08-27',
    keywords: ['jordan', 'jordanian code', 'national building council', 'amman', 'jordan building code', 'الأردن', 'كود البناء الأردني', 'عمّان'],
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
    // An absent edition is stated as absent, never rendered as "undefined" and
    // never quietly omitted - a missing line reads as "no issue here", which is
    // the opposite of what it means.
    const edition = reference.edition
      ? `edition BuildHub has on record: ${reference.edition}`
      : 'edition: NOT ESTABLISHED BY BUILDHUB - do not state one, ask or refer them to the authority';
    const superseded = reference.supersededBy
      ? `\n  superseded by: ${reference.supersededBy}`
      : '';
    const published = reference.publicationDate ? `\n  published: ${reference.publicationDate}` : '';
    const effective = reference.effectiveDate ? `\n  in force from: ${reference.effectiveDate}` : '';

    return `--- ${code}
  jurisdiction: ${reference.jurisdiction}
  authority: ${authority}
  scope: ${scope}
  ${edition}${published}${effective}${superseded}
  status: ${reference.status}
  what matters about it: ${note}
  official source: ${reference.sourceUrl}
  BuildHub last verified this: ${reference.lastVerified}
  BuildHub should re-check this by: ${reference.reviewDate}`;
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
  - WHERE THE EDITION IS "NOT ESTABLISHED BY BUILDHUB", say that BuildHub does
    not hold the current edition and name the authority to ask. Do NOT supply
    an edition from your own recollection to fill the gap - that is precisely
    the answer a person would act on and precisely the one nobody has checked.
  - A record marked "unverified" means BuildHub has NOT confirmed it is current.
    Say so rather than presenting it as settled.
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
