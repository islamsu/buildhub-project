# File upload: verified working, and how to reproduce it

## Why this document exists

Every previous BuildHub handoff classified file upload as **BLOCKED BY
INFRASTRUCTURE**. That was an honest statement about the environment and a
useless one about the code: an unconfigured object store cannot tell a working
upload path from a broken one, and "users appear unable to upload files" was
reported as a product defect on that basis.

It is not a product defect. With an S3-compatible endpoint configured, the
whole chain works. This document records the evidence and the two commands
needed to reproduce it, so the next person does not have to re-derive it.

## What was proven

A local S3-compatible endpoint was configured and the chain the mandate names
was walked end to end, twice, with **16 of 16 checks passing**:

    SELECT -> VALIDATE -> UPLOAD -> STORAGE -> DATABASE -> PARENT LINK
    -> AUTHORIZED RETRIEVAL -> BYTES BACK -> IDOR REFUSAL

Specifically, and each asserted against the store or the database rather than
against a toast:

| Step | Evidence |
|---|---|
| Deployment reports uploads available | `auth.capabilities` |
| Image upload accepted | http 200 |
| Storage key returned | `product-images/user-<id>/brick_<hash>.png` |
| **Object exists in storage** | asked of the object store directly, http 200 |
| **It is not an empty placeholder** | 70 bytes, the real PNG |
| Attached to a product | `marketplace.setProductImages` http 200 |
| **The database row carries it** | `select images from products` contains the key |
| Owner retrieves it through the app | http 200 via `/manus-storage/<key>` |
| **The bytes come back** | 70 bytes |
| **An `<img>` actually decodes it** | `naturalWidth` 1, `naturalHeight` 1 |
| Private compliance document uploads | http 200 |
| **Supplier B cannot read it** | http 403 |
| **An anonymous stranger cannot** | http 401 |
| The store received real PUTs | 4 PUTs, all to the configured bucket |

A product image IS readable by another signed-in supplier (http 200). That is
recorded rather than asserted as a defect: catalogue images are content buyers
are meant to see. Private documents are the ones that must be protected, and
they are.

## Reproducing it

The app reads five variables (`server/_core/env.ts`). Any S3-compatible
endpoint works - MinIO, Vultr Object Storage, AWS S3, or the throwaway stub
used here.

    S3_ENDPOINT=http://127.0.0.1:4566
    S3_REGION=us-east-1
    S3_BUCKET=buildhub-test
    S3_ACCESS_KEY_ID=<any>
    S3_SECRET_ACCESS_KEY=<any>

Start any S3-compatible server on that endpoint, start BuildHub with those
variables set, and run the probe.

## What this does and does not prove

**It proves** BuildHub's side of the contract: the AWS SDK is configured
correctly, `storagePut` reaches a real endpoint with the right bucket, key and
content type, the database records the association, the download proxy
authorizes by ownership, and a browser can actually render the result.

**It does not prove** that any particular hosted provider works, that CORS is
configured on that provider, or that signatures verify - those are the
provider's side and belong to a staging test against the real bucket.

## The remaining gap is provisioning, not engineering

Staging still has `S3_*` unset, so the staging gate correctly skips those
checks and says why. Setting those five variables on staging is now the only
thing between this evidence and STAGING VERIFIED.

The same is true of SMTP for the password-reset round trip, which remains
genuinely unexercised.
