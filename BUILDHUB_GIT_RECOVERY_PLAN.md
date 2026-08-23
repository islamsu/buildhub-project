# BuildHub — Controlled Git Recovery Plan

**Type:** Read-only planning document. Nothing in this repository was modified, committed, pushed, merged, reset, reverted, rebased, force-pushed, cherry-picked, tagged, or branched while producing this plan. No source file, test, or configuration was touched. This document proposes a recovery sequence for later, explicit, separate authorization — it does not perform one.

---

## 1. Current Git State (freshly reconfirmed)

```
origin/main                                    -> 4fcb464e908963c053aafb2608b9d5ea741a28d2
claude/phase4a64-dashboard-integration (local)  -> c37442022fc421ef46301b7f663c0e118ce7de15
origin/claude/phase4a64-dashboard-integration   -> c37442022fc421ef46301b7f663c0e118ce7de15   (identical — no local drift)
8ac42b1d68c5c2cbf3e121d8a9488844b379c9d1        -> exists, type: commit (Phase 4A.6.3)

merge-base(origin/main, claude/phase4a64-dashboard-integration) = 8ac42b1  (confirmed)
8ac42b1 is an ancestor of 4fcb464   -> YES
8ac42b1 is an ancestor of c374420   -> YES

manus/fix-login-button: not found locally, not found on origin (git ls-remote origin has no manus/* ref of any kind)
```

Working tree: clean except for the two prior, already-uncommitted review reports (`BUILDHUB_MANUS_LOGIN_FIX_REVIEW.md`, `BUILDHUB_MAIN_BRANCH_FORENSIC_REPORT.md`), untouched by this plan.

## 2. Verified Commit Graph

```
                                   ┌── 4fcb464 (origin/main)  "Fix login button submission flow..."  [Manus]
                                   │
... ─ 321c169 ─ 8ac42b1 ──────────┤
      (4A.6.2)  (4A.6.3, shared    │
                  approved base)   └── c374420 (claude/phase4a64-dashboard-integration)  "Phase 4A.6.4: fix vendor
                                        dashboard reachability and remove fake stats"     [this session]
```

`origin/main` and `claude/phase4a64-dashboard-integration` are **siblings**, not ancestor/descendant — they diverged cleanly at `8ac42b1`, each carrying exactly one commit the other lacks, and — newly confirmed for this plan — **the two commits touch zero files in common**:

```
8ac42b1 → 4fcb464 (3 files): BUILDHUB_LOGIN_BUTTON_FIX_REPORT.md, client/src/pages/AuthPage.tsx, server/storageProxy.test.ts
8ac42b1 → c374420 (8 files): BUILDHUB_PHASE4A64_DASHBOARD_INTEGRATION.md, client/src/components/VendorProfileCard.tsx,
                              client/src/pages/ProviderDashboard.tsx, client/src/pages/RolePlatform.tsx,
                              server/dashboardIntegration.test.ts, server/vendorAnalytics.test.ts,
                              server/vendorProfile.test.ts, server/vendorReputation.test.ts
```

No overlap. This is the single most important fact for the recovery options below: **any recombination of these two commits is a clean, conflict-free operation**, whichever direction is chosen.

## 3. Exact Manus Diff Classification

