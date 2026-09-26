/**
 * ── robots.txt AND sitemap.xml ──────────────────────────────────────────
 *
 * Both are served by the application rather than shipped as static files in
 * the client bundle, for one reason each:
 *
 *   robots.txt   its answer depends on WHICH DEPLOYMENT this is. The same
 *                commit runs on staging and in production, and staging must
 *                answer `Disallow: /`. A file in the bundle cannot know.
 *
 *   sitemap.xml  its answer is the catalogue, which is a query.
 *
 * Registered BEFORE the SPA fall-through, or the catch-all would return the
 * HTML shell for both and a crawler would be parsing a React page as XML.
 */
import type { Express, Request, Response } from 'express';
import { ENV } from './_core/env';
import { buildEnvironment } from './_core/health';
import { robotsTxt } from '../shared/seo';
import { collectSitemapEntries, renderSitemap } from './sitemap';

export function registerCrawlerRoutes(app: Express) {
  app.get('/robots.txt', (_req: Request, res: Response) => {
    res
      .status(200)
      .set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
      .send(robotsTxt(ENV.appBaseUrl, buildEnvironment()));
  });

  app.get('/sitemap.xml', async (_req: Request, res: Response) => {
    /*
     * NO ORIGIN, NO SITEMAP. Every <loc> must be an absolute URL, and the only
     * trustworthy origin is the configured one - never the Host header, which
     * would let a caller have BuildHub publish a sitemap for their own domain.
     * 503 says "this deployment is not configured to publish one", which is
     * true, where an empty urlset would say "there is nothing here".
     */
    if (ENV.appBaseUrl.length === 0) {
      res.status(503).set({ 'Content-Type': 'text/plain; charset=utf-8' }).send(
        'No sitemap: this deployment has no APP_BASE_URL configured, so it cannot state its own absolute URLs.\n'
      );
      return;
    }

    try {
      const collection = await collectSitemapEntries(ENV.appBaseUrl);
      res
        .status(200)
        .set({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
        .send(renderSitemap(collection));
    } catch {
      /*
       * §10, in the one place where the mistake is durable: a crawler handed a
       * valid EMPTY sitemap has been told in XML that BuildHub has no products
       * and no suppliers, and may believe it for as long as it caches. 503 is
       * retried; a lie is not.
       */
      res.status(503).set({ 'Content-Type': 'text/plain; charset=utf-8' }).send(
        'No sitemap: BuildHub could not reach its catalogue. This is not an empty catalogue - please retry.\n'
      );
    }
  });
}
