# North Star 15–20 — fresh audit before building

> **SUPERSEDED IN PART — read this first.**
>
> This document is kept as HISTORICAL EVIDENCE of the audit that preceded
> North Star items 15–20. It is not rewritten, because an audit that gets
> edited after the fact stops being evidence of what was actually found.
>
> One statement in it is no longer true. The "Deployment status" section
> below reports that `render.yaml` declared `branch: main` while the release
> candidate lived on `claude/buildhub-global-release-candidate`, and that a
> push to the RC therefore did not reach staging. **That was correct when
> this audit was written and is now superseded:** the owner subsequently
> approved staging tracking the RC branch, and `render.yaml` records
> `branch: claude/buildhub-global-release-candidate` (see `CLAUDE.md` §89 and
> `OWNER_DECISIONS.md`).
>
> What has NOT changed is the second half of that section. Repository
> configuration is not deployment proof: nothing here is DEPLOYED, STAGING
> PREVIEW VERIFIED or STAGING VERIFIED, and migrations 0056–0060 remain
> **PUSHED — applied locally, not yet staging-verified**, until `/version`
> reports the exact current RC SHA with `environment=staging` and the
> migration-dependent journeys are exercised against it.


Taken against `claude/buildhub-global-release-candidate` @ `36d3954`, by reading
the code rather than the tracker. The instruction was "fresh-audit what already
exists before building anything", and the answer changes what is worth building:
**three of the six items are largely built, one is entirely absent.**

## What already exists

| Concern | Where it lives | Verdict |
|---|---|---|
| Placement grant engine | `server/vendorSponsorship.ts`, `server/placementBooking.ts` | CANONICAL — packages (BOOST/SPOTLIGHT/PREMIER), surfaces, sources, exclusivity, capacity, overlap |
| Placement vocabulary | `shared/placement.ts` | CANONICAL — `placementLabel()` already keeps FEATURED and SPONSORED apart |
| Placement analytics contract | `shared/placementAnalytics.ts` | Real — visibility fraction, dwell, the three client events, `rate()` returning null rather than a fabricated 0 |
| Event store | `analyticsEvents` table + `shared/analyticsEvents.ts` | Real — typed events, a forbidden-metadata-key list |
| Admin placement management | `AdminPlacements`, `AdminSponsorships`, `AdminCommercialAnalytics`, `PlacementPerformance` | Built |
| Marketplace rendering | `MasterPlacement.tsx` in `Marketplace` and `VendorsDirectory` | Built, with labelled badges |
| Supplier's own analytics | `VendorAnalytics` inside the `RolePlatform` workspace | Built, but buried in a workspace section |

**Item 17 (Sponsored presentation) and item 18 (real analytics foundation) are
therefore mostly DONE.** Rebuilding them would be the duplicate-system defect
§11 forbids. What they need is a discoverability and presentation pass, not a
new domain.

**Item 16 (Marketing Center)** exists on the ADMIN side and does not exist on
the SUPPLIER side. The supplier can see some of their own numbers in a
workspace section; they have no destination that answers "how is my business
being promoted, and what can I do about it".

## What does not exist at all

**Item 15, Supplier Showcase.** Nothing. The only `Showcase` in the codebase is
`client/src/pages/ComponentShowcase.tsx`, an internal design-system page with no
relation to this concept.

This is the gap, and it is the one the owner named first.

## The integrity rule Supplier Showcase must not break

§18 keeps three concepts apart, and a Showcase is the one a supplier controls
themselves:

- FEATURED — BuildHub editorial curation. Admin authority.
- SPONSORED — commercial promotion. Admin-granted, bounded, revocable.
- SUPPLIER SHOWCASE — supplier-selected emphasis **within the supplier's own
  storefront**.

The danger is precise: if a showcase selection could influence marketplace
discovery, ranking or any shared surface, a supplier would have granted
themselves a placement. That is self-issued Sponsored inventory with no admin
decision, no dates and no revocation — and it would corrupt the one ordering
rule §18 states (FEATURED → labelled SPONSORED → ORGANIC).

So the showcase is confined to the supplier's own storefront by construction,
and that confinement is the property worth testing hardest.

## Why it is a separate table and not a `vendorSponsorships` row

`vendorSponsorships` carries `grantedBy`, `grantedReason`, `revokedAt`,
`revokedBy`, `startsAt`, `endsAt`, `priority`, `package`, `surface`. Every one
of those is an ADMIN decision about a SHARED surface. A showcase has none of
them: no granting authority, no period, no priority against other suppliers,
no surface beyond the supplier's own page.

Reusing the table would mean a showcase row sitting in the same store the
placement engine reads, one missing `WHERE` clause away from becoming real
marketplace placement. §11 says reuse a canonical system; it does not say put
unlike things in one table because the columns nearly fit.

## Deployment status — unchanged and NOT claimed

- ~~`render.yaml` declares `branch: main` with `autoDeploy: true` for
  `buildhub-staging`. The RC branch is `claude/buildhub-global-release-candidate`.
  **These do not agree**, so a push to the RC does not reach staging.~~
  **SUPERSEDED** — the owner approved RC-backed staging and `render.yaml` now
  records `branch: claude/buildhub-global-release-candidate`. Struck through
  rather than deleted: the finding was true when made, and the record of it
  is why the configuration changed.
- This is reported, not fixed: changing the Render branch or source
  configuration requires owner approval and has not been made.
- Migrations 0056–0059 remain **PUSHED — applied locally, not yet
  staging-verified**. No deployed `/version` has been observed from this
  environment (Render is `connect_rejected` by organization egress policy).
- Nothing in this document or the work under it is STAGING VERIFIED.
