# BuildHub — Phase 4A Final Gate & Phase 4B Readiness Decision

Branch: `claude/phase4a-final-gate`, created from `claude/phase4a-cumulative-final-verification` @ `2568f5316c8c2664dbb547aa87ca75ce72f1a29b`. No Stripe objects created, no production configuration touched, no deploy, no publish, no merge to `main`.

---

## 1. Phase 4A task ledger

Every entry below is re-confirmed against the actual current repository (commit SHAs, test files on disk, live behavior), not copied from a prior report.

| Task | Branch | Commit | Objective | Tests | Final status |
|---|---|---|---|---|---|
| 4A.6.1 Vendor Profile | (folded into main line) | `014f055` | Public/own profile, explicit allowlist, self-scoped update | `vendorProfile.test.ts` | PASS |
| 4A.6.2 Vendor Reputation | (folded into main line) | `321c169` | Dynamic AVG/COUNT rating, eligibility, dedup | `vendorReputation.test.ts` | PASS |
| 4A.6.3 Vendor Analytics | (folded into main line) | `8ac42b1` | Self-scoped provider stats, div-by-zero safe | `vendorAnalytics.test.ts` (23 items) | PASS |
| 4A.6.4 Dashboard Integration | `claude/phase4a64-dashboard-integration` | `c374420` | Confirm real navigation reachability, remove fake stats | regression tests in same commit | PASS |
| 4A.6.5 Login Root-Cause | `claude/phase4a65-login-root-cause-fix` | `a540954` | Investigate login fresh, no assumed diagnosis | n/a (no code change) | PASS — no application defect found |
| 4A.6.6 Auth Security Hardening | `claude/phase4a66-auth-security-hardening` | `42ee99c` | Close `auth.me`/logout-revocation findings | `authSecurityHardening.test.ts` | PASS |
| 4A.6.7 Admin User Data Security | `claude/phase4a67-admin-user-data-security` | `b67d9e7` | Close `admin.users` full-row exposure | `adminUserDataSecurity.test.ts` | PASS |
| 4A.6.8 Account/Session Security | `claude/phase4a68-account-session-security` | (own commit, pre-cumulative-audit) | Frozen/deactivated re-check + revocation retention | `accountSessionSecurity.test.ts` | PASS — no defect confirmed |
| Cumulative Final Audit | `claude/phase4a68-account-session-security` | `63e8c08` | Re-verify all of 4A end-to-end; found & closed `admin.complianceQueue`/`complianceApplicant` exposure | `cumulativeAuditFindings.test.ts` | PASS with one fix applied |
| 4A.6.9 Reputation Consistency | `claude/phase4a69-reputation-consistency` | `7cc9ff7` | Fix stale reputation in quote comparison | `quotationReputationConsistency.test.ts` | PASS |
| Cumulative Final Verification | `claude/phase4a-cumulative-final-verification` | `2568f53` | Fresh re-verification; surfaced 2 new findings | (no code change) | PASS with conditions |
| **This gate** | `claude/phase4a-final-gate` | *(pending, see §5)* | Close/classify the 2 findings; final sweep; issue Phase 4A verdict | +3 tests, see §5 | **See §7** |

**Verification performed fresh in this pass** (not assumed): every branch's HEAD commit re-confirmed via `git log`; every regression-test file confirmed present on disk at current HEAD; the full suite re-run from zero.

---

## 2. Phase 4A verification status

```
npx vitest run     → 34 files, 347 tests, all passing (344 pre-existing + 3 new from this gate)
npx tsc --noEmit   → clean, 0 errors
vite build         → succeeded (26.3s)
esbuild (server)   → succeeded, dist/index.js 153.7kb
```
Live smoke test in this pass chained: admin login → clean `auth.me` → clean `admin.complianceQueue` → correct dynamic reputation on `rfq.quotations` → logout → replay rejected (401) → **new in this pass:** a non-owner rejected from `rfq.quotations` with `FORBIDDEN`, the legitimate owner still succeeds, and a browser check confirms the client no longer offers a button that would trigger the closed exposure.

---

## 3. The two new findings — investigated and classified

### Finding A — `project.spent` vs. live expense-log sum disagree

