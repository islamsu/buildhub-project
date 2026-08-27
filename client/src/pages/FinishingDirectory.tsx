import { VendorsDirectoryView } from './VendorsDirectory';

/**
 * The finishing-companies directory, reading REAL provider accounts.
 *
 * CLOSURE PASS. This page used to render `FINISHING_COMPANIES` from
 * client/src/lib/marketplaceData.ts - the same fabrication as the designers
 * list, and in places attached to real, named Egyptian companies that have no
 * BuildHub account and never agreed to a rating being published for them.
 *
 * The preset category is 'Renovation', the closest fit in the shared RFQ
 * taxonomy, which has no separate "finishing" value. That mapping is a product
 * judgement and is flagged for the owner in the closure handoff - it is a
 * one-word change if the answer is different, and unlike the list it replaces
 * it invents nothing about any company.
 */
export default function FinishingDirectory() {
  return (
    <VendorsDirectoryView
      presetCategory="Renovation"
      titleKey="finishingDir.title"
      subtitleKey="finishingDir.subtitle"
    />
  );
}
