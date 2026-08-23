# BuildHub — Staging QA Checklist

Run this against staging once it exists, before anything is pointed at
production. It is written against BuildHub's actual 26 routes, 7 roles and 3
plans — not a generic template — so every line is checkable and every failure
means something specific.

**Before starting:** `node scripts/smoke.mjs https://staging.example.com` must
pass 9/9. If it does not, stop; the deploy is broken and the rest of this is
noise.

Run everything in **both English and Arabic**, and at **1440px and 375px**.
Arabic is not a translation pass — the layout mirrors, and RTL bugs hide in
alignment, icon direction, and number formatting.

---

## 1. The deployment itself

- [ ] `/healthz` returns 200
- [ ] `/readyz` returns 200 — if 503, the database is unreachable or `DATABASE_SSL` / `DATABASE_CA_CERT` are wrong
- [ ] Stop the database; `/readyz` returns 503 and `/healthz` stays 200. Restart it; `/readyz` recovers **without restarting the app**
- [ ] TLS certificate is valid and not self-signed (the browser shows no warning)
- [ ] HTTP redirects to HTTPS
- [ ] Response headers carry CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`
- [ ] No `X-Powered-By`
- [ ] `/robots.txt` served
- [ ] View source: **no `%VITE_` placeholders** anywhere
- [ ] `/404` and an unknown path both render the not-found page, not a stack trace
- [ ] Server logs contain no request bodies, cookies, tokens or passwords

## 2. Registration and sign-in

- [ ] `/auth` loads for a signed-out visitor **without redirecting**
- [ ] Register a homeowner; land on the homeowner platform
- [ ] Register a contractor; land on `/compliance` (professional roles gate on approval)
- [ ] Duplicate username rejected; duplicate email rejected
- [ ] Password below the minimum rejected, with a message saying why
- [ ] Sign out; the session is genuinely dead (reload → signed out)
- [ ] Sign in with **username**; sign in with **email**
- [ ] Wrong password rejected with the same message as an unknown user — no account oracle
- [ ] Repeat wrong passwords → rate limited, with a retry-after
- [ ] Session cookie has `HttpOnly`, `Secure`, `SameSite=None` (DevTools → Application → Cookies)

## 3. Password reset — only if SMTP is configured

- [ ] `auth.capabilities` reports `passwordReset: true`; if `false`, SMTP failed to verify at boot — check the startup log
- [ ] Request a reset; **the email actually arrives** (check spam)
- [ ] The email passes SPF, DKIM and DMARC (Gmail → Show original)
- [ ] The link opens `/auth/reset-password` and sets a new password
- [ ] The **old** password no longer works; the new one does
- [ ] **A session open in another browser is logged out** by the reset
- [ ] The link cannot be used twice
- [ ] An expired link is refused
- [ ] Requesting a reset for an unknown address returns the same success — no account oracle

## 4. Compliance onboarding

- [ ] As a contractor, `/compliance` lists the role's required documents
- [ ] Upload a PDF and a JPEG — both accepted
- [ ] **Upload an SVG — refused.** Rename it to `.png` and set `image/png` — still refused
- [ ] Upload an HTML file labelled `image/png` — refused
- [ ] Over-size file refused with a clear message
- [ ] Status moves to `under_review`
- [ ] As admin, the applicant appears in the compliance queue
- [ ] Approve; the vendor's status becomes `approved` and they can reach their platform
- [ ] Reject with a note; the applicant sees the note
- [ ] Request an update; the applicant can re-upload with an explanatory note
- [ ] Bulk approve/reject only affects genuinely pending applications
- [ ] CSV export downloads and opens in a spreadsheet

## 5. Marketplace and directories

- [ ] `/marketplace` hub, `/marketplace/products`, `/marketplace/vendors`, `/marketplace/designers`, `/marketplace/finishing` all load
- [ ] Product detail loads; a **deactivated** product 404s
- [ ] Ask a question on a product; it appears — **without exposing who asked**
- [ ] Vendor directory shows real approved vendors only: no dummy, frozen, deactivated or unapproved accounts
- [ ] Ratings match the vendor's actual reviews (not a stored column)
- [ ] Category and location filters work
- [ ] **Sponsored strip**: a premium vendor appears there *and* in the organic list below
- [ ] The sponsored label is clearly distinct from the verified badge
- [ ] The page states the placement is paid
- [ ] Downgrade the vendor to free → they leave the strip, and the organic order is **unchanged**

## 6. RFQ and quotations

- [ ] Signed out, `/rfq` does **not** bounce to `/auth`
- [ ] As a homeowner, post an RFQ with a budget, category, location and attachment
- [ ] Attach a marketplace product; the reference survives a reload (this is engine-dependent — verify it on staging's actual database)
- [ ] As an approved contractor, the RFQ appears and a quotation can be submitted
- [ ] As the homeowner, compare quotations side by side
- [ ] Accept one → it becomes accepted, the others rejected, and a second accept is refused
- [ ] **As an unrelated third user, accepting that quotation is refused**
- [ ] Qualified-enquiry counter increments; at the plan limit, further enquiries are refused with an upgrade prompt
- [ ] Re-opening an already-consumed enquiry does **not** consume a second

## 7. Billing

- [ ] `/pricing` loads **signed out** without redirecting
- [ ] Prices read EGP 499 / 4,990 and 999 / 9,990; Arabic renders `٤٩٩` and `٤٬٩٩٠`
- [ ] Founder pricing shows as monthly-only
- [ ] Unbuilt entitlements are badged "coming soon", not advertised
- [ ] Checkout is absent, and the page says why
- [ ] As a vendor, the billing panel shows the plan, state and enquiry allowance
- [ ] Start a trial (admin) → the vendor sees `TRIALING` and the correct end date
- [ ] Cancel → `CANCELLATION_SCHEDULED`, **access retained**, and the copy says nothing is deleted
- [ ] Resume → `ACTIVE`, both cancellation fields cleared
- [ ] Cancel twice → the second is a no-op reported as success, not an error
- [ ] Admin `/admin/billing` shows lifecycle state and **no provider handle**

## 8. Messaging, projects, notifications

- [ ] Send a message between two accounts; both see the thread
- [ ] Attach a file; it downloads for both parties and **401s for a third**
- [ ] Share a quotation you are party to — works. Share one you are not — refused, with the same answer as a nonexistent id
- [ ] Create a project, milestone, task, expense, daily log, progress report
- [ ] **Another user cannot open that project by id**
- [ ] Notifications appear, unread count is right, mark-all-read works

## 9. Admin

- [ ] `/admin` refuses a non-admin
- [ ] User list loads; **no `passwordHash` or `invitationToken` in the network response** (check DevTools, not the UI)
- [ ] Freeze an account with a reason → that user is signed out and cannot sign back in
- [ ] Unfreeze → they can
- [ ] Create a user with an invitation → the link sets a password → **that user can then sign in** (this path was broken before Slice 3)
- [ ] Analytics: the funnel counts match reality, and every figure with no basis shows an em dash — **not zero**
- [ ] Commercial KPIs: a trialing vendor contributes **0** to MRR; a paying one contributes their catalogue price
- [ ] Audit log exports

## 10. Cross-cutting

- [ ] Every page in Arabic: layout mirrors, no clipped text, no Latin-only strings
- [ ] At 375px: **no horizontal scrolling anywhere**
- [ ] Language toggle persists across a reload
- [ ] Avatars render (this was broken by a missing authorization branch — verify visually)
- [ ] Trigger a server error and confirm the user sees a generic message with **no stack trace**
- [ ] Browser console has no uncaught errors on any route

## 11. Before promoting to production

- [ ] Every box above ticked, in both languages, at both widths
- [ ] Restore drill run against staging: `RESTORE_TARGET_DB=buildhub_drill RESTORE_ASSUME_YES=1 ./restore-backup.sh`
- [ ] A deliberate rollback rehearsed: release, roll back, confirm the previous image serves
- [ ] Staging and production use **different** databases, storage buckets, JWT secrets and SMTP senders
- [ ] No staging credential appears in the production environment
- [ ] Vultr's own scheduled backups confirmed enabled, with a known retention window
