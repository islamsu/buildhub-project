import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  RFQ_CATEGORIES,
  isClassifiableRfqCategory,
  isRfqCategory,
  rfqCategoryLabel,
} from '@shared/rfqCategories';
import { isVendorEligibleForCategory } from './billing/enquiries';
import { DIRECTORY_VENDOR_COLUMNS, PROVIDER_ROLES } from './vendorDirectory';

// ── Shared taxonomy ────────────────────────────────────────────────────────

describe('RFQ category taxonomy (Phase 4B.3)', () => {
  it('is exactly the nine values already in production use - nothing invented', () => {
    expect(RFQ_CATEGORIES).toEqual([
      'Materials', 'Labor', 'Complete Project', 'Engineering', 'Design',
      'Furniture', 'Maintenance', 'Renovation', 'Custom Services',
    ]);
  });

  it('matches the list the RFQ-creation form offers, so both sides of the match agree', () => {
    const page = readFileSync(new URL('../client/src/pages/RFQPage.tsx', import.meta.url), 'utf8');
    // The page must consume the shared taxonomy rather than redeclaring one.
    expect(page).toContain('rfqCategories');
    expect(page).not.toMatch(/const CATEGORIES = \[/);
  });

  it('rejects anything outside the taxonomy', () => {
    for (const valid of RFQ_CATEGORIES) expect(isRfqCategory(valid)).toBe(true);
    for (const invalid of ['materials', 'MATERIALS', 'Plumbing', '', null, undefined, 7, {}]) {
      expect(isRfqCategory(invalid)).toBe(false);
    }
  });

  it('localises for display only - the canonical stored value is always English', () => {
    expect(rfqCategoryLabel('Materials', 'ar')).toBe('مواد بناء');
    expect(rfqCategoryLabel('Materials', 'en')).toBe('Materials');
    // An unknown value is echoed, never translated into something invented.
    expect(rfqCategoryLabel('Plumbing', 'ar')).toBe('Plumbing');
  });

  it('every category has an Arabic label', () => {
    for (const category of RFQ_CATEGORIES) {
      expect(rfqCategoryLabel(category, 'ar')).not.toBe(category);
    }
  });
});

// ── Deterministic eligibility ──────────────────────────────────────────────

describe('RFQ -> vendor eligibility (Phase 4B.3)', () => {
  it('matches when the vendor declared the RFQ category', () => {
    expect(isVendorEligibleForCategory(['Materials'], 'Materials')).toBe(true);
  });

  it('does not match when the vendor did not declare it', () => {
    expect(isVendorEligibleForCategory(['Materials'], 'Design')).toBe(false);
  });

  it('OR matching: any one declared category is enough', () => {
    const vendor = ['Materials', 'Design'];
    expect(isVendorEligibleForCategory(vendor, 'Materials')).toBe(true);
    expect(isVendorEligibleForCategory(vendor, 'Design')).toBe(true);
    expect(isVendorEligibleForCategory(vendor, 'Labor')).toBe(false);
  });

  it('a vendor with no declared categories is eligible for nothing', () => {
    for (const category of RFQ_CATEGORIES) {
      expect(isVendorEligibleForCategory([], category)).toBe(false);
    }
  });

  it('is exact-match only - no fuzzy matching, no case-insensitivity, no inference', () => {
    expect(isVendorEligibleForCategory(['Materials'], 'materials')).toBe(false);
    expect(isVendorEligibleForCategory(['Materials'], 'Material')).toBe(false);
    expect(isVendorEligibleForCategory(['Complete Project'], 'Project')).toBe(false);
  });

  it('CONSERVATIVE FALLBACK: an unclassified RFQ is eligible for NOBODY', () => {
    // Not "eligible for everyone" - that would expose every RFQ to every
    // vendor and falsely charge a credit for an unqualified opportunity.
    const everyCategory = [...RFQ_CATEGORIES];
    for (const unclassified of [null, undefined, '', '   ', 'Plumbing', 'Other']) {
      expect(isClassifiableRfqCategory(unclassified as string | null), String(unclassified)).toBe(false);
      expect(isVendorEligibleForCategory(everyCategory, unclassified as string | null), String(unclassified)).toBe(false);
    }
  });
});

// ── Directory security ─────────────────────────────────────────────────────

describe('vendor directory field allowlist (Phase 4B.3)', () => {
  it('exposes only the approved public columns', () => {
    expect(Object.keys(DIRECTORY_VENDOR_COLUMNS).sort()).toEqual(
      ['avatar', 'bio', 'createdAt', 'id', 'location', 'name', 'userRole', 'verified'].sort(),
    );
  });

  it('never exposes credentials or private account fields', () => {
    const keys = Object.keys(DIRECTORY_VENDOR_COLUMNS);
    for (const forbidden of [
      'passwordHash', 'invitationToken', 'invitationExpiresAt', 'email', 'phone',
      'openId', 'frozenReason', 'accountStatus', 'isDummy', 'creationNote',
      'providerCustomerRef', 'providerSubscriptionRef', 'plan',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('never issues select().from(users) without a column list', () => {
    const source = readFileSync(new URL('./vendorDirectory.ts', import.meta.url), 'utf8');
    // Match executable code only - the file's own comments legitimately name
    // the forbidden pattern in prose to explain why it is forbidden.
    const code = source
      .split('\n')
      .filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/select\(\)\s*\.from\(users\)/);
    expect(code).toContain('DIRECTORY_VENDOR_COLUMNS');
  });

  it('restricts the directory to provider roles only', () => {
    expect(PROVIDER_ROLES).toEqual(['contractor', 'engineer', 'architect', 'supplier', 'project_manager']);
    expect(PROVIDER_ROLES as readonly string[]).not.toContain('homeowner');
    expect(PROVIDER_ROLES as readonly string[]).not.toContain('admin');
  });

  it('excludes dummy, frozen, deactivated and unapproved accounts', () => {
    const source = readFileSync(new URL('./vendorDirectory.ts', import.meta.url), 'utf8');
    const filter = source.slice(source.indexOf('function directoryVisibilityFilter'), source.indexOf('export type DirectoryVendor'));
    expect(filter).toContain('users.isDummy, false');
    expect(filter).toContain("users.accountStatus, 'active'");
    expect(filter).toContain('isNull(users.deactivatedAt)');
    expect(filter).toContain("users.onboardingStatus, 'approved'");
  });

  it('ORGANIC ONLY: the directory never reads a billing plan, subscription, or entitlement', () => {
    const source = readFileSync(new URL('./vendorDirectory.ts', import.meta.url), 'utf8');
    // Paying must not buy a higher position (Phase 4B.3 §13).
    for (const forbidden of [
      'vendorSubscriptions', 'resolveVendorEntitlements', 'getBillingState',
      'visibilityLevel', 'featuredPlacement', 'PLANS',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it('reputation comes from live verified reviews, never the dead users.rating columns', () => {
    const source = readFileSync(new URL('./vendorDirectory.ts', import.meta.url), 'utf8');
    expect(source).toContain('reviews.verified, true');
    expect(source).not.toMatch(/:\s*users\.rating\b/);
    expect(source).not.toMatch(/:\s*users\.reviewCount\b/);
  });
});

// ── Concurrency design ─────────────────────────────────────────────────────

describe('qualified-enquiry concurrency design (Phase 4B.3 §8)', () => {
  const source = readFileSync(new URL('./billing/enquiries.ts', import.meta.url), 'utf8');

  it('performs the allowance check and the insert inside one transaction', () => {
    const block = source.slice(source.indexOf('export async function openQualifiedEnquiry'));
    expect(block).toContain('db.transaction(');
  });

  it('takes a row lock over the vendor-month range rather than a bare count-then-insert', () => {
    const block = source.slice(source.indexOf('export async function openQualifiedEnquiry'));
    expect(block).toContain(".for('update')");
    expect(block).toContain('qualifiedEnquiries.yearMonth');
  });

  it('treats a duplicate-key collision as already-consumed instead of failing the request', () => {
    expect(source).toContain('ER_DUP_ENTRY');
    const block = source.slice(source.indexOf('export async function openQualifiedEnquiry'));
    expect(block).toContain('isDuplicateKeyError');
  });

  it('the database enforces one credit per vendor+RFQ, not application logic', () => {
    const schema = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
    const table = schema.slice(schema.indexOf('export const qualifiedEnquiries'), schema.indexOf('// ── Types'));
    expect(table).toContain("uniqueIndex('qualifiedEnquiries_userId_rfqId_unique')");
    expect(table).toContain('.on(table.userId, table.rfqId)');
  });

  it('uniqueness is NOT scoped by month - a lead already paid for is never re-charged', () => {
    const schema = readFileSync(new URL('../drizzle/schema.ts', import.meta.url), 'utf8');
    const table = schema.slice(schema.indexOf('export const qualifiedEnquiries'), schema.indexOf('// ── Types'));
    const uniqueLine = table.split('\n').find(line => line.includes('userRfqUnique'))!;
    expect(uniqueLine).not.toContain('yearMonth');
  });

  it('history is preserved across months - nothing deletes qualified-enquiry rows', () => {
    expect(source).not.toMatch(/delete\(qualifiedEnquiries\)/);
  });
});