| Check | Answer |
|---|---|
| A. Real? | Yes — confirmed by source: `projects.update`'s `spent` input writes `projects.spent` directly; `projects.addExpense` only inserts into the separate `expenses` table and never touches `spent`. |
| B. Reproducible? | Yes, deterministically: log an expense, `spent` does not change. |
| C. User-visible? | Yes — `HomeownerDashboard.tsx`/`RolePlatform.tsx` show `project.spent`; `ProjectDetail.tsx` shows a live sum of `expenses`. Two real screens, two different numbers. |
| D. Security-related? | No. |
| E. Data-integrity/correctness issue? | Yes — the two figures can genuinely disagree. |
| F. Single authoritative source already established? | **No.** Unlike the reputation bug, both fields are *actively written* by real, intentional user actions — neither is dead code. There is no prior phase decision declaring one of them "the" definition. |
| G. Fix technically clear? | No — it's ambiguous whether `spent` should be a manual budget estimate (a legitimate, separate concept) or should auto-derive from the expense log. |
| H. Bounded and safe? | A fix is mechanically bounded, but choosing a direction silently redefines what "Total Spent" means for every existing project — a behavior change, not a pure bug fix. |
| I. Requires a business decision? | **Yes** — what should "amount spent" mean on this platform. |
| J. Requires a migration? | Only if the resolution is "drop the column and always compute from `expenses`" — undetermined until I is answered. |

**Classification: OWNER DECISION REQUIRED.** Not fixed. This does not block Phase 4A close-out (it is a pre-existing project-management display inconsistency, unrelated to authentication, authorization, or monetization data), but it should be resolved before or during Phase 4B if "amount spent" ever feeds a billing or reporting surface.

### Finding B — dead `products.rating`/`products.reviewCount` columns

| Check | Answer |
|---|---|
| A. Real? | Yes — the columns exist in `drizzle/schema.ts`. |
| B. Reproducible? | Yes — trivially, by grep. |
| C. User-visible? | **No.** Repo-wide search found zero readers and zero writers anywhere in `server/` or `client/src/`. No product-review feature exists — the `reviews` table is keyed by `revieweeId` (vendor/user reputation only), not `productId`. |
| D. Security-related? | No. |
| E. Data-integrity/correctness issue? | No live one — nothing ever displays these values, so no user ever sees incorrect data from them. |
| F. Single authoritative source already established? | N/A — there is no competing display to reconcile. |
| G. Fix technically clear? | The only "fix" is dropping unused columns, which is schema surgery for zero current user-facing benefit. |
| H. Bounded and safe? | Dropping columns is mechanically safe but touches the schema/migration surface (adjacent to the protected Phase 3C migration) for a change with no live impact. |
| I. Requires a business decision? | Only if BuildHub decides to build a product-review feature later — not to leave the columns alone. |
| J. Requires a migration? | Only if dropped. |

**Classification: DEFER — LOW RISK / NON-BLOCKING.** Not fixed. This is inert technical debt, not a defect — it fails the "is it user-visible / does real data disagree" bar that made the reputation bug (and Finding A) worth acting on.

---

## 4. Additional blockers found by the final sweep (Objective 3)

One additional, real, in-scope issue was found and is reported here as required — and was closed in this same pass, not merely logged, because it met every "fix now" criterion:

### Finding C — `rfq.quotations` had no ownership check (IDOR)

While re-sweeping "quotation ownership" as explicitly named in this task's Objective 3, direct source and live testing showed `rfqRouter.quotations` (`protectedProcedure`, no ownership check on `input.rfqId`) let **any authenticated user** — including a competing vendor — pull the full quotation list for **any RFQ on the platform**, not just their own: every bidding vendor's email address, exact price, timeline, warranty terms, and private notes. Confirmed **live and reachable**, not theoretical: `client/src/pages/RFQPage.tsx` rendered a "View Details" button for RFQs the viewer does not own, wired to the same `QuotationComparison` component that also displays the full bid table — so this was one click away for any signed-in user on the live site, not merely an unused API surface.

Run through the same A–J framework used above: real (A), reproducible (B), user-visible (C), **security-related (D — yes)**, correctness issue (E), and critically — **F: yes, a single authoritative pattern already exists** (every other project/RFQ-scoped query in this file, e.g. `projects.get`, `projects.expenses`, `projects.dailyLogs`, already gates on `ownerId === ctx.user.id`); **G: fix technically clear** (apply the same established pattern); **H: bounded and safe** (one added check, no schema change); **I: no business decision needed**; **J: no migration needed**. This is exactly the "fix now, don't defer a live security exposure discovered in the surface being audited" case both the current protocol and this task's own Objective 3 describe.

