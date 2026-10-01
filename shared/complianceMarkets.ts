/**
 * ── PER-MARKET COMPLIANCE CONFIGURATION ─────────────────────────────────
 *
 * One entry per market. Every GCC requirement below is `unverified` and
 * therefore BLOCKING: `marketComplianceReadiness` refuses the market, and no
 * provider can be approved against a rule BuildHub has not evidenced.
 *
 * ── WHY NOTHING IS MARKED VERIFIED ──────────────────────────────────────
 *
 * Verification means an official page was READ and recorded. In this
 * environment it could not be: the network egress proxy blocks direct fetches
 * of government domains, so the URLs below were DISCOVERED through search but
 * their contents were never opened. A search result's summary is not a primary
 * source, and several of the summaries blended ministry pages with consultancy
 * blogs - which the owner excluded as authority.
 *
 * The specific thing that cannot be settled without reading the page is the
 * one that matters most: APPLICABILITY. Whether a contractor classification is
 * a precondition for all contracting work or only for bidding on government
 * tenders is the difference between a reasonable onboarding and excluding most
 * of a market for no legal reason. Several of these schemes are administered
 * by tender boards and procurement authorities, which is suggestive and is not
 * evidence.
 *
 * So each entry records WHERE TO LOOK and WHAT TO ESTABLISH. It is a research
 * worksheet that the engine already treats correctly, not a configuration
 * waiting to be switched on.
 *
 * ── AND WHY EGYPT IS NOT MARKED VERIFIED EITHER ─────────────────────────
 *
 * Egypt's requirements live in `shared/compliance.ts` and predate this
 * architecture. They are a hard-coded array with no authority, no official
 * source and no verified date - precisely the unauditable shape the owner
 * asked to be replaced. Egypt is a LIVE market, so its running behaviour is
 * untouched and that list keeps serving onboarding. But it has not been
 * evidenced, and recording it here as verified to make the table look finished
 * would be the fabrication this file exists to avoid. Egypt needs the same
 * exercise as the other six.
 */

import type { MarketComplianceConfig, MarketRequirement } from './complianceAuthority';

/** An unverified investigation entry. Everything below is one of these. */
function pending(input: {
  type: string; name: string; nameAr: string; description: string; descriptionAr: string;
  authority: MarketRequirement['authority'];
  applicability: MarketRequirement['applicability'];
  applicabilityCondition?: string;
  subJurisdictions?: readonly string[];
  verification: MarketRequirement['verification'];
  candidateSource?: string; candidateUrl?: string;
  openQuestion: string;
}): MarketRequirement {
  return {
    type: input.type, name: input.name, nameAr: input.nameAr,
    description: input.description, descriptionAr: input.descriptionAr,
    // `required` is the LEGACY field and is deliberately false on an
    // unverified entry: nothing may be demanded of a provider on the strength
    // of a rule BuildHub has not read. `provenance` carries the real meaning.
    required: false,
    provenance: 'legal_requirement',
    authority: input.authority,
    applicability: input.applicability,
    applicabilityCondition: input.applicabilityCondition,
    subJurisdictions: input.subJurisdictions,
    verification: input.verification,
    evidence: {
      state: 'unverified',
      candidateSource: input.candidateSource,
      candidateUrl: input.candidateUrl,
      openQuestion: input.openQuestion,
    },
  };
}

const APPLICABILITY_QUESTION =
  'Does this apply to all contracting work in this market, or only to bidding '
  + 'for public-sector contracts? Establish from the authority\'s own page '
  + 'before any provider is asked for it.';

