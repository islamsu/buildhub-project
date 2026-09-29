/**
 * ── THE SHELL'S `<head>`, WRITTEN PER REQUEST ───────────────────────────
 *
 * BuildHub serves one HTML file for every route (see server/_core/vite.ts:
 * both the dev middleware and the production static handler fall through to
 * the same `index.html`). So whatever that file's `<head>` says, it says about
 * every page - which is why `shared/seo.ts` exists and why this module puts
 * its answer into the bytes before they leave.
 *
 * ── WHY SERVER-SIDE AND NOT JUST IN REACT ───────────────────────────────
 *
 * The client sets the title too, and that is worth having: it is what fixes
 * the browser tab and what carries a product's own name once the data arrives.
 * But a `<link rel="canonical">` or a `<meta name="robots">` that only exists
 * after React has mounted is a directive the crawler may never have been given
 * - and for the robots tag, "may never have been given" means "was allowed to
 * index the staging preview". A directive about whether to index has to be in
 * the first response.
 *
 * ── REPLACEMENT, NOT TEMPLATING ─────────────────────────────────────────
 *
 * The tags are rewritten in place rather than the head being assembled here.
 * `client/index.html` stays the readable, editable source of the document -
 * fonts, viewport, theme colour, the root div - and this touches only the
 * handful of tags whose correct value depends on which URL was asked for.
 *
 * Every replacement is anchored on the exact attribute that identifies the tag,
 * and a tag that is not found is ADDED rather than silently skipped, so
 * removing a line from index.html cannot quietly disable a directive.
 */
import { buildEnvironment } from './health';
import { ENV } from './env';
import { publicEntityName } from '../seoEntityName';
import {
  canonicalUrl,
  matchPublicSeoRoute,
  robotsDirective,
  seoDescription,
  seoEntityTitle,
  seoTitle,
} from '../../shared/seo';

/**
 * Rewrite the head for one request path.
 *
 * `lang` is always English here. A crawler arrives with no BuildHub language
 * preference, the shell's `<html lang>` is `en`, and guessing Arabic from an
 * Accept-Language header would produce a document whose markup and metadata
 * disagreed about its own language. The client switches both together once it
 * knows the reader's actual choice.
 */
export async function applySeoHead(html: string, pathname: string): Promise<string> {
  const route = matchPublicSeoRoute(pathname);
  const environment = buildEnvironment();
  const robots = robotsDirective(route, environment);
  /*
   * A PRODUCT PAGE IS TITLED WITH THE PRODUCT.
   *
   * This is the one place the shell needs a database read, and it earns it:
   * product pages are the largest crawlable surface in the catalogue, and a
   * thousand of them sharing the title "Product — BuildHub" is the duplicate
   * -title defect this module was written to end, just at a smaller scale.
   *
   * `publicEntityName` returns null for every other route, for a row that is
   * not publicly visible, and for an unreachable database - so the worst case
   * is the generic title, never a wrong one and never a failed page.
   */
  const entityName = await publicEntityName(route, pathname);
  const title = entityName === null ? seoTitle(route, 'en') : seoEntityTitle(entityName, route, 'en');
  const description = seoDescription(route, 'en');
  /*
   * A CANONICAL ONLY FOR A PAGE THAT IS PUBLISHED.
   *
   * On a private page the tag would be pointless at best - nothing is going
   * to index /admin/users/461 - and at worst it publishes the shape of the
   * authenticated product to anything that scrapes the shell. `noindex` and
   * "here is my canonical URL" are two directives that do not belong together.
   */
  const canonical = route && route.access === 'public'
    ? canonicalUrl(ENV.appBaseUrl, pathname)
    : null;

  let out = html;
  out = replaceTitle(out, title);
  out = replaceMetaByName(out, 'description', description);
  out = replaceMetaByName(out, 'robots', robots);
  out = replaceMetaByProperty(out, 'og:title', title);
  out = replaceMetaByProperty(out, 'og:description', description);
  out = replaceMetaByName(out, 'twitter:title', title);
  out = replaceMetaByName(out, 'twitter:description', description);

  /*
   * NO ORIGIN CONFIGURED MEANS NO CANONICAL. Not a guess from the Host header,
   * and not the old hard-coded homepage: both are wrong in a way that is worse
   * than the tag's absence. Any canonical already in the document is removed,
   * so a stale one cannot survive a deployment that stopped knowing its origin.
   */
  out = out.replace(/\s*<link\s+rel="canonical"[^>]*>/gi, '');
  out = out.replace(/\s*<meta\s+property="og:url"[^>]*>/gi, '');
  if (canonical) {
    out = insertIntoHead(out, [
      `<link rel="canonical" href="${attr(canonical)}" />`,
      `<meta property="og:url" content="${attr(canonical)}" />`,
    ]);
  }

  return out;
}

function replaceTitle(html: string, title: string): string {
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeText(title)}</title>`);
  }
  return insertIntoHead(html, [`<title>${escapeText(title)}</title>`]);
}

function replaceMetaByName(html: string, name: string, content: string): string {
  const pattern = new RegExp(`<meta\\s+name="${escapeRegex(name)}"\\s+content="[^"]*"\\s*/?>`, 'i');
  const tag = `<meta name="${attr(name)}" content="${attr(content)}" />`;
  return pattern.test(html) ? html.replace(pattern, tag) : insertIntoHead(html, [tag]);
}

function replaceMetaByProperty(html: string, property: string, content: string): string {
  const pattern = new RegExp(`<meta\\s+property="${escapeRegex(property)}"\\s+content="[^"]*"\\s*/?>`, 'i');
  const tag = `<meta property="${attr(property)}" content="${attr(content)}" />`;
  return pattern.test(html) ? html.replace(pattern, tag) : insertIntoHead(html, [tag]);
}

/** Before `</head>`, or - if there is no head - before `</body>`, or appended. */
function insertIntoHead(html: string, tags: readonly string[]): string {
  const block = tags.map(tag => `    ${tag}`).join('\n');
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}\n  </head>`);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${block}\n  </body>`);
  return `${html}\n${block}\n`;
}

/** For an attribute value. A quote here would end the attribute and start markup. */
function attr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** For text between tags. `<` is the only character that can start something. */
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