**Fixed in this pass:**
- `server/routers.ts` — `rfq.quotations` now looks up the RFQ's `requesterId` first and throws `FORBIDDEN` unless it matches `ctx.user.id`, before running the quotations query.
- `client/src/pages/RFQPage.tsx` — removed the non-owner "View Details" button (it would now only ever open a permanently-empty/forbidden dialog); the RFQ card simply shows no action button for RFQs the viewer doesn't own. No new feature was built to replace it — that would be scope expansion beyond a security fix.
- 3 new regression tests in `server/quotationReputationConsistency.test.ts`: non-owner rejected, non-existent RFQ rejected, legitimate owner still succeeds (regression guard against over-blocking).

**Live-verified**, real dev server + MariaDB: a real non-owner account (`testother`) received `403 FORBIDDEN "You do not own this RFQ"`; the real owner (`testhomeowner`) received the full, correct quotation list including the already-fixed dynamic reputation (`4.5`/`2`). Browser check confirmed the client no longer offers the button that led to this endpoint for a non-owner, and the RFQ list page still renders cleanly with no layout break.

No other gap of this kind was found in the areas swept: authentication, authorization, sensitive-data exposure, storage access, admin data exposure, project ownership, review authorization, vendor-reputation consistency, analytics isolation, session revocation, and account freeze/deactivation all re-checked against source and/or the existing (unmodified, still-passing) regression suite and found intact. Arabic/RTL and mobile were not re-visually-verified in this pass (no UI surface changed except removing one button, which was confirmed by screenshot not to break layout) — see §6.

---

## 5. Fixes performed in this gate

```
modified:   server/routers.ts                                  (rfq.quotations ownership check)
modified:   client/src/pages/RFQPage.tsx                        (remove non-owner action button + unused import)
modified:   server/quotationReputationConsistency.test.ts       (mock updated for the new query + 3 new tests)
new file:   BUILDHUB_PHASE4A_FINAL_GATE_AND_PHASE4B_READINESS.md
```
No other file touched. `drizzle/schema.ts` and every migration file remain untouched. Findings A and B above were **not** fixed, per their classification.

---

## 6. Remaining deferred findings (full current list)

| ID | Finding | Classification |
|---|---|---|
| A | `project.spent` vs. live expense-log sum can disagree | OWNER DECISION REQUIRED |
| B | Dead `products.rating`/`reviewCount` columns | DEFER — low risk |
| D1 | Admin-freeze exemption: a frozen admin keeps full access | Intentional, documented, test-locked — not a defect |
| D2 | `revokedSessions` rows are never pruned | DEFER — not a current-scale concern |
| D3 | `providerRole` not localized in the Arabic quote-comparison view | DEFER — cosmetic |
| D4 | "1 Completed Projects" does not pluralize | DEFER — cosmetic |

Arabic/RTL and mobile (375px/768px/1280px) were last visually re-verified with real screenshots in the Cumulative Final Audit and 4A.6.9 reports; this gate's only UI change (removing one button) was confirmed by a fresh screenshot not to disturb layout, but a full re-pass of every breakpoint/language combination was not repeated, since no translated or RTL-sensitive markup changed.

---

## 7. Final Phase 4A decision

# **PHASE 4A — PASS WITH CONDITIONS**

**Why not an unconditional PASS:** Finding A (`project.spent` vs. expense-log inconsistency) remains open and requires an owner decision — it is a real, user-visible correctness issue, even though it does not block Phase 4B on its own.

**Why this is not NOT READY:** every finding that was security-relevant, live-reachable, and technically unambiguous — the auth/session/admin-data findings across 4A.6.6–4A.6.7, the cumulative audit's compliance-endpoint finding, the 4A.6.9 reputation bug, and this gate's `rfq.quotations` IDOR — has been fixed, tested, and live-verified. Zero CRITICAL or HIGH findings remain open. The two remaining conditions are explicitly non-blocking:

- **Condition 1 (Finding A):** does **not** block Phase 4B — vendor-subscription monetization does not depend on project expense-tracking semantics. Should be resolved before this data is ever exposed in a billing/reporting context.
- **Condition 2 (Finding B):** does **not** block Phase 4B — inert schema, zero live impact.

Phase 4A's core deliverable — a vendor can build a profile, be discovered, be reviewed, show real reputation and analytics, all securely isolated, with hardened authentication — is code-complete, tested (347/347), and live-verified end to end.

---

## 8. The exact 8 owner decisions blocking Phase 4B