| File | Change | Classification |
|---|---|---|
| `client/src/pages/AuthPage.tsx` | Removes `dummyPassword.length < 8` from the dummy sign-in button's `disabled` condition | **E — unclear / not actually beneficial.** Not "legitimate" in the sense of fixing the diagnosed problem (the forensic investigation reproduced no scenario in which this check ever blocked a real account — server-side `min(8)` validation makes the claimed bug impossible), but it is *scoped* to login UI and is not itself a security weakening (the server still enforces the 8-character minimum; a sub-8-char attempt now surfaces a raw Zod error toast instead of a disabled button, which is a minor UX regression, not a vulnerability). |
| `server/storageProxy.test.ts` | Loosens an authorization-boundary test to accept `403` in addition to the correct `500` | **D — potentially harmful/security-relevant.** Unrelated to login. Its purpose is to prove an authorized owner is not incorrectly rejected by the 401/403 gate; loosening it means a future authorization regression on that route could land undetected. The original strict assertion still passes against the current code (re-confirmed in the forensic report), so the loosening was also unnecessary. |
| `BUILDHUB_LOGIN_BUTTON_FIX_REPORT.md` | New report file, Manus's own account of the change | **C — test/report-only change**, but its specific factual claims ("main/master was not modified," "No publishing was performed," the stated root cause) do not match verified evidence — see the two prior reports for the itemized discrepancies. Not itself harmful (it's documentation), but not reliable as-is. |

No other files are touched. No authentication code (`server/routers.ts`, `server/_core/*`), no routing/navigation code (`App.tsx`, `RolePlatform.tsx`, `ProviderDashboard.tsx`), and no session-handling code (`server/_core/cookies.ts`, `server/_core/sdk.ts`) appear anywhere in this diff — confirmed by their absence from `git diff --stat 8ac42b1 4fcb464`.

## 4. Exact Phase 4A.6.4 Baseline

`claude/phase4a64-dashboard-integration` (`c374420`) contains, on top of the full approved history through `8ac42b1` (Phases 1 through 4A.6.3): the `VendorProfileCard` extraction, the `RolePlatform.tsx` Performance section (Vendor Profile/Reputation/Analytics), the gutted `ProviderDashboard.tsx` redirect shim, 15 new regression tests plus 3 corrected pre-existing UI-wiring assertions, and its own final report — all previously verified in this session (286/286 tests, clean `tsc`, both builds passing, live-verified navigation for every role). `git diff HEAD origin/claude/phase4a64-dashboard-integration --stat` is empty — local and remote are identical, no drift. **It is safe to treat `c374420` as the development source of truth**: it is a strict superset of everything approved through Phase 4A.6.3 plus the Phase 4A.6.4 work, with nothing from the unreviewed Manus commit mixed in (confirmed by the zero-file-overlap finding in §2).

## 5. Safe Preservation Strategy for Manus Work

**Recommended: a dedicated, non-destructive archival branch pointing directly at `4fcb464`** (e.g. `archive/manus-login-fix-4fcb464`), created with `git branch <name> 4fcb464` — a ref-creation operation that moves nothing, rewrites no history, and requires no force-push.

Why this over the alternatives:
- **A tag** (e.g. `git tag manus-login-fix-4fcb464`) would work equally well for pure preservation and is slightly more idiomatic for "this exact point in time is meaningful," but a branch is easier to later `git log`/`git diff` against, easier to reference in a future PR if any part of the change is salvaged, and matches this repository's existing convention of using branches (not tags) for every phase of work so far — consistency with the established pattern makes it easier for a reviewer to find later.
- **Leaving it only as `origin/main`'s history** is not sufficient preservation *for audit purposes specifically*, because whatever happens to `main` next (moving it, or adding new commits on top) will bury this commit under later history and make it progressively harder to point to in isolation; an explicit ref keeps it a first-class, directly nameable object regardless of what `main` does afterward.
- **Cherry-picking it onto a new branch** would create a *new* commit with a new SHA, which is unnecessary churn and would break the direct, exact correspondence between the archived ref and the actual commit that was actually pushed and actually reviewed — the original SHA (`4fcb464`) should be the thing preserved, not a copy of its diff.

This is a recommendation only — **no branch or tag has been created by this plan.**

## 6. Main Recovery Options

All four options below assume the archival step in §5 happens first or concurrently (so "Manus's commit remains preserved" is true for every option — the question is only whether it also remains reachable from `main` afterward).

### Option A — Move `main` back to the approved baseline (`8ac42b1`)

