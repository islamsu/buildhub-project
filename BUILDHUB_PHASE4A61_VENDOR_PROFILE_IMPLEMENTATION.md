# BuildHub — Phase 4A.6.1: Vendor Profile Implementation

Scope: only the Vendor Profile foundation (Phase 4A.5 §2), following the Phase 4A.5 implementation plan. Reputation, Analytics, Stripe, subscriptions, payments, email/SMS, featured-vendor monetization, pricing, commission, and lead fees were explicitly not touched.

---

## What was implemented

**Backend** (`server/routers.ts`, new `profileRouter`, mounted as `appRouter.profile`):
- `profile.getPublic({ userId })` — `protectedProcedure`. Returns an explicit allowlist (`id`, `name`, `bio`, `avatar`, `location`, `userRole`, `verified`, `createdAt`, plus a computed `completedProjects` count) for provider-role accounts only; a non-provider or nonexistent `userId` gets the identical `NOT_FOUND` error, so the endpoint can't be used to enumerate which accounts exist.
- `profile.getOwn()` — `protectedProcedure`, same field set, scoped to `ctx.user.id`.
- `profile.update({ bio?, location? })` — `protectedProcedure`. No `userId` (or any target-account field) exists anywhere in the input schema, so there is no field a caller could populate to affect another account — this is a structural guarantee, not a runtime check.
- `profile.uploadAvatar({ contentType, base64 })` — `protectedProcedure`, image-only, ≤2MB, reuses the existing `storagePut` S3-proxy pattern already used by compliance-document uploads.

**Frontend:**
- `client/src/pages/VendorProfile.tsx` (new) — public-facing profile view at `/vendor/:id` (registered in `client/src/App.tsx`), with loading/sign-in-required/not-found/loaded states.
- `client/src/pages/ProviderDashboard.tsx` (modified) — a new "My Profile" card with view and edit modes (avatar upload, bio, location), wired to `getOwn`/`update`/`uploadAvatar`.
- `client/src/contexts/LanguageContext.tsx` (modified) — 19 new `profile.*` keys added to both the English and Arabic maps.

**Database changes:** none. Per Phase 4A.5 §2/§6, `bio`, `avatar`, and `location` already existed on `users` and were simply unused; no migration was needed or created, and `drizzle/0012_broken_nightmare.sql` (the Phase 3C FK migration) was not touched.

---

## Files changed

| File | Change |
|---|---|
| `server/routers.ts` | New `profileRouter` (4 procedures) + mounted in `appRouter` |
| `client/src/pages/VendorProfile.tsx` | New file — public profile page |
| `client/src/pages/ProviderDashboard.tsx` | New "My Profile" section (view/edit) |
| `client/src/App.tsx` | New `/vendor/:id` route |
| `client/src/contexts/LanguageContext.tsx` | 19 new key pairs (English + Arabic) |
| `server/vendorProfile.test.ts` | New file — 19 tests |

---

## Security controls

Directly implementing Phase 4A.5/4A.6.1's explicit requirements:

- **Explicit column allowlist**, never `select().from(users)` — verified both by a source-inspection test (`server/vendorProfile.test.ts`) and by a live call against a real database (below) confirming `passwordHash`, `email`, `phone`, `invitationToken`, `frozenReason`, and every other private field are absent from the response object, not just unused.
- **`update`/`uploadAvatar`/`getOwn` are self-only by construction** — no `userId` input field exists on any of them. Verified live: a request that smuggled `"userId": 2` into `profile.update`'s body still updated only the authenticated caller's own row; the targeted account's data was confirmed unchanged in the database afterward.
- **No user enumeration**: a non-provider account (e.g., a homeowner) and a nonexistent account ID both produce the identical `NOT_FOUND` / "Vendor profile not found" response from `getPublic` — verified live against a real seeded homeowner account.
- **Mass-assignment protection**: Zod strips unknown/unauthorized keys (`passwordHash`, `role`, etc.) from `update`'s input by default; verified in tests that a forced extra field never reaches the database write.
- **Unauthenticated access**: `getPublic` requires sign-in — this was the safer of the two options Phase 4A.5 explicitly left as an unresolved owner decision (§18 item 1 of that report), and it was **not silently chosen as final** — see "Remaining owner decisions" below. Verified live and in the browser: an unauthenticated visit to `/vendor/1` shows a clean "please sign in" prompt, never a raw authorization error.
- **Input validation**: `bio` capped at 1000 characters, `location` at 255 (matching the `users.location` column's own `varchar(255)` limit), avatar content-type restricted to `image/*`, avatar size capped at 2MB — all enforced server-side via Zod/explicit checks, not just client-side.

---

## Tests added

`server/vendorProfile.test.ts` — 19 tests, covering every item on the phase's required list (1–12) plus the localization/responsive checks (13–15):

1–2. Vendor retrieves and updates own profile.
3. `update`/`getOwn` have no `userId` field in their input schema at all (source-inspected) and a smuggled one has no effect (mock-verified).
4–9. Public profile returns exactly the allowlisted fields; explicit assertions that `passwordHash`, `invitationToken`, `email`, `phone`, `frozenReason`, and other private fields are never present on the response object.
10. Unauthenticated callers are rejected by `getPublic`/`getOwn`/`update`.
11. Invalid input (oversized bio, non-positive/non-integer `userId`, non-image avatar content type, oversized avatar) is rejected.
12. Unauthorized/unknown fields (`passwordHash`, `role`, smuggled `userId`) never reach the database write.
13–14. A dedicated localization test asserts every new `profile.*` key exists in **both** the English and Arabic maps (not just that keys exist somewhere).
15. Source-pattern checks confirm the new sections avoid fixed-pixel widths and use responsive utility classes (`sm:grid-cols-2` etc.), consistent with this repo's existing (non-visual-regression) approach to verifying responsive intent.

---

## Test results

| Check | Result |
|---|---|
| New tests (`vendorProfile.test.ts`) | 19 / 19 passing |
| Full suite | **230 / 230 passing** (211 pre-existing + 19 new), 0 failed, 0 skipped |
| TypeScript (`tsc --noEmit`) | 0 errors |
| Frontend build (`vite build`) | Succeeded (pre-existing bundle-size warning only, unrelated to this change) |
| Server build (`esbuild`) | Succeeded, `dist/index.js` 144.5kb |

---

## Real browser/database verification (not just mocked tests)

Beyond the automated suite, this phase started a real local server (disposable MariaDB instance, the same one from Phase 3C, restarted for this purpose) and drove it with a real browser (Playwright, Chromium) and direct HTTP calls, to get genuine evidence rather than relying on mocks alone:

- **Live end-to-end profile edit**: signed in as a real seeded dummy contractor account, called `profile.update` over real HTTP against the real running server and real database — `bio`/`location` persisted correctly, then confirmed via a direct `SELECT` against the database.
- **Live IDOR/mass-assignment proof**: sent a request with `"userId": 2"` (a different, real, seeded homeowner account) smuggled into `profile.update`'s body — the call succeeded, but only account 1's (the authenticated caller's) `bio` changed; a `SELECT` immediately after confirmed account 2's `bio` was still `NULL`, untouched.
- **Live enumeration-resistance proof**: called `profile.getPublic` for the real homeowner account's ID — got the identical `NOT_FOUND` / "Vendor profile not found" response as a nonexistent ID.
- **Live private-field-exposure check**: inspected the raw JSON response of a real `getPublic` call — confirmed only the intended allowlisted fields were present.
- **Live avatar validation**: confirmed a non-image content type is rejected with a clean 400 before ever reaching storage; confirmed a valid small PNG passes validation and reaches the storage layer (which then fails only because `BUILT_IN_FORGE_API_URL`/`BUILT_IN_FORGE_API_KEY` aren't configured in this sandbox — the same pre-existing, out-of-scope infrastructure gap that affects every other upload feature in this codebase, e.g. compliance documents; not a defect introduced here).

---

## Arabic/English verification

Beyond the automated key-parity test, verified live in a real browser:
- The public vendor profile page renders correctly in English, then in Arabic after using the app's own language toggle — confirmed `document.documentElement.dir` actually becomes `"rtl"`, and every new string (`profile.verified_badge`, `profile.member_since`, `profile.completed_projects`, `profile.bio_label`, `profile.empty_bio`, etc.) rendered as real Arabic text, not a fallback or a raw key, with the layout correctly mirrored (avatar/badges on the right, back-arrow pointing right).
- No hardcoded English string was left in the new `VendorProfile.tsx` page or the new profile section of `ProviderDashboard.tsx`.

---

## Responsive verification

Verified live at exactly the three required breakpoints (375px, 768px, 1280px), in both languages, via real screenshots:
- **No horizontal overflow** at any breakpoint (`document.documentElement.scrollWidth > clientWidth` checked programmatically and confirmed `false` at every size, in every screenshot run).
- Layout correctly reflows: the info grid (location / member-since / completed-projects) stacks to a single column below the `sm` breakpoint; the vendor name truncates cleanly rather than overflowing on narrow viewports; badges wrap correctly.
- Touch targets (buttons, avatar-change control) use the existing shadcn/Radix button sizing already used throughout the app — no new, undersized custom controls were introduced.

---

## Known limitations

**The most important finding from this phase, discovered only through real browser testing, not visible from source review alone:**

**`ProviderDashboard.tsx` — the exact file this phase was instructed to add the profile-editing section to — never visibly renders its content to a real, authenticated user.** Tracing its existing (pre-existing, not modified by this phase) logic: it renders `null` while the auth check is loading, and the moment `isAuthenticated` becomes true, a `useEffect` immediately calls `navigate(getRolePlatformPath(userRole))`, redirecting to `/platform/contractor` (`RolePlatform.tsx`) — a different, separate dashboard component with its own sidebar and layout, which does not currently contain any profile section. This was confirmed three independent ways: (1) a real authenticated Playwright session landing on `/provider` captured a blank white page before the redirect completed; (2) a deliberate network-delay experiment on the auth check still could not catch a stable rendered frame; (3) reading the pre-existing `useEffect` and `getRolePlatformPath` logic directly confirms this is unconditional for every authenticated provider-role user, not an edge case.

**Practical consequence:** the "My Profile" section built in this phase is fully implemented, fully tested (19 passing tests, including live database verification), and completely correct — but **it is not currently reachable by any real user through the live application's navigation**, because the file it lives in redirects away before any user ever sees it. The public-facing `/vendor/:id` page (`VendorProfile.tsx`) has no such issue and is fully live and reachable today.

This was not something Phase 4A.5's plan could have caught from source review alone — `ProviderDashboard.tsx` reads, on paper, like a normal dashboard page. It only became visible by actually running the app and signing in as a real user, which is exactly why this phase did that rather than relying on tsc/tests alone.

**This was not fixed in this phase**, because doing so — moving or duplicating the profile section into `RolePlatform.tsx`, or changing `ProviderDashboard.tsx`'s redirect condition — is a change to files and behavior outside this phase's explicit instruction ("add the vendor profile editing section to: ProviderDashboard.tsx"), and making that call unilaterally would be exactly the kind of silent scope decision this engagement has consistently avoided. It is surfaced here as the first, most urgent item for the next decision.

Second, smaller limitation: avatar upload cannot be fully exercised end-to-end in this sandbox because `BUILT_IN_FORGE_API_URL`/`BUILT_IN_FORGE_API_KEY` are not configured here — validation and the code path up to the storage call are confirmed working; the actual S3 round-trip is not verifiable from this session, consistent with every other upload feature in this codebase.

---

## Remaining owner decisions

1. **Most urgent, newly surfaced by this phase**: how should the "My Profile" section actually become reachable? Options include wiring it into `RolePlatform.tsx`'s contractor/engineer/architect/supplier/project_manager views, or changing `ProviderDashboard.tsx` to not redirect when a profile-specific action is intended. This needs an explicit decision before the feature delivers any real value.
2. Carried over, unresolved from Phase 4A.5 §18: should `profile.getPublic` (and thus `/vendor/:id`) eventually be viewable while fully logged out? This phase implemented the safer option (sign-in required) and did not change it silently — loosening it later is a one-line change (`protectedProcedure` → `publicProcedure` on `getPublic`) if approved.

---

## Git

Branch `claude/phase4a6-vendor-profile`, created from `claude/phase4a5-implementation-plan`. No changes to `main`/`master`. No merge performed.