None of these were decided on your behalf. No prices, tiers, trial length, refund policy, cancellation policy, or featured-placement pricing were invented anywhere in this engagement.

### Decision 1 — Vendor subscription price(s)
1. **Decision:** What does a vendor pay, and in what billing interval (monthly/annual)?
2. **Why it matters:** No Stripe Price object, no checkout session, no entitlement check can be built without a number.
3. **Recommended option:** None offered — this is a market-pricing call outside engineering's competence.
4. **Alternatives:** Single flat price; tiered pricing (see Decision 2); usage-based pricing (not indicated by anything built so far).
5. **Engineering consequence:** Determines whether the data model needs one `price_id` or several.
6. **Business consequence:** Directly sets vendor unit economics and conversion.
7. **Costly to change later?** Price *amount* changes are cheap in Stripe (new Price object, existing subscribers can be grandfathered). Changing the *billing model* (flat → tiered → usage) after real subscribers exist is expensive and requires a migration plan.

### Decision 2 — Number of tiers and what each unlocks
1. **Decision:** Is there one paid tier, or several (e.g., Basic/Pro)? What feature/limit differs per tier?
2. **Why it matters:** Directly shapes the entitlements table and every `approvedProviderProcedure`-style gate that would need to check tier, not just "subscribed: yes/no."
3. **Recommended option:** None offered.
4. **Alternatives:** Single tier (simplest to ship first); multi-tier from day one.
5. **Engineering consequence:** Single tier = one boolean entitlement flag. Multi-tier = an entitlements table keyed by feature, checked per-tier.
6. **Business consequence:** Multi-tier gives room to upsell; single tier is faster to launch and simpler to explain.
7. **Costly to change later?** Going from single-tier to multi-tier later is a moderate rework (new entitlement checks scattered across routers) but not a full redesign if the entitlement check is centralized from the start (see §11 4B.8).

### Decision 3 — Trial: yes/no, and duration
1. **Decision:** Does a new vendor get a free trial before being charged? How long?
2. **Why it matters:** Affects the Stripe subscription's `trial_period_days`, the signup flow's messaging, and whether a vendor can use paid features before a card is charged.
3. **Recommended option:** None offered.
4. **Alternatives:** No trial (simplest); a fixed trial (e.g., 14/30 days); trial requiring a card up front vs. not.
5. **Engineering consequence:** A trial with no card on file means entitlement can be granted before any Stripe customer/subscription exists — a different code path than "subscribe immediately."
6. **Business consequence:** Trials increase signups but can dilute paid conversion; card-required trials convert better but add signup friction.
7. **Costly to change later?** Cheap — a Stripe subscription-level setting, not an architectural commitment.

### Decision 4 — Featured placement: bundled or separate add-on
1. **Decision:** Is featured/priority placement included in a subscription tier, or purchased separately (one-time or recurring)?
2. **Why it matters:** Determines whether this is one Stripe Product with tiered Prices, or two separate Products (subscription + add-on), and whether the entitlement model needs a second, independent flag.
3. **Recommended option:** None offered.
4. **Alternatives:** Bundled into a higher tier; a separate recurring add-on; a separate one-time purchase (e.g., "featured for 30 days").
5. **Engineering consequence:** A one-time add-on needs different state-tracking (an expiry date, not a subscription status) than a recurring one.
6. **Business consequence:** Bundling simplifies the vendor's decision; a separate add-on creates an additional revenue line but a more complex purchase flow.
7. **Costly to change later?** Moderate — the data model for "is this vendor featured right now" differs meaningfully between a subscription-tier flag and a time-boxed purchase.

### Decision 5 — Refund policy
1. **Decision:** Under what conditions, if any, does BuildHub issue refunds, and how (full/partial, self-service/support-mediated)?
2. **Why it matters:** Needed before any Stripe refund-handling or support-facing admin tooling is written; also needed for the Terms of Service text shown at checkout.
3. **Recommended option:** None offered — this is a legal/business policy call.
4. **Alternatives:** No refunds; refunds within N days; case-by-case via support only.
5. **Engineering consequence:** Self-service refunds need a UI and a Stripe refund API call with authorization; support-mediated refunds need only admin tooling.
6. **Business consequence:** Generous refund policies reduce chargeback risk and build trust; they also reduce realized revenue.
7. **Costly to change later?** Cheap technically; costly reputationally if changed after being communicated to vendors.

