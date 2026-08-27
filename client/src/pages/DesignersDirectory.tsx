import { VendorsDirectoryView } from './VendorsDirectory';

/**
 * The designers directory, reading REAL provider accounts.
 *
 * CLOSURE PASS. This page used to render `DESIGNERS` from
 * client/src/lib/marketplaceData.ts: a hardcoded list carrying invented
 * ratings, review counts, project counts, years of experience, team sizes and
 * `verified: true` badges. BuildHub had verified none of them and had no
 * relationship with any of them.
 *
 * It now renders the same directory component as /marketplace/vendors, filtered
 * to the vendors who have themselves DECLARED the shared taxonomy's 'Design'
 * category. Reputation comes from verified reviews, verification from the
 * compliance decision, location and bio from the vendor's own profile. When no
 * designer has joined yet the page is empty, which is the true answer.
 */
export default function DesignersDirectory() {
  return (
    <VendorsDirectoryView
      presetCategory="Design"
      titleKey="designersDir.title"
      subtitleKey="designersDir.subtitle"
    />
  );
}
