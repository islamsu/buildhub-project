import { VendorsDirectoryView } from './VendorsDirectory';
import { usePageTitle } from '../hooks/usePageTitle';

/**
 * SUPPLIERS — the materials-and-goods sourcing journey, by provider ROLE.
 *
 * A buyer arrives thinking "I need a supplier". Until now the only place to
 * send them was /marketplace/vendors, which is every provider role at once:
 * contractors, engineers, architects, suppliers and project managers in one
 * undifferentiated list. The homepage card that pointed there had to describe
 * all of them, so it read "Suppliers & professionals - approved contractors,
 * engineers, architects, suppliers and project managers", which asks the
 * visitor to understand RAKIZA's provider model before they can start.
 *
 * ROLE, NOT CATEGORY, and the distinction is the point. Design Services and
 * Finishing are category views - what a provider has DECLARED they do - and a
 * contractor who declares Renovation belongs in Finishing. This is a question
 * about what kind of business it is, which is `users.userRole`, a canonical
 * enum value that every provider has carried since they registered.
 *
 * SAME COMPONENT, SAME DATA, SAME ELIGIBILITY. Shared implementation does not
 * require shared customer-facing navigation, and that is the whole correction
 * here: one directory component can serve several first-class destinations
 * through different truthful filters. /marketplace/vendors remains, unchanged,
 * as the full provider directory.
 */
export default function SuppliersDirectory() {
  usePageTitle();
  return (
    <VendorsDirectoryView
      presetRole="supplier"
      titleKey="suppliersDir.title"
      subtitleKey="suppliersDir.subtitle"
    />
  );
}