### Decision 6 — Cancellation policy
1. **Decision:** Does cancellation take effect immediately (lose access now) or at the end of the current billing period (keep access until it lapses)?
2. **Why it matters:** Changes the subscription state-transition logic and what "entitled" means the moment a vendor clicks cancel.
3. **Recommended option:** None offered — though note Stripe's own default (`cancel_at_period_end`) is the more common industry pattern.
4. **Alternatives:** Immediate loss of access; access retained until period end; prorated refund + immediate loss.
5. **Engineering consequence:** End-of-period cancellation requires tracking a "cancels at" date and continuing to serve entitlement until then; immediate cancellation is simpler but harsher.
6. **Business consequence:** End-of-period is the market norm and reduces cancellation-driven support complaints.
7. **Costly to change later?** Cheap — a Stripe subscription-update parameter, not a schema change.

### Decision 7 — Currency/region confirmation
1. **Decision:** Confirm EGP-only launch (as assumed throughout this engineering track), or should another currency/region be supported at launch?
2. **Why it matters:** Sets the Stripe Product/Price currency and whether multi-currency logic is needed at all.
3. **Recommended option:** EGP-only for launch, matching every prior phase's assumption and the platform's existing EGP-denominated project/quotation data.
4. **Alternatives:** Multi-currency from day one (adds real complexity for no confirmed demand yet).
5. **Engineering consequence:** Single-currency is a materially simpler Stripe integration (no currency-conversion, no per-region tax handling).
6. **Business consequence:** Matches the platform's current Egypt-market focus; expanding later is additive, not a rewrite.
7. **Costly to change later?** Cheap to add a second currency later if the entitlement model doesn't hard-code EGP; would need to confirm the eventual implementation avoids hard-coding.

### Decision 8 — Stripe account access
1. **Decision:** Provide a Stripe account (test-mode keys at minimum to start building; live keys only when actually launching) and a webhook signing secret.
2. **Why it matters:** No integration code can be tested end-to-end, including webhook signature verification, without real (even if test-mode) credentials.
3. **Recommended option:** Test-mode API key + a test-mode webhook endpoint/secret to begin 4B.1–4B.7; live keys deferred until Phase 6's final security audit passes and you explicitly authorize production payment configuration.
4. **Alternatives:** None — this is an access requirement, not a design choice.
5. **Engineering consequence:** Blocks all of §11's 4B.2 onward until provided.
6. **Business consequence:** None beyond the account-creation step itself.
7. **Costly to change later?** N/A.

---

## 9. Phase 4B technical prerequisites

**A. Engineering-ready items** (code-complete, nothing further needed from an engineering standpoint before 4B can start once decisions land):
- Authentication/session architecture (per-token revocation, live account-state re-check) — hardened and verified, reusable as-is for gating paid features.
- User/vendor identity model (`users.userRole`, `providerRoles`) — sufficient to attach a subscription/entitlement record to.
- Admin tooling pattern (`adminProcedure`, explicit-allowlist convention) — reusable for a future admin subscription-management screen.
- Notification pipeline (`notifyUser`/`notifyUsers`) — reusable for subscription lifecycle notifications (renewal, payment failure, etc.) once in-app notification content is decided.

**B. Owner business decisions** — the 8 items in §8, all currently unresolved.

**C. External access/configuration requirements:**
- Stripe account + API keys (test-mode to start; §8 Decision 8).
- A webhook endpoint reachable from Stripe (requires real, non-sandbox hosting — see Phase 5, not yet established).
- Decision on where webhook secrets/API keys live in this environment's secret management (not yet configured anywhere in this codebase).

**D. Items that must not be started yet:**
- Any Stripe Product/Price/webhook object creation.
- Any production payment configuration.
- Any UI copy stating specific prices, trial lengths, or policy language not yet decided.
- Any database migration for the monetization data model (§11, 4B.1) — the *shape* can be designed once tiers are decided, but should not be applied until the decisions in §8 are final, to avoid a schema rework.

---

## 10. Phase 4B implementation sequence (prepared, not started)

This is a plan only. Nothing below has been implemented, and none of it will begin until you resolve §8 and explicitly say to proceed.