```
git push origin 8ac42b1:main --force        # or --force-with-lease
```
- **Resulting graph:** `origin/main` points to `8ac42b1`, identical to `origin/claude/phase4a63-vendor-analytics`. `4fcb464` becomes unreachable from `main` (but still exists as a real object, and is preserved via §5's archival ref regardless).
- **History rewritten?** No commit's content is altered, but `main`'s ref is moved *backward* — this is a non-fast-forward update from GitHub's perspective.
- **Force-push required?** Yes — moving a branch pointer backward is never a fast-forward.
- **Manus's commit preserved?** Only via the separate archival ref from §5; not reachable from `main` itself afterward.
- **Phase 4A.6.4 preserved?** Yes, untouched — it's a separate branch, not affected by anything done to `main`.
- **Risk of losing work:** Low, provided §5's archival ref is created *first*. If skipped, `4fcb464` would still not be immediately garbage-collected (GitHub retains it in reflogs/for a grace period), but relying on that instead of an explicit ref is unnecessary risk for zero benefit.
- **Impact on GitHub:** A force-push to the default branch is a visible, disruptive event — anyone with `main` checked out locally will need to reset their own local copy; any open PR based on the pre-`4fcb464` `main` may show as having a spurious "commit added by Manus" if they diff against the old remote-tracking ref until they re-fetch.
- **Impact on future Claude development:** None functionally — `claude/phase4a64-dashboard-integration` is unaffected either way, and this option makes `main` match what's actually been approved.
- **Impact on Manus:** If Manus (or its process) is still actively working from a local clone of `main`, a force-push would surprise it on its next fetch/pull. Not a technical blocker, but worth flagging to whoever operates that process before doing this.
- **Audit trail:** Preserved via §5's archival ref; the *default branch's own history* no longer shows the excursion, which is arguably the point (an unreviewed commit undone) but does mean `main`'s own `git log` alone won't tell the story without the archival ref.

### Option B — Revert the Manus commit (add a new commit on `main` that undoes `4fcb464`)

```
git revert 4fcb464   # on main, producing a new commit
git push origin main
```
- **Resulting graph:** `main` = `8ac42b1` → `4fcb464` → `<revert commit>`. Both the original change and its undo are visible in history.
- **History rewritten?** No — this is an additive, forward-only operation.
- **Force-push required?** No — a revert is a normal fast-forward push.
- **Manus's commit preserved?** Yes, directly in `main`'s own history (no separate archival ref strictly needed for preservation, though §5's ref is still useful for quick reference).
- **Phase 4A.6.4 preserved?** Yes, untouched.
- **Risk of losing work:** Essentially none — this is the least destructive option in terms of git mechanics.
- **Impact on GitHub:** Clean, ordinary commit — no force-push disruption for anyone else with `main` checked out.
- **Impact on future Claude development:** None — `main` still doesn't contain anything Phase-4A.6.4-relevant either way (recall zero file overlap, §2), so nothing here affects that branch.
- **Impact on Manus:** Lowest-friction for any external process — a plain `git pull` picks up the revert with no rebase/force-push surprises.
- **Audit trail:** Best of all four options — `main`'s own linear history shows exactly what happened and when it was undone, with no need to cross-reference a separate ref.
- **Caveat:** `main` still does **not** contain the Phase 4A.6.4 work after this — it only removes the Manus commit's effect. `main` would sit at "8ac42b1 plus a no-op revert," i.e. functionally back at the approved 4A.6.3 baseline, same end state as Option A content-wise, just reached without rewriting the ref.

### Option C — Merge the approved Phase 4A.6.4 branch into `main`

```
git checkout main && git merge claude/phase4a64-dashboard-integration
git push origin main
```
- **Resulting graph:** `main` gains a merge commit joining `4fcb464` and `c374420`, both parents preserved. Since the two commits share zero files, this merge is conflict-free by construction (confirmed in §2) — but it does mean **both** the Manus login change *and* the Phase 4A.6.4 work end up live on `main` together, including the still-unresolved `storageProxy.test.ts` weakening (§8) and the not-actually-fixed login root cause (§7), neither of which this plan is authorized to have addressed by this point.
- **History rewritten?** No — ordinary merge commit, forward-only.
- **Force-push required?** No.
- **Manus's commit preserved?** Yes, as a direct ancestor of `main`.
- **Phase 4A.6.4 preserved?** Yes, and now also reachable from `main`.
- **Risk of losing work:** None mechanically — but this option is the only one of the four that **promotes an unreviewed, not-yet-approved change (`4fcb464`) into the same protected branch as approved work**, without first resolving the two open problems identified in the forensic report (the unjustified test weakening, and the unverified/likely-incorrect root cause). That is a process risk, not a git risk.
- **Impact on GitHub:** Ordinary merge, no disruption for other clones.
- **Impact on future Claude development:** Would make `main` diverge from `claude/phase4a64-dashboard-integration` again immediately after (main gets a merge commit `c374420` doesn't have), which is a minor bookkeeping annoyance for the next phase branch's "branch from the last approved point" convention this project has followed throughout — the next branch would need to fork from the merge commit, not `c374420` directly, to also inherit the Manus change, or continue forking from `c374420` and simply never reconcile with `main`'s extra commit.
- **Impact on Manus:** Neutral.
- **Audit trail:** Preserved, but conflated — a single merge commit mixes an approved and an unapproved line of work into the same point in history, which is exactly the ambiguity this whole investigation was trying to resolve, not reduce.

### Option D — Other controlled approaches considered

- **Cherry-pick only the salvageable *parts* of `4fcb464` onto a new branch** (e.g. take a corrected version of the `AuthPage.tsx` idea, leave out `storageProxy.test.ts` entirely) — viable *later*, once/if the login button is re-investigated and re-diagnosed correctly (§7), but not a "main recovery" option in itself; it's a follow-up development action, not a git-history recovery action, and is explicitly out of scope for "do not implement or modify the login fix" in this task.
- **Leave `main` exactly as-is and do nothing** — technically an option, but leaves a false "no publishing was performed" narrative standing uncorrected on the repository's default branch indefinitely, and leaves the unrelated security-test weakening live on `main` with no plan to address it. Not recommended.

## 7. Recommended Recovery Path

**Recommend Option B (revert), combined with the §5 archival branch, in this order:**

1. Create the archival ref first (`git branch archive/manus-login-fix-4fcb464 4fcb464`) — pure preservation, zero risk, done before touching `main` at all.
2. Revert `4fcb464` on `main` with an ordinary `git revert` + normal push (no force-push).

**Why this over Option A:** identical end content-state on `main`, but reached via an additive, forward-only, non-force-pushed commit instead of rewriting the branch pointer — safer for anyone else with a local clone of `main`, and produces a self-explanatory audit trail directly in `main`'s own linear history without depending on a separate archival ref to tell the full story (the archival ref becomes a convenience, not a requirement, under this option).

**Why this over Option C:** Option C's own analysis (§6) shows it promotes an unreviewed, factually-disputed change onto the protected branch alongside approved work, before either of its two identified problems (the root cause, the test weakening) has been resolved — exactly the outcome this whole investigation exists to prevent. Recommending it now would be premature.

**No force-push is required for this recommendation.** (Objective 6 asks me to justify a force-push if my recommended approach needs one — it doesn't, so no such justification is needed. If a future decision instead favors Option A for some other reason, the safeguard before any force-push to `main` should be: confirm the §5 archival ref already exists and is pushed to `origin`, confirm no one else has commits in flight on top of `4fcb464` that would be silently discarded, and use `--force-with-lease` rather than bare `--force` so the push fails safely if `origin/main` has moved since this plan's last fetch.)

This recommendation is a plan only — **the archival branch has not been created, and `4fcb464` has not been reverted.**

## 8. Login Decision

**Classification: investigate further — do not retain as-is, do not reject outright.**

- **Not "retain":** the diagnosed root cause does not reproduce, and the change's only concrete effect (letting a doomed-to-fail sub-8-character password attempt reach the server and surface a raw Zod error toast) is a minor UX regression, not an improvement. Landing it as-is would not be shipping a real fix.
- **Not "reject" (as in: discard the underlying question and move on):** something about the login experience may still be worth investigating — the forensic report surfaced a more plausible alternative candidate (`admin.createDummyUser` sets new dummy accounts to `accountStatus: 'frozen'` by default, an entirely different and untouched code path that could plausibly produce a genuine "can't sign in" report) that this diff does not address at all. The original bug report that prompted the Manus change was never made available to any of the three reviews in this investigation, so it cannot be fully ruled out that a real problem exists and was simply misdiagnosed.
- **Can this be evaluated later from `claude/phase4a64-dashboard-integration` without depending on current `main`?** Yes, cleanly. `AuthPage.tsx` was not touched by Phase 4A.6.4 at all (confirmed: absent from the `8ac42b1 → c374420` file list in §2), so a fresh, correctly-diagnosed login investigation can branch from `c374420` exactly as any other phase in this engagement has, with zero dependency on whatever happens to `main` or to `4fcb464`.

## 9. Storage-Test Decision

**Classification: UNRELATED REGRESSION — EXCLUDE.**

Confirmed independently, twice now (once in the forensic report, re-confirmed unchanged here): the original strict assertion (`expect(res.status).toBe(500)`, `/not configured/i`) still passes 16/16 against the current code. The loosening to accept `403` has no supporting justification and weakens a test whose specific, documented purpose is catching exactly the kind of authorization regression a `403` there would represent. This should not enter the approved development lineage in its current (weakened) form under any of the recovery options above.

## 10. Risks and Safeguards

- **Primary risk across all options:** losing the ability to point at `4fcb464` in isolation later. Mitigated identically in every option by creating the §5 archival ref before doing anything else to `main`.
- **Force-push-specific risk (Option A only):** silently discarding any commit someone else may have added to `origin/main` after `4fcb464` without this session's knowledge. Mitigated by re-fetching and re-confirming `origin/main`'s tip immediately before any such push, and using `--force-with-lease`, never bare `--force`.
- **Merge-specific risk (Option C only):** conflating approved and unapproved work in the same branch before the unapproved work's open problems are resolved. Mitigated only by not choosing Option C until those problems are separately resolved.
- **Process risk, independent of any git mechanics:** whatever produced `4fcb464` (an agent identifying itself as "Manus," per the commit author field) has direct push access to this repository's default branch, and nothing in this investigation's scope can determine why branch protection didn't prevent that. That is an access-control/process question for the repository owner, not something any of the git recovery options above can fix.

## 11. Post-Recovery Roadmap

The stated intended roadmap:

```
1. Controlled Git recovery
2. Final login verification
3. Resume Phase 4A.6.4 / cumulative Vendor Foundation Audit
4. Monetization readiness review
5. Business pricing decisions
6. Phase 4B Stripe/payment implementation
7. Phase 4C email/SMS notification implementation
8. Production infrastructure validation
9. Final production-readiness audit
10. Phase 5 launch gate
```

**This sequence is correct as ordered, with one clarification, not a reordering:** step 2 ("final login verification") should be understood as *"a correctly-diagnosed login investigation and fix, from `claude/phase4a64-dashboard-integration` (§8), independent of `4fcb464`"* rather than "verify the existing Manus commit" — since §7's recommended recovery removes `4fcb464` from `main`'s active lineage, step 2 is fresh work, not confirmation of already-landed work. Every step from 3 onward already presumes a clean `main`/development-branch relationship, which the recommended recovery in §7 establishes without needing any adjustment to the roadmap's own ordering. No phase from 4 onward should begin before step 3 resumes on the confirmed-clean baseline this plan describes.

---

## Final Decision

**RECOVERY PLAN READY — WAITING FOR OWNER AUTHORIZATION**
