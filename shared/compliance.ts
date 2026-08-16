export type ComplianceRole = 'contractor' | 'engineer' | 'architect' | 'supplier' | 'project_manager';
export type ComplianceStatus = 'not_started' | 'under_review' | 'update_required' | 'approved' | 'rejected';
export type ComplianceDocumentStatus = 'submitted' | 'under_review' | 'approved' | 'rejected' | 'update_required';

export type ComplianceRequirement = {
  type: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  required: boolean;
};

export type ComplianceRegistrationSummaryRow = { role: ComplianceRole; label: string; pending: number; approved: number };

const COMPLIANCE_ROLE_LABELS: Record<ComplianceRole, [string, string]> = {
  contractor: ['Contractors', 'المقاولون'],
  engineer: ['Engineers', 'المهندسون'],
  architect: ['Architects', 'المهندسون المعماريون'],
  supplier: ['Suppliers', 'الموردون'],
  project_manager: ['Project Managers', 'مديرو المشاريع'],
};

export function summarizeComplianceRegistrations(registrations: Array<{ userRole?: string | null; onboardingStatus?: string | null }>, arabic = false): ComplianceRegistrationSummaryRow[] {
  return (Object.keys(COMPLIANCE_ROLE_LABELS) as ComplianceRole[]).map(role => {
    const roleRegistrations = registrations.filter(registration => registration.userRole === role);
    return { role, label: COMPLIANCE_ROLE_LABELS[role][arabic ? 1 : 0], pending: roleRegistrations.filter(registration => registration.onboardingStatus !== 'approved').length, approved: roleRegistrations.filter(registration => registration.onboardingStatus === 'approved').length };
  });
}

const COMMON_REQUIREMENTS: ComplianceRequirement[] = [
  { type: 'identity', name: 'Government-issued ID', nameAr: 'هوية حكومية سارية', description: 'Clear copy of the authorized representative’s government ID.', descriptionAr: 'نسخة واضحة من هوية الممثل القانوني السارية.', required: true },
  { type: 'tax_card', name: 'Tax card', nameAr: 'البطاقة الضريبية', description: 'Current tax registration document.', descriptionAr: 'مستند التسجيل الضريبي الساري.', required: true },
];

export const COMPLIANCE_REQUIREMENTS: Record<ComplianceRole, ComplianceRequirement[]> = {
  contractor: [...COMMON_REQUIREMENTS, { type: 'commercial_registration', name: 'Commercial registration', nameAr: 'السجل التجاري', description: 'Current commercial registration for the contracting entity.', descriptionAr: 'سجل تجاري ساري للمنشأة المتقدمة.', required: true }, { type: 'professional_license', name: 'Contracting license', nameAr: 'ترخيص المقاولات', description: 'Professional or construction activity license.', descriptionAr: 'ترخيص مزاولة نشاط المقاولات أو الإنشاءات.', required: true }, { type: 'insurance_certificate', name: 'Insurance certificate', nameAr: 'شهادة التأمين', description: 'Valid professional or workforce insurance certificate.', descriptionAr: 'شهادة تأمين مهني أو تأمين عمالة سارية.', required: false }],
  engineer: [...COMMON_REQUIREMENTS, { type: 'professional_license', name: 'Engineering syndicate license', nameAr: 'ترخيص نقابة المهندسين', description: 'Current professional registration or license.', descriptionAr: 'قيد أو ترخيص مهني ساري.', required: true }, { type: 'tax_registration', name: 'Professional tax registration', nameAr: 'التسجيل الضريبي المهني', description: 'Tax registration for the professional practice.', descriptionAr: 'تسجيل ضريبي للممارسة المهنية.', required: true }, { type: 'portfolio', name: 'Selected work portfolio', nameAr: 'نماذج أعمال مختارة', description: 'A PDF or archive showing relevant completed work.', descriptionAr: 'ملف PDF أو مستند يوضح الأعمال المنجزة ذات الصلة.', required: false }],
  architect: [...COMMON_REQUIREMENTS, { type: 'professional_license', name: 'Architecture license', nameAr: 'ترخيص مزاولة العمارة', description: 'Current architecture professional registration or license.', descriptionAr: 'قيد أو ترخيص مهني ساري لمزاولة العمارة.', required: true }, { type: 'tax_registration', name: 'Professional tax registration', nameAr: 'التسجيل الضريبي المهني', description: 'Tax registration for the design practice.', descriptionAr: 'تسجيل ضريبي لممارسة التصميم.', required: true }, { type: 'portfolio', name: 'Design portfolio', nameAr: 'ملف أعمال التصميم', description: 'A PDF showing selected design work.', descriptionAr: 'ملف PDF يوضح نماذج من أعمال التصميم.', required: false }],
  supplier: [...COMMON_REQUIREMENTS, { type: 'commercial_registration', name: 'Commercial registration', nameAr: 'السجل التجاري', description: 'Current commercial registration for the supplier entity.', descriptionAr: 'سجل تجاري ساري للمنشأة الموردة.', required: true }, { type: 'bank_certificate', name: 'Bank account certificate', nameAr: 'شهادة الحساب البنكي', description: 'Bank certificate matching the registered business.', descriptionAr: 'شهادة بنكية مطابقة لبيانات المنشأة المسجلة.', required: true }, { type: 'product_catalogue', name: 'Product catalogue', nameAr: 'كتالوج المنتجات', description: 'Current catalogue or product list for supplier review.', descriptionAr: 'كتالوج أو قائمة المنتجات الحالية للمراجعة.', required: false }],
  project_manager: [...COMMON_REQUIREMENTS, { type: 'professional_certificate', name: 'Project management certificate', nameAr: 'شهادة إدارة المشاريع', description: 'Relevant project management certification or professional registration.', descriptionAr: 'شهادة مهنية أو اعتماد مناسب لإدارة المشاريع.', required: true }, { type: 'experience_record', name: 'Experience record', nameAr: 'سجل الخبرات', description: 'Documented experience on comparable projects.', descriptionAr: 'مستند يوضح الخبرة في مشاريع مماثلة.', required: true }, { type: 'insurance_certificate', name: 'Professional insurance certificate', nameAr: 'شهادة التأمين المهني', description: 'Valid professional insurance certificate.', descriptionAr: 'شهادة تأمين مهني سارية.', required: false }],
};

export function isComplianceRole(role: string | null | undefined): role is ComplianceRole {
  return !!role && role in COMPLIANCE_REQUIREMENTS;
}

export function getComplianceRequirements(role: string | null | undefined): ComplianceRequirement[] {
  return isComplianceRole(role) ? COMPLIANCE_REQUIREMENTS[role] : [];
}

export function getComplianceStatusLabel(status: ComplianceStatus | ComplianceDocumentStatus, arabic = false): string {
  const labels: Record<ComplianceStatus | ComplianceDocumentStatus, [string, string]> = {
    not_started: ['Not started', 'لم يبدأ'],
    submitted: ['Submitted', 'تم الإرسال'],
    under_review: ['Under review', 'قيد المراجعة'],
    update_required: ['Update required', 'يتطلب تحديثاً'],
    approved: ['Approved', 'تمت الموافقة'],
    rejected: ['Rejected', 'مرفوض'],
  };
  return labels[status][arabic ? 1 : 0];
}
