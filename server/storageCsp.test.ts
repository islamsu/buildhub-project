import { describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { storageOrigins } from './_core/objectStorage';
import { registerSecurity } from './_core/security';
import { ENV } from './_core/env';

/**
 * EVERY IMAGE IN THE PRODUCT WAS REFUSED BY THE PRODUCT'S OWN CSP.
 *
 * `/manus-storage/<key>` authorises a request and answers 307 to a short-lived
 * signed URL on the object store. The store is a different origin on every
 * real deployment. The page's policy said:
 *
 *   img-src 'self' data: blob:
 *
 * and a cross-origin redirect target is not `'self'`, so the browser refused
 * it - product photos, avatars, RFQ image attachments, quotation photos:
 *
 *   Refused to load the image 'https://<store>/...'
 *   requestfailed :: csp
 *
 * SILENTLY. `<img>` fires onerror, a broken image renders, and nothing reaches
 * the server, which is why a green suite and a source review both missed it.
 * `crossOriginResourcePolicy` had already been relaxed for exactly this
 * redirect; `img-src` was not.
 *
 * These tests pin the two halves: that the origins are derived from the same
 * configuration the redirect uses, and that they actually reach the header a
 * browser enforces.
 */

const withEnv = (patch: Partial<typeof ENV>, run: () => void) => {
  const saved: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    saved[key] = (ENV as Record<string, unknown>)[key];
    (ENV as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key];
  }
  try { run(); } finally {
    for (const key of Object.keys(saved)) (ENV as Record<string, unknown>)[key] = saved[key];
  }
};

const S3 = { s3Bucket: 'buildhub-media', s3AccessKeyId: 'AK', s3SecretAccessKey: 'SK', s3Region: 'us-east-1' };

describe('the origins a stored file can be served from', () => {
  it('is empty when no storage is configured - never a wildcard', () => {
    withEnv({ s3Bucket: '', s3AccessKeyId: '', s3SecretAccessKey: '', forgeApiUrl: '', forgeApiKey: '' }, () => {
      expect(storageOrigins(ENV)).toEqual([]);
    });
  });

  it('includes the configured S3 endpoint', () => {
    withEnv({ ...S3, s3Endpoint: 'https://ewr1.vultrobjects.com', forgeApiUrl: '', forgeApiKey: '' }, () => {
      expect(storageOrigins(ENV)).toContain('https://ewr1.vultrobjects.com');
    });
  });

  it('also includes the virtual-hosted form, where the bucket is in the HOST', () => {
    // Which form the SDK produces depends on forcePathStyle. Getting this
    // wrong does not error - it silently blocks every image again.
    withEnv({ ...S3, s3Endpoint: 'https://ewr1.vultrobjects.com', forgeApiUrl: '', forgeApiKey: '' }, () => {
      expect(storageOrigins(ENV)).toContain('https://buildhub-media.ewr1.vultrobjects.com');
    });
  });

  it('falls back to the AWS regional endpoint when none is set', () => {
    withEnv({ ...S3, s3Region: 'eu-west-1', s3Endpoint: '', forgeApiUrl: '', forgeApiKey: '' }, () => {
      const origins = storageOrigins(ENV);
      expect(origins).toContain('https://s3.eu-west-1.amazonaws.com');
      expect(origins).toContain('https://buildhub-media.s3.eu-west-1.amazonaws.com');
    });
  });

  it('covers the https form of an http endpoint, because the policy upgrades it', () => {
    // upgrade-insecure-requests rewrites the request before img-src is
    // matched, so an http-only entry could never match what is actually sent.
    withEnv({ ...S3, s3Endpoint: 'http://127.0.0.1:4566', forgeApiUrl: '', forgeApiKey: '' }, () => {
      const origins = storageOrigins(ENV);
      expect(origins).toContain('http://127.0.0.1:4566');
      expect(origins).toContain('https://127.0.0.1:4566');
    });
  });

  it('uses the Forge endpoint when that is the configured backend', () => {
    withEnv({ s3Bucket: '', s3AccessKeyId: '', s3SecretAccessKey: '', forgeApiUrl: 'https://forge.example.com/api', forgeApiKey: 'k' }, () => {
      expect(storageOrigins(ENV)).toEqual(['https://forge.example.com']);
    });
  });

  it('an unparseable endpoint contributes nothing rather than breaking startup', () => {
    withEnv({ ...S3, s3Endpoint: 'not a url', forgeApiUrl: '', forgeApiKey: '' }, () => {
      expect(() => storageOrigins(ENV)).not.toThrow();
      expect(storageOrigins(ENV)).not.toContain('not a url');
    });
  });

  it('never emits a wildcard or a scheme-only source', () => {
    withEnv({ ...S3, s3Endpoint: 'https://ewr1.vultrobjects.com', forgeApiUrl: '', forgeApiKey: '' }, () => {
      for (const origin of storageOrigins(ENV)) {
        expect(origin).not.toContain('*');
        expect(origin).toMatch(/^https?:\/\/[^/]+$/);
      }
    });
  });
});

