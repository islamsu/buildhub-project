import compression from "compression";
import type { Express } from "express";
import helmet from "helmet";
import { ENV } from "./env";

/**
 * ── Security headers and compression (Slice 4) ─────────────────────────────
 *
 * BuildHub shipped none of these. No CSP, no X-Content-Type-Options, no
 * Referrer-Policy, no HSTS - a marketplace handling vendor documents,
 * commercial terms and, shortly, payments.
 *
 * The CSP is written from what the application actually loads, not copied from
 * a template, because a policy that breaks the site gets switched off within a
 * day and then protects nothing:
 *
 *  - Google Fonts, referenced from client/index.html (fonts.googleapis.com for
 *    the stylesheet, fonts.gstatic.com for the font files).
 *  - `'unsafe-inline'` on styles, which Tailwind and the Radix primitives both
 *    require - they set inline style attributes for positioning and animation.
 *    Removing it would need a nonce plumbed through every component.
 *  - `data:` and `blob:` images, used by avatar previews and generated charts.
 *  - Uploads are served from this origin through /manus-storage, so no extra
 *    image or media host is needed.
 *
 * Scripts get no `'unsafe-inline'` and no `'unsafe-eval'`: the client is a
 * bundled ES module and needs neither.
 *
 * Development relaxes the policy because Vite's dev server injects an inline
 * HMR bootstrap and opens a websocket back to itself. The relaxation is scoped
 * to development only and never reaches a deployed instance.
 */
export function registerSecurity(app: Express) {
  // Compression first, so it wraps the responses the routes below produce.
  app.use(compression());

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ENV.isProduction ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc: ["'self'", "data:", "blob:"],
          mediaSrc: ["'self'", "blob:"],
          connectSrc: ENV.isProduction ? ["'self'"] : ["'self'", "ws:", "wss:"],
          // Nothing in BuildHub is meant to be embedded anywhere, and nothing
          // embeds a third party.
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          ...(ENV.isProduction ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      // Uploads are proxied from this origin via a 307 to a presigned URL on
      // another host; the default same-origin policy would block that redirect.
      crossOriginResourcePolicy: { policy: "cross-origin" },
      // Production is HTTPS by definition (the session cookie is pinned
      // `Secure` there). Two years, subdomains included, preload-eligible.
      hsts: ENV.isProduction
        ? { maxAge: 63_072_000, includeSubDomains: true, preload: true }
        : false,
      // The full URL of a BuildHub page can name a project or a vendor. Send
      // only the origin to third parties, and nothing at all when downgrading.
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );
}
