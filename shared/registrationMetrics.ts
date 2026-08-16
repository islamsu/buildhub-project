export type RegistrationMetricDocument = {
  url?: string | null;
  createdAt?: Date | string | null;
  reviewedAt?: Date | string | null;
};

export type RegistrationMetricApplicant = {
  id: number;
  name?: string | null;
  email?: string | null;
  userRole?: string | null;
  onboardingStatus?: string | null;
  onboardingReviewedAt?: Date | string | null;
  createdAt?: Date | string | null;
  documents?: RegistrationMetricDocument[];
};

export type RegistrationMetricFilters = {
  role?: string;
  from?: string;
  to?: string;
};

export function getLatestRegistrationDocument(applicant: RegistrationMetricApplicant) {
  return applicant.documents?.find(document => Boolean(document.url)) ?? applicant.documents?.[0];
}

export function getRegistrationSubmissionDate(applicant: RegistrationMetricApplicant) {
  return getLatestRegistrationDocument(applicant)?.createdAt ?? applicant.createdAt ?? null;
}

export function getRegistrationStatusDate(applicant: RegistrationMetricApplicant) {
  return applicant.onboardingReviewedAt ?? getLatestRegistrationDocument(applicant)?.reviewedAt ?? null;
}

export function dateKey(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

export function isDateWithinRange(value: unknown, from = '', to = '') {
  const key = dateKey(value);
  return Boolean(key) && (!from || key >= from) && (!to || key <= to);
}

export function filterRegistrationApplicants(applicants: RegistrationMetricApplicant[], filters: RegistrationMetricFilters = {}) {
  const role = filters.role ?? 'all';
  const from = filters.from ?? '';
  const to = filters.to ?? '';
  if (from && to && from > to) return [];
  return applicants.filter(applicant => {
    if (role !== 'all' && applicant.userRole !== role) return false;
    if (applicant.onboardingStatus === 'approved') return true;
    return (!from && !to) || isDateWithinRange(getRegistrationSubmissionDate(applicant), from, to);
  });
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export function buildRegistrationMetricsCsv(applicants: RegistrationMetricApplicant[], labelForRole: (role: string | null | undefined) => string) {
  const headers = ['Applicant', 'Email', 'Professional Category', 'Registration Status', 'Pending Applications', 'Approved Applications', 'Submission Date', 'Status Date'];
  const rows = applicants.map(applicant => [
    applicant.name || `#${applicant.id}`,
    applicant.email || '',
    labelForRole(applicant.userRole),
    applicant.onboardingStatus || 'not_started',
    applicant.onboardingStatus === 'approved' ? 0 : 1,
    applicant.onboardingStatus === 'approved' ? 1 : 0,
    dateKey(getRegistrationSubmissionDate(applicant)),
    dateKey(getRegistrationStatusDate(applicant)),
  ]);
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}