/**
 * The header a real HTTP response carries, not the object that produces it.
 * helmet serialises the directives itself, so asserting on the config would
 * assert on the input rather than on what a browser receives.
 */
async function cspFor(patch: Partial<typeof ENV>): Promise<string> {
  const saved: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    saved[key] = (ENV as Record<string, unknown>)[key];
    (ENV as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key];
  }
  try {
    const app = express();
    registerSecurity(app);
    app.get('/', (_req, res) => { res.send('ok'); });
    const server = app.listen(0);
    try {
      await new Promise<void>(resolve => server.once('listening', () => resolve()));
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/`);
      await response.text();
      return response.headers.get('content-security-policy') ?? '';
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  } finally {
    for (const key of Object.keys(saved)) (ENV as Record<string, unknown>)[key] = saved[key];
  }
}

describe('the policy the browser is actually sent', () => {
  it('lists the object store in img-src', async () => {
    const csp = await cspFor({ ...S3, s3Endpoint: 'https://ewr1.vultrobjects.com', forgeApiUrl: '', forgeApiKey: '', isProduction: true });
    const imgSrc = csp.split(';').map(d => d.trim()).find(d => d.startsWith('img-src')) ?? '';
    expect(imgSrc, 'without this every stored image is refused').toContain('https://ewr1.vultrobjects.com');
    expect(imgSrc).toContain("'self'");
  });

  it('lists it in media-src too, for stored video and audio', async () => {
    const csp = await cspFor({ ...S3, s3Endpoint: 'https://ewr1.vultrobjects.com', forgeApiUrl: '', forgeApiKey: '', isProduction: true });
    const mediaSrc = csp.split(';').map(d => d.trim()).find(d => d.startsWith('media-src')) ?? '';
    expect(mediaSrc).toContain('https://ewr1.vultrobjects.com');
  });

  it('adds nothing to img-src when no storage is configured', async () => {
    const csp = await cspFor({ s3Bucket: '', s3AccessKeyId: '', s3SecretAccessKey: '', forgeApiUrl: '', forgeApiKey: '', isProduction: true });
    const imgSrc = csp.split(';').map(d => d.trim()).find(d => d.startsWith('img-src')) ?? '';
    expect(imgSrc.trim()).toBe("img-src 'self' data: blob:");
  });

  it('does not open the policy generally - scripts stay locked down in production', async () => {
    // The fix must not become an excuse to loosen anything else.
    const csp = await cspFor({ ...S3, s3Endpoint: 'https://ewr1.vultrobjects.com', forgeApiUrl: '', forgeApiKey: '', isProduction: true });
    const scriptSrc = csp.split(';').map(d => d.trim()).find(d => d.startsWith('script-src') && !d.startsWith('script-src-attr')) ?? '';
    expect(scriptSrc).not.toContain('unsafe-inline');
    expect(scriptSrc).not.toContain('unsafe-eval');
    expect(scriptSrc).not.toContain('vultrobjects');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('upgrades insecure requests in production', async () => {
    const csp = await cspFor({ ...S3, s3Endpoint: 'https://ewr1.vultrobjects.com', forgeApiUrl: '', forgeApiKey: '', isProduction: true });
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('does NOT upgrade them in development, which is what the code always intended', async () => {
    // helmet's `useDefaults` includes upgrade-insecure-requests, so the old
    // production-only spread was dead and the directive was sent in
    // development too - silently rewriting a local http object store to https.
    const csp = await cspFor({ ...S3, s3Endpoint: 'http://127.0.0.1:4566', forgeApiUrl: '', forgeApiKey: '', isProduction: false });
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});
