import { VendorsDirectoryView } from './VendorsDirectory';
import { usePageTitle } from '../hooks/usePageTitle';

/**
 * CONTRACTORS — the build-and-execute journey, by provider ROLE.
 *
 * The most common intent on a construction marketplace after materials, and
 * the one that had no destination at all: contractors were reachable only
 * inside the generic provider directory, named in the middle of a sentence
 * listing five roles.
 *
 * `users.userRole = 'contractor'` is canonical and has existed since the role
 * matrix was written (shared/roleMatrix.ts). Nothing is inferred: this is not
 * "providers who declared a construction-ish category" and not "anyone who
 * looks like a contractor". A provider appears here when they registered as a
 * contractor and they are publicly listed, and not otherwise.
 *
 * AN EMPTY RESULT IS THE TRUE ANSWER. If no contractor has joined and been
 * approved, the page says so. The directory's own empty state handles it - no
 * fabricated cards, and no silent fallback to the unfiltered list, which would
 * be a destination that lies about what it is.
 */
export default function ContractorsDirectory() {
  usePageTitle();
  return (
    <VendorsDirectoryView
      presetRole="contractor"
      titleKey="contractorsDir.title"
      subtitleKey="contractorsDir.subtitle"
    />
  );
}