1. **4B.1 — Monetization data model.** A `vendorSubscriptions` table (or equivalent): `userId` FK, Stripe `customerId`/`subscriptionId`, tier, status, current period end, cancel-at flag. Depends on Decisions 1, 2, 6.
2. **4B.2 — Stripe architecture.** Server-side-only secret usage (never in client bundle); a dedicated `stripe.ts` module mirroring the existing `oauth.ts`/`storage.ts` external-service pattern already in this codebase.
3. **4B.3 — Subscription products/prices.** Create Stripe Products/Prices matching Decisions 1, 2, 4, 7 (test-mode first).
4. **4B.4 — Checkout.** A `subscription.createCheckoutSession` procedure using Stripe Checkout (not a custom card form — avoids PCI scope). Depends on Decision 3 (trial config).
5. **4B.5 — Customer portal.** Stripe's hosted Customer Portal for self-service plan changes/cancellation, configured per Decision 6.
6. **4B.6 — Webhook security/idempotency.** Signature verification (`stripe.webhooks.constructEvent`), an idempotency table/check so a replayed or duplicated webhook event is a no-op, not a double-processed one.
7. **4B.7 — Subscription state synchronization.** Webhook handlers (`checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`) writing to the table from 4B.1 — the webhook, not the client, is the source of truth for subscription state.
8. **4B.8 — Entitlements.** A single, centralized entitlement-check helper (mirroring `approvedProviderProcedure`'s existing middleware pattern) so every gated feature checks one function, not scattered ad-hoc logic — directly informed by whether Decision 2 is single- or multi-tier.
9. **4B.9 — Vendor subscription UI.** A plan/billing screen in the vendor dashboard (English + Arabic, RTL, mobile) showing current plan, renewal date, and a portal-session link.
10. **4B.10 — Admin subscription management.** Read-only visibility for admins into vendor subscription status (reusing the `ADMIN_USER_LIST_COLUMNS`-style allowlist discipline — never expose Stripe secrets or raw customer objects).
11. **4B.11 — Featured-placement entitlement**, if Decision 4 approves it as a distinct feature.
12. **4B.12 — Payment failure/cancellation/refund handling.** Dunning messaging on `invoice.payment_failed`, access changes per Decision 6, refund flow per Decision 5.
13. **4B.13 — Security audit.** Re-run the same class of review this engagement has applied throughout: no client-controlled entitlement bypass, no webhook replay, no secret exposure, admin-only where appropriate.
14. **4B.14 — Full E2E verification.** Checkout, trial, renewal, payment failure, cancellation, refund, webhook replay/duplicate, unauthorized entitlement access — each with real (test-mode) Stripe evidence, matching this engagement's live-verification standard throughout.

---

## 11. External access requirements

- Stripe account (test-mode keys now; live keys only after your explicit production authorization).
- Webhook-reachable hosting (Phase 5 — not yet established; this sandbox cannot receive inbound Stripe webhooks).
- Secret-management decision for where API keys/webhook secrets are stored in whatever environment ends up hosting this.

None of this exists yet and none of it is assumed to exist — Phase 4B cannot be verified end-to-end (webhooks specifically) until real, reachable hosting exists, which is a Phase 5 concern.

---

## 12. Exact next action required from you

**WHAT IS DONE:** Phase 4A's full feature set (vendor profile, reputation, analytics, dashboard integration) and every authentication/session/admin-data security finding discovered across the engagement — six real security findings, all fixed, tested, and live-verified, most recently an IDOR in `rfq.quotations` found and closed in this same gate. 347/347 tests passing, clean `tsc`, both builds succeeding, all five protected branches confirmed untouched.

**WHAT IS NOT DONE:** The `project.spent`-vs-expense-log inconsistency (Finding A) remains open, pending your decision on what "amount spent" should mean. Phase 4B has not been started — no code, no Stripe objects, no data model.

**WHAT IS BLOCKING:** Nothing blocks closing Phase 4A. Phase 4B is blocked entirely on the 8 decisions in §8, plus the external access items in §11 (Stripe keys; real webhook-reachable hosting, which itself is a Phase 5 dependency).

**WHAT YOU MUST DECIDE:** The 8 items in §8 (prices, tiers, trial, featured-placement bundling, refund policy, cancellation policy, currency confirmation, and providing Stripe test-mode access) — plus, separately and not blocking, how "amount spent" should be defined for Finding A.

**WHAT I WILL DO AFTER YOU DECIDE:** Once §8's decisions are resolved and Stripe test-mode access is provided, I will begin §10 in order (4B.1 → 4B.14), each step tested, live-verified, and reported the same way every phase in this engagement has been — and will stop again before any live/production Stripe configuration or deployment, per this task's own instructions.

---

## Final status

**PHASE 4A — PASS WITH CONDITIONS.** Technically clear to plan Phase 4B; not clear to implement it until the decisions above are made.
