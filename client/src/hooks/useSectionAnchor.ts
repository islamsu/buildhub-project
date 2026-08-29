import { useEffect, useState } from 'react';
import { isSectionId, type SectionId } from '@shared/roleWorkspaceSections';

/**
 * The current `#section` in the address bar, kept in sync with the browser.
 *
 * wouter's useLocation reports the PATH only, so a workspace that addresses its
 * sections by hash cannot see them through the router. Two events matter:
 * `hashchange` for a same-page jump, and `popstate` for back/forward. A click
 * that pushes a new hash fires neither in every browser, so callers that push a
 * hash themselves also dispatch `hashchange` - see `goToSection`.
 */
export function useHashSection(): SectionId | null {
  const read = () => {
    const raw = window.location.hash.replace(/^#/, '');
    return isSectionId(raw) ? raw : null;
  };
  const [section, setSection] = useState<SectionId | null>(read);
  useEffect(() => {
    const sync = () => setSection(read());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, []);
  return section;
}

/**
 * Scroll a workspace section into view and SAY SO.
 *
 * A plain scrollIntoView is invisible when the target is already on screen -
 * which is exactly what the click audit recorded as "nothing happened" for
 * Pipeline, Catalogue, Documents, Portfolio and Performance. Landing on a
 * section therefore also moves focus to it and flashes a ring, so the click
 * has an observable consequence in both cases.
 */
export function revealSection(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Focusable only for this purpose; removed again so the section never
  // becomes a stop in the normal tab order.
  const hadTabIndex = el.hasAttribute('tabindex');
  if (!hadTabIndex) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  if (!hadTabIndex) el.removeAttribute('tabindex');
  el.setAttribute('data-section-landed', 'true');
  window.setTimeout(() => el.removeAttribute('data-section-landed'), 1600);
  return true;
}