export const MARKET_COMPLIANCE: Readonly<Record<string, MarketComplianceConfig>> = {
  EG: {
    marketCode: 'EG',
    note:
      'LIVE MARKET, PROVENANCE NOT YET RECORDED. Onboarding is served by the '
      + 'legacy list in shared/compliance.ts, which carries no authority, source '
      + 'or verified date. Egypt needs the same authority-backed exercise as the '
      + 'GCC markets; it is not marked verified merely because it is live.',
    requirements: {},
  },

  SA: {
    marketCode: 'SA',
    requirements: {
      contractor: [pending({
        type: 'contractor_classification',
        name: 'Contractor classification certificate', nameAr: 'شهادة تصنيف المقاولين',
        description: 'Classification issued through the Saudi municipal authority.',
        descriptionAr: 'تصنيف صادر عن الجهة البلدية السعودية.',
        authority: { name: 'Ministry of Municipal, Rural Affairs and Housing (MOMAH)', nameAr: 'وزارة الشؤون البلدية والقروية والإسكان' },
        applicability: 'conditional', applicabilityCondition: 'To be established — see open question.',
        verification: 'classification_grade',
        candidateSource: 'MOMAH e-service: submit classification request',
        candidateUrl: 'https://momah.gov.sa/en/e-services/submit-classification',
        openQuestion: APPLICABILITY_QUESTION
          + ' Also establish which grades exist and whether grade caps project value.',
      })],
      engineer: [pending({
        type: 'professional_registration',
        name: 'Professional engineering registration', nameAr: 'التسجيل المهني الهندسي',
        description: 'Registration with the competent Saudi engineering body.',
        descriptionAr: 'التسجيل في الجهة الهندسية السعودية المختصة.',
        authority: { name: 'To be established — Saudi engineering regulator' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'professional_membership',
        openQuestion: 'Identify the competent Saudi regulator for individual engineering '
          + 'practice and whether registration is mandatory to practise, to sign drawings, '
          + 'or only to be employed by a licensed office.',
      })],
      supplier: [pending({
        type: 'commercial_registration',
        name: 'Commercial registration', nameAr: 'السجل التجاري',
        description: 'Commercial registration for the supplying entity.',
        descriptionAr: 'سجل تجاري للمنشأة الموردة.',
        authority: { name: 'To be established — Saudi commercial registry' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'registration_number',
        openQuestion: 'Confirm the issuing authority and whether a materials supplier '
          + 'selling to private buyers needs anything beyond commercial registration.',
      })],
      architect: [pending({
        type: 'professional_registration',
        name: 'Architectural practice registration', nameAr: 'تسجيل مزاولة العمارة',
        description: 'Registration to practise architecture.', descriptionAr: 'تسجيل لمزاولة مهنة العمارة.',
        authority: { name: 'To be established' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'professional_membership',
        openQuestion: 'Establish whether architecture is regulated separately from '
          + 'engineering in Saudi Arabia, or falls under the same registration.',
      })],
      project_manager: [pending({
        type: 'professional_registration',
        name: 'Project management credential', nameAr: 'اعتماد إدارة المشاريع',
        description: 'Credential for construction project management.',
        descriptionAr: 'اعتماد لإدارة مشاريع الإنشاءات.',
        authority: { name: 'To be established' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'manual_review',
        openQuestion: 'Establish whether Saudi law regulates construction project '
          + 'management as a licensed activity at all. If it does not, any Rakiza '
          + 'requirement here must be recorded as buildhub_policy, never as legal.',
      })],
    },
  },

  AE: {
    marketCode: 'AE',
    note:
      'SUB-JURISDICTION MATTERS HERE. Discovery indicates engineering practice is '
      + 'administered by different authorities in different emirates - Abu Dhabi '
      + 'through the Department of Municipalities and Transport via TAMM, Dubai '
      + 'through Dubai Municipality - so a single federal list would be wrong. The '
      + 'commercial market stays AE with one currency; only compliance is scoped.',
    requirements: {
      engineer: [
        pending({
          type: 'professional_registration',
          name: 'Engineer licence (Abu Dhabi)', nameAr: 'ترخيص مهندس (أبوظبي)',
          description: 'Engineer registration administered for Abu Dhabi.',
          descriptionAr: 'تسجيل المهندسين في أبوظبي.',
          authority: { name: 'Department of Municipalities and Transport (DMT)', jurisdiction: 'AE-AZ' },
          applicability: 'conditional', applicabilityCondition: 'Practising in Abu Dhabi — to be confirmed.',
          subJurisdictions: ['AE-AZ'],
          verification: 'licence_number',
          candidateSource: 'TAMM — Issue an Engineer Licence Card',
          candidateUrl: 'https://www.tamm.abudhabi/en/life-events/business/housing-construction/engineering/IssuingEngineerLicence',
          openQuestion: 'Confirm the licence grades and whether a licence is required to '
            + 'offer engineering services to private clients, or only to submit work to '
            + 'the authority. Confirm current grade names against the authority page.',
        }),
        pending({
          type: 'professional_registration',
          name: 'Engineer qualification (Dubai)', nameAr: 'تأهيل مهندس (دبي)',
          description: 'Engineer qualification administered for Dubai.',
          descriptionAr: 'تأهيل المهندسين في دبي.',
          authority: { name: 'Dubai Municipality', jurisdiction: 'AE-DU' },
          applicability: 'conditional', applicabilityCondition: 'Practising in Dubai — to be confirmed.',
          subJurisdictions: ['AE-DU'],
          verification: 'licence_number',
          candidateSource: 'Dubai Municipality — Consultants and Contractors Licensing Standards',
          candidateUrl: 'https://www.dm.gov.ae/municipality-business/consultants-and-contractors-licensing-standards/',
          openQuestion: 'Confirm what Dubai requires of an individual engineer versus a '
            + 'licensed consulting office, and whether the two are separable.',
        }),
      ],
      contractor: [pending({
        type: 'contracting_licence',
        name: 'Contracting licence', nameAr: 'رخصة مقاولات',
        description: 'Licence to carry out contracting work.', descriptionAr: 'رخصة لمزاولة أعمال المقاولات.',
        authority: { name: 'To be established — emirate-level licensing authority' },
        applicability: 'conditional', applicabilityCondition: 'To be established per emirate.',
        verification: 'licence_number',
        candidateSource: 'Dubai Municipality — Consultants and Contractors Licensing Standards',
        candidateUrl: 'https://www.dm.gov.ae/municipality-business/consultants-and-contractors-licensing-standards/',
        openQuestion: 'Establish, per emirate, which authority licenses contracting and '
          + 'whether the requirement differs by emirate. Do not assume federal uniformity.',
      })],
      supplier: [pending({
        type: 'trade_licence',
        name: 'Trade licence', nameAr: 'الرخصة التجارية',
        description: 'Trade licence for the supplying entity.', descriptionAr: 'رخصة تجارية للمنشأة الموردة.',
        authority: { name: 'To be established — emirate economic department' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'licence_number',
        openQuestion: 'Establish which authority issues the licence for a building-materials '
          + 'supplier, and whether mainland and free-zone entities differ for Rakiza purposes.',
      })],
      architect: [pending({
        type: 'professional_registration',
        name: 'Architectural practice registration', nameAr: 'تسجيل مزاولة العمارة',
        description: 'Registration to practise architecture.', descriptionAr: 'تسجيل لمزاولة مهنة العمارة.',
        authority: { name: 'To be established — emirate-level' },
        applicability: 'conditional', applicabilityCondition: 'To be established per emirate.',
        verification: 'professional_membership',
        candidateSource: 'DMT — Professional Qualification Exam, Architecture Engineering',
        candidateUrl: 'https://pages.dmt.gov.ae/en/Architecture-Engineering-Exam',
        openQuestion: 'Establish whether architecture is a separate licensed discipline and '
          + 'whether a qualification exam is a precondition in each emirate.',
      })],
      project_manager: [pending({
        type: 'professional_registration',
        name: 'Project management credential', nameAr: 'اعتماد إدارة المشاريع',
        description: 'Credential for construction project management.',
        descriptionAr: 'اعتماد لإدارة مشاريع الإنشاءات.',
        authority: { name: 'To be established' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'manual_review',
        openQuestion: 'Establish whether construction project management is a licensed '
          + 'activity in any emirate. If not, a Rakiza requirement must be '
          + 'buildhub_policy.',
      })],
    },
  },

  QA: {
    marketCode: 'QA',
    note:
      'Discovery indicates contractor classification is administered through the '
      + 'Ministry of Finance procurement platform for participation in government '
      + 'tenders, and that engineers register through a separate municipal process. '
      + 'If classification is procurement-scoped it must be PUBLIC_PROCUREMENT_ONLY '
      + 'and must not gate a private homeowner RFQ.',
    requirements: {
      contractor: [pending({
        type: 'contractor_classification',
        name: 'Contractor classification', nameAr: 'تصنيف المقاولين',
        description: 'Classification for participation in government tenders.',
        descriptionAr: 'تصنيف للمشاركة في المناقصات الحكومية.',
        authority: { name: 'Ministry of Finance — Monaqasat', nameAr: 'وزارة المالية — مناقصات' },
        applicability: 'public_procurement_only',
        applicabilityCondition: 'Government tenders. To be confirmed from the platform\'s own page.',
        verification: 'classification_grade',
        candidateSource: 'Monaqasat (Ministry of Finance procurement platform)',
        candidateUrl: 'https://monaqasat.mof.gov.qa/',
        openQuestion: 'Confirm that classification is required ONLY for public tenders. If '
          + 'it also conditions private contracting, change applicability accordingly.',
      })],
      engineer: [pending({
        type: 'professional_registration',
        name: 'Registration in the engineers record', nameAr: 'التسجيل في سجل المهندسين',
        description: 'Authorisation to practise engineering in Qatar.',
        descriptionAr: 'ترخيص مزاولة المهنة الهندسية في قطر.',
        authority: { name: 'Ministry of Municipality', nameAr: 'وزارة البلدية' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'professional_membership',
        candidateSource: 'Hukoomi — Request Registration in Engineers Record',
        candidateUrl: 'https://hukoomi.gov.qa/en/services/renew-registration-in-engineers-record',
        openQuestion: 'Confirm whether registration is mandatory to offer engineering '
          + 'services privately, and which specialisations and categories exist.',
      })],
      supplier: [pending({
        type: 'commercial_registration',
        name: 'Commercial registration', nameAr: 'السجل التجاري',
        description: 'Commercial registration for the supplying entity.',
        descriptionAr: 'سجل تجاري للمنشأة الموردة.',
        authority: { name: 'Ministry of Commerce and Industry', nameAr: 'وزارة التجارة والصناعة' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'registration_number',
        candidateSource: 'Ministry of Commerce and Industry',
        candidateUrl: 'https://www.moci.gov.qa/en',
        openQuestion: 'Confirm what a building-materials supplier selling to private buyers '
          + 'must hold, and whether any activity licence is additional.',
      })],
      architect: [pending({
        type: 'professional_registration',
        name: 'Architectural practice registration', nameAr: 'تسجيل مزاولة العمارة',
        description: 'Registration to practise architecture.', descriptionAr: 'تسجيل لمزاولة مهنة العمارة.',
        authority: { name: 'To be established' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'professional_membership',
        openQuestion: 'Establish whether architecture registers through the same engineers '
          + 'record or separately.',
      })],
      project_manager: [pending({
        type: 'professional_registration',
        name: 'Project management credential', nameAr: 'اعتماد إدارة المشاريع',
        description: 'Credential for construction project management.',
        descriptionAr: 'اعتماد لإدارة مشاريع الإنشاءات.',
        authority: { name: 'To be established' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'manual_review',
        openQuestion: 'Establish whether this is a licensed activity in Qatar at all.',
      })],
    },
  },

  KW: {
    marketCode: 'KW',
    note:
      'Discovery indicates contractor registration is administered by the public '
      + 'tenders authority, which points at a procurement scope, and that '
      + 'engineering offices are separately regulated. Both need confirming from '
      + 'the authorities\' own pages.',
    requirements: {
      contractor: [pending({
        type: 'contractor_registration',
        name: 'Contractor registration', nameAr: 'تسجيل المقاولين',
        description: 'Registration for participation in public tenders.',
        descriptionAr: 'تسجيل للمشاركة في المناقصات العامة.',
        authority: { name: 'Central Agency for Public Tenders', nameAr: 'الجهاز المركزي للمناقصات العامة' },
        applicability: 'public_procurement_only',
        applicabilityCondition: 'Public tenders. To be confirmed.',
        verification: 'registration_number',
        candidateSource: 'Kuwait Government Online — Contractor Subscription Renewal',
        candidateUrl: 'https://www.e.gov.kw/sites/kgoEnglish/Pages/eServices/CTC/RegContractor.aspx',
        openQuestion: 'Confirm that this registration is a tender prerequisite and not a '
          + 'licence to contract privately. Identify separately what licenses private '
          + 'contracting work in Kuwait.',
      })],
      engineer: [pending({
        type: 'professional_registration',
        name: 'Engineering practice authorisation', nameAr: 'ترخيص مزاولة الهندسة',
        description: 'Authorisation to practise engineering in Kuwait.',
        descriptionAr: 'ترخيص لمزاولة المهنة الهندسية في الكويت.',
        authority: { name: 'To be established — engineering regulator' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'professional_membership',
        candidateSource: 'Kuwait Government Online — Engineering Offices Regulation',
        candidateUrl: 'https://e.gov.kw/sites/kgoenglish/Pages/eServices/KM/EngineeringOfficesRegulation.aspx',
        openQuestion: 'Distinguish what is required of an individual engineer from what is '
          + 'required of a registered engineering OFFICE; the discovered page concerns '
          + 'offices.',
      })],
      supplier: [pending({
        type: 'commercial_licence',
        name: 'Commercial licence', nameAr: 'الرخصة التجارية',
        description: 'Commercial licence for the supplying entity.',
        descriptionAr: 'رخصة تجارية للمنشأة الموردة.',
        authority: { name: 'To be established' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'licence_number',
        openQuestion: 'Identify the licensing authority for a building-materials supplier.',
      })],
      architect: [pending({
        type: 'professional_registration',
        name: 'Architectural practice authorisation', nameAr: 'ترخيص مزاولة العمارة',
        description: 'Authorisation to practise architecture.', descriptionAr: 'ترخيص لمزاولة العمارة.',
        authority: { name: 'To be established' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'professional_membership',
        openQuestion: 'Establish whether architecture is regulated separately from engineering.',
      })],
      project_manager: [pending({
        type: 'professional_registration',
        name: 'Project management credential', nameAr: 'اعتماد إدارة المشاريع',
        description: 'Credential for construction project management.',
        descriptionAr: 'اعتماد لإدارة مشاريع الإنشاءات.',
        authority: { name: 'To be established' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'manual_review',
        openQuestion: 'Establish whether this is a licensed activity in Kuwait at all.',
      })],
    },
  },

  BH: {
    marketCode: 'BH',
    note:
      'Discovery indicates engineering practice is licensed by a dedicated council, '
      + 'and that contractor prequalification is administered for ministry tenders - '
      + 'which would make the latter procurement-scoped. Both need confirming.',
    requirements: {
      engineer: [pending({
        type: 'professional_registration',
        name: 'Engineer licence', nameAr: 'ترخيص مهندس',
        description: 'Licence to practise engineering in Bahrain.',
        descriptionAr: 'ترخيص لمزاولة المهنة الهندسية في البحرين.',
        authority: { name: 'Council for Regulating the Practice of Engineering Professions (CRPEP)', nameAr: 'مجلس تنظيم مزاولة المهن الهندسية' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'licence_number',
        candidateSource: 'Bahrain eGovernment — Engineer\'s License Issuance',
        candidateUrl: 'https://www.bahrain.bh/wps/portal/en/BNP/ServicesCatalogue/GSX-UI-PServiceDetails?psID=4023',
        openQuestion: 'Confirm the disciplines and grades, and whether the licence is '
          + 'required to offer services privately or only to submit work to authorities.',
      })],
      contractor: [pending({
        type: 'contractor_prequalification',
        name: 'Contractor prequalification', nameAr: 'التأهيل المسبق للمقاولين',
        description: 'Prequalification for ministry tenders.',
        descriptionAr: 'التأهيل المسبق لمناقصات الوزارة.',
        authority: { name: 'Ministry of Works', nameAr: 'وزارة الأشغال' },
        applicability: 'public_procurement_only',
        applicabilityCondition: 'Ministry tenders. To be confirmed.',
        verification: 'classification_grade',
        candidateSource: 'Bahrain eGovernment — Contractor Prequalification Request',
        candidateUrl: 'https://www.bahrain.bh/wps/portal/en/BNP/ServicesCatalogue/GSX-UI-PServiceDetails?psID=2332',
        openQuestion: 'Confirm this is a tender prequalification rather than a licence to '
          + 'contract privately, and identify separately what licenses private contracting.',
      })],
      supplier: [pending({
        type: 'commercial_registration',
        name: 'Commercial registration', nameAr: 'السجل التجاري',
        description: 'Commercial registration for the supplying entity.',
        descriptionAr: 'سجل تجاري للمنشأة الموردة.',
        authority: { name: 'Ministry of Industry and Commerce', nameAr: 'وزارة الصناعة والتجارة' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'registration_number',
        candidateSource: 'Ministry of Industry and Commerce',
        candidateUrl: 'https://www.moic.gov.bh/en',
        openQuestion: 'Confirm what a building-materials supplier must hold to sell privately.',
      })],
      architect: [pending({
        type: 'professional_registration',
        name: 'Architectural practice licence', nameAr: 'ترخيص مزاولة العمارة',
        description: 'Licence to practise architecture.', descriptionAr: 'ترخيص لمزاولة العمارة.',
        authority: { name: 'Council for Regulating the Practice of Engineering Professions (CRPEP)' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'licence_number',
        openQuestion: 'Confirm whether architecture is one of the disciplines this council '
          + 'licenses, or is regulated elsewhere.',
      })],
      project_manager: [pending({
        type: 'professional_registration',
        name: 'Project management credential', nameAr: 'اعتماد إدارة المشاريع',
        description: 'Credential for construction project management.',
        descriptionAr: 'اعتماد لإدارة مشاريع الإنشاءات.',
        authority: { name: 'To be established' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'manual_review',
        openQuestion: 'Establish whether this is a licensed activity in Bahrain at all.',
      })],
    },
  },

  OM: {
    marketCode: 'OM',
    note:
      'Discovery indicates company classification is administered by the Tender '
      + 'Board and determines bidding rights, which points at a procurement scope. '
      + 'What licenses ORDINARY private contracting in Oman is a separate question '
      + 'and is not yet identified.',
    requirements: {
      contractor: [pending({
        type: 'contractor_classification',
        name: 'Tender Board registration and classification', nameAr: 'التسجيل والتصنيف في مجلس المناقصات',
        description: 'Classification determining tender bidding rights.',
        descriptionAr: 'تصنيف يحدد حقوق التقدم للمناقصات.',
        authority: { name: 'Tender Board', nameAr: 'مجلس المناقصات' },
        applicability: 'public_procurement_only',
        applicabilityCondition: 'Government tenders. To be confirmed.',
        verification: 'classification_grade',
        candidateSource: 'Oman Government Portal — Tender Board Registration & Classification',
        candidateUrl: 'https://omanuna.oman.om/en/online-services/tender-board-registration-classification',
        openQuestion: 'Confirm that classification governs tender eligibility only, and '
          + 'identify separately what licenses private contracting work in Oman. The '
          + 'Omani provider whose mislabelled currency opened this workstream operates '
          + 'in this market, '
          + 'so this question is not academic.',
      })],
      engineer: [pending({
        type: 'professional_registration',
        name: 'Engineering practice registration', nameAr: 'تسجيل مزاولة الهندسة',
        description: 'Registration to practise engineering in Oman.',
        descriptionAr: 'تسجيل لمزاولة المهنة الهندسية في عُمان.',
        authority: { name: 'To be established — Omani engineering regulator' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'professional_membership',
        openQuestion: 'Identify the competent Omani authority for individual engineering '
          + 'practice and whether registration is mandatory to offer services privately.',
      })],
      supplier: [pending({
        type: 'commercial_registration',
        name: 'Commercial registration', nameAr: 'السجل التجاري',
        description: 'Commercial registration for the supplying entity.',
        descriptionAr: 'سجل تجاري للمنشأة الموردة.',
        authority: { name: 'To be established — Omani commercial registry' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'registration_number',
        openQuestion: 'Confirm the issuing authority and what a building-materials supplier '
          + 'must hold to sell to private buyers.',
      })],
      architect: [pending({
        type: 'professional_registration',
        name: 'Architectural practice registration', nameAr: 'تسجيل مزاولة العمارة',
        description: 'Registration to practise architecture.', descriptionAr: 'تسجيل لمزاولة العمارة.',
        authority: { name: 'To be established' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'professional_membership',
        openQuestion: 'Establish whether architecture is regulated separately from engineering.',
      })],
      project_manager: [pending({
        type: 'professional_registration',
        name: 'Project management credential', nameAr: 'اعتماد إدارة المشاريع',
        description: 'Credential for construction project management.',
        descriptionAr: 'اعتماد لإدارة مشاريع الإنشاءات.',
        authority: { name: 'To be established' },
        applicability: 'conditional', applicabilityCondition: 'To be established.',
        verification: 'manual_review',
        openQuestion: 'Establish whether this is a licensed activity in Oman at all.',
      })],
    },
  },
};

/** The config for a market, or undefined when BuildHub has no entry at all. */
export function marketComplianceConfig(marketCode: string | null | undefined) {
  if (!marketCode) return undefined;
  return MARKET_COMPLIANCE[marketCode];
}
