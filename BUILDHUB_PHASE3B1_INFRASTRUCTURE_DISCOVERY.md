# BuildHub — Phase 3B.1 Infrastructure Discovery

**Read-only. No code, configuration, secrets, or infrastructure were changed.**
Repository: `github.com/islamsu/buildhub-project` @ commit `30d101f` (branch `claude/phase3a-product-completeness`)

---

## 0. Scope of what this session can actually see

Before anything else, this needs to be stated plainly rather than glossed over: **this session has access to the git repository and standard developer tooling only.** There is no Manus dashboard, Manus management API, cloud-provider console, or deployment-platform credential available to this session — confirmed by searching for any such tool before writing this report, which returned nothing Manus-infrastructure-related.

This means every question in the task about the *actual running* production environment — where it's hosted, which literal database account backs it, whether backups are literally switched on today, what the real production domain is — **cannot be answered from here.** They require someone with access to the Manus project dashboard (or whichever console Manus exposes for this app) to look and report back, or to grant this session that access.

What follows is split cleanly into:
- **Evidence found in the repository** (real, re-verifiable, cited by file).
- **NOT VERIFIED** — everything that depends on infrastructure state this session cannot observe.

Nowhere below is a guess presented as fact.

---

## 1. Actual Production Hosting

| Question | Answer | Classification |
|---|---|---|
| Where is the current production app hosted? | **NOT VERIFIED** — no hosting platform config (no Dockerfile, no Vercel/Netlify/Railway/Render/Fly config, no `.github/workflows`) exists anywhere in the repository | NOT VERIFIED |
| Is BuildHub still hosted by Manus? | **NOT VERIFIED from this session** — but strong circumstantial evidence the *codebase* is built for the Manus platform (see below) | NOT VERIFIED |
| Does Manus act as app host / DB host / storage provider / deployment manager? | **NOT VERIFIED** which of these roles Manus plays today for the live deployment — the code is *written* to depend on Manus-provided services (OAuth server, "Forge" storage/LLM proxy), which is evidence of platform *dependency*, not proof of current hosting | NOT VERIFIED |
| Is there another cloud provider behind Manus? | **NOT VERIFIED** — Forge's presigned-URL pattern (`v1/storage/presign/put`/`get`) is S3-shaped, meaning *something* S3-compatible is very likely behind it, but which provider/account is invisible from here | NOT VERIFIED |

**Evidence that the codebase is a Manus-platform application** (all directly re-checkable in the repo):
- `devDependencies` includes `vite-plugin-manus-runtime` (v0.0.59), wired into `vite.config.ts`, which writes browser debug logs to `.manus-logs/` — a Manus-specific dev-tooling plugin.
- `client/index.html` contains `%VITE_ANALYTICS_ENDPOINT%`/`%VITE_ANALYTICS_WEBSITE_ID%` placeholders (Umami analytics script tag) — string-template markers meant to be substituted by a build/publish pipeline, consistent with Manus's publish step injecting these at deploy time. Unsubstituted in the repo, so **not evidence deployment has ever run** — just evidence the *pipeline expects to*.
- `template.json` (root) is a snapshot of the original Manus "Web App (db,user)" starter template's boilerplate files (`Home.tsx`, `routers.ts`, `db.ts`, etc.) as they looked before BuildHub was built out on top of them — confirms BuildHub *originated* from a Manus template, tells us nothing about where it runs today.
- `server/_core/sdk.ts` talks to `OAUTH_SERVER_URL` using Manus-specific request/response shapes (`ExchangeTokenRequest`, `WebDevAuthPublicService`, etc.) — the auth flow is contractually tied to a Manus-operated OAuth server, wherever that server itself is hosted.
- `server/storage.ts`/`server/_core/storageProxy.ts` call a "Forge" proxy (`BUILT_IN_FORGE_API_URL`) for presigned S3 PUT/GET — Manus's own name for its storage abstraction, per code comments ("Manus 'Forge' proxy").
- `.notes-marketplace-hub.md` (internal dev notes, not authoritative) mentions a local "Dev URL port 3000" — consistent with Manus's local preview workflow, not production.

**Conclusion**: the application is unambiguously *built for* Manus's platform conventions. Whether the specific `github.com/islamsu/buildhub-project` repository is *currently* connected to a live Manus-published deployment, and whether that deployment is presently active, cannot be determined without dashboard access.

---

## 2. Database

| Question | Answer | Classification |
|---|---|---|
| Exact provider (MySQL / TiDB / PlanetScale / RDS / Cloud SQL / Manus-managed / other) | **NOT VERIFIED** — no infra-as-code, connection string, or provider marker exists in-repo | NOT VERIFIED |
| Engine/version | Code targets generic MySQL wire protocol (`mysql2` driver, `drizzle.config.ts` `dialect: "mysql"`); exact server version unknown | NOT VERIFIED |
| Region | Not discoverable from source | NOT VERIFIED |
| Managed? | Almost certainly yes if Manus provisions it (self-hosting a DB from a template project would be unusual), but not confirmed | NOT VERIFIED |
| Automated backups exist? | Not discoverable from source — this is exactly the Phase 3B finding that stands: **application code has zero backup logic**, which is correct and expected (backups are an infra-platform responsibility, not application code) — but whether Manus's platform-side backup feature is *switched on* for this project is invisible from here | NOT VERIFIED |
| Point-in-time recovery? | Same — platform capability, not visible from repo | NOT VERIFIED |
| Snapshots exist? | Same | NOT VERIFIED |
| Can a separate staging database be created? | Depends entirely on what the Manus project dashboard / plan tier allows — **not answerable from source** | NOT VERIFIED |
| Can staging get separate credentials? | Architecturally yes from the *application's* side — `DATABASE_URL` is a single plain env var with no code-level constraint on its value (confirmed in Phase 3B), so the app itself would accept any valid connection string. Whether the *platform* lets you provision a second database/credential set is a Manus-dashboard question | NOT VERIFIED (platform), CONFIRMED (app-side compatibility) |

**What IS confirmed from source** (re-affirming Phase 1/3B findings, not re-litigating them):
- `drizzle-orm/mysql2`'s `db.transaction()` issues real `BEGIN`/`COMMIT`/`ROLLBACK`; `.for('update')` compiles to real ` for update` SQL — both verified by reading the installed driver source, not assumed.
- No SSL/TLS is enforced in code — whatever the `DATABASE_URL` connection string itself specifies is all that applies.
- Connection pool uses `mysql2` driver defaults (`connectionLimit: 10`, `queueLimit: 0`) — nothing in the app tunes this.

**What this means practically**: the *code* is database-provider-agnostic (any MySQL-wire-protocol-compatible service works), which is good news for portability, but it also means the code itself carries zero signal about which specific provider is in use. **Only someone with Manus dashboard access, or the actual `DATABASE_URL` value from the live deployment's environment, can answer this.**

---

## 3. Manus Environment Capabilities

**This entire section is NOT VERIFIED from this session** — it requires inspecting the Manus project dashboard/settings UI, which this session has no access to (no API token, no MCP tool, no CLI credential for Manus specifically was available or discovered).

| Capability | Classification |
|---|---|
| Development environment | NOT VERIFIED |
| Preview environment | NOT VERIFIED |
| Staging environment | NOT VERIFIED |
| Production environment | NOT VERIFIED |
| Branch-based deployments | NOT VERIFIED |
| Environment-specific secrets | NOT VERIFIED |
| Environment-specific databases | NOT VERIFIED |
| Environment-specific storage | NOT VERIFIED |
| Deployment rollback | NOT VERIFIED |
| Deployment history | NOT VERIFIED |
| Database backups | NOT VERIFIED |
| Database restoration | NOT VERIFIED |
| Logs | NOT VERIFIED |
| Monitoring | NOT VERIFIED |
| Custom domains | NOT VERIFIED |
| SSL | NOT VERIFIED |
| Webhooks | NOT VERIFIED |

**What can be said**: the presence of `vite-plugin-manus-runtime`, the `%VITE_ANALYTICS_ENDPOINT%` templating pattern, and the OAuth/Forge service dependencies all indicate Manus is a full platform (not just a code-hosting service) — platforms of this shape *typically* offer some combination of the above. But "typically offers" is not verification, and I won't represent it as one.

**To close this gap**: someone with access to the Manus project's dashboard/settings needs to check each item above directly and report back, or grant this session equivalent access (e.g., a Manus CLI/API credential, or screenshots/exports of the relevant settings screens).

---

## 4. GitHub → Deployment Flow

| Question | Answer | Classification |
|---|---|---|
| Git remote | `https://github.com/islamsu/buildhub-project` (confirmed via `git remote -v`) | VERIFIED |
| Which branch is production | **NOT VERIFIED** — no `.github/workflows`, no branch-protection config, no deployment manifest exists in-repo to indicate this | NOT VERIFIED |
| Is `main` connected to production? | **NOT VERIFIED** — plausible by convention, not confirmed | NOT VERIFIED |
| Do feature branches create preview deployments? | **NOT VERIFIED** — this would be a Manus-platform behavior, invisible from repo contents | NOT VERIFIED |
| Can a dedicated staging branch be used? | **NOT VERIFIED** whether Manus supports this; nothing in the repo *prevents* it (there's no branch-restriction config of any kind checked into this repo) | NOT VERIFIED |
| Do PRs generate previews? | NOT VERIFIED | NOT VERIFIED |
| Automatic or manual deployments? | NOT VERIFIED — no CI/CD config exists to automate anything from this repo's side; if deployment is automatic, it's triggered by Manus's own platform hooks outside this repository's visibility | NOT VERIFIED |
| Does Manus Publish deploy GitHub HEAD or another source? | NOT VERIFIED | NOT VERIFIED |

**Confirmed independent of the above**: this repository has **zero CI/CD automation of its own** (no `.github/` directory at all, confirmed by direct listing). Any deployment automation that exists is entirely on Manus's side, configured through whatever mechanism connects a Manus project to this GitHub repo — not visible in the repo's own files.

---

## 5. Staging Architecture — Is the Preferred Structure Technically Possible?

The task's preferred structure (parallel `staging` and `main` pipelines, each with its own DB/storage/OAuth/secrets) is **architecturally compatible with the application code as written**:

- **Database**: `DATABASE_URL` is a single, unconstrained env var (Phase 3B finding, re-confirmed) — the app will happily connect to whatever database it's pointed at. ✅ App-side: compatible.
- **Storage**: `BUILT_IN_FORGE_API_URL`/`KEY` are likewise unconstrained plain env vars, with no environment-prefixed storage keys in the upload paths — isolation is achievable purely by giving staging a different credential pair, no code change needed. ✅ App-side: compatible.
- **OAuth**: the callback URL is built client-side from `window.location.origin` (`client/src/const.ts:9`), so a staging deployment on its own domain automatically gets a correct, distinct callback URL with zero code changes. ✅ App-side: compatible, and actively well-designed for this.
- **Secrets**: `JWT_SECRET`, `OAUTH_SERVER_URL`, `VITE_APP_ID`, `OWNER_OPEN_ID` are all independent plain env vars — nothing hardcodes a shared value between environments. ✅ App-side: compatible.
- **`NODE_ENV`**: the app only distinguishes `"development"` from everything else (`ENV.isProduction = NODE_ENV === "production"`) — there is **no built-in "staging" runtime mode**. A staging deployment would need to run with `NODE_ENV=production` to get production-shaped behavior (static asset serving, etc.), which is fine functionally but means the app cannot itself distinguish "this is staging" from "this is production" at runtime if that ever matters (e.g., for a staging watermark banner, or gating a dangerous action).

**Whether the *platform* (Manus) actually lets you wire up two independent environments this way — separate branch triggers, separate secret sets, separate database provisioning — is entirely Section 3's NOT VERIFIED territory.** The code will not stand in the way; whether Manus's project settings support it is unknown from here.

---

## 6. Database Backups

**Entirely NOT VERIFIED** for the same reason as Section 3 — this is a platform/provider capability question, not something the application code or repository can answer.

| Question | Where it would be configured (if supported) | Classification |
|---|---|---|
| Automated daily snapshots | Manus project dashboard → database settings, or the underlying DB provider's own console if Manus exposes one | NOT VERIFIED |
| Point-in-time recovery | Same | NOT VERIFIED |
| Backup retention | Same | NOT VERIFIED |
| Restore to a new database | Same | NOT VERIFIED |
| Cross-region backup | Same | NOT VERIFIED |
| Backup encryption | Same | NOT VERIFIED |

Nothing here was configured, checked, or changed. This section can only be completed by someone opening the Manus dashboard (or the underlying DB provider's console, if Manus surfaces it) and reporting what's actually there.

---

## 7. Storage

| Question | Answer | Classification |
|---|---|---|
| What does "Forge" represent in the deployed environment? | Manus's own storage/LLM-proxy abstraction, per in-code naming and comments (`server/storage.ts`: *"Preconfigured storage helpers for Manus WebDev templates... Downloads return /manus-storage/{key} paths"*) | VERIFIED (as a code-level abstraction; the underlying physical service is NOT VERIFIED) |
| Does it map to S3-compatible storage? | Very likely — the presign flow (`v1/storage/presign/put`/`get`, direct `PUT` to the returned URL) is the standard S3 presigned-URL pattern — but the literal backing service (AWS S3 vs. an S3-compatible alternative) is not confirmed | NOT VERIFIED (pattern strongly suggests it; provider identity does not) |
| Can staging have separate storage credentials? | App-side: yes, trivially — `BUILT_IN_FORGE_API_URL`/`KEY` are plain env vars with no validation against a specific host or account (Phase 3B finding) | CONFIRMED (app-side) |
| Can separate buckets/accounts be created? | NOT VERIFIED — depends on what Manus's Forge service allows you to provision | NOT VERIFIED |
| Does storage versioning/backups exist? | NOT VERIFIED | NOT VERIFIED |
| Can production and staging be completely isolated? | **Technically yes from the app's side** (different credential pair = different bucket/account, zero code changes needed) — **but there is no code-level guard preventing accidental credential reuse either.** If the same Forge credentials were used for both environments, staging and production would share the identical physical storage the moment the app is misconfigured. This is a process/discipline requirement, not something the code enforces | CONFIRMED possible, NOT enforced |

No credential values were viewed or exposed at any point in this investigation.

---

## 8. Secrets

**Confirmed from source** (re-verified fresh this session, not assumed): `server/_core/env.ts` and ~5 other files read exactly these env vars, and only these:

```
DATABASE_URL
JWT_SECRET
OAUTH_SERVER_URL
VITE_APP_ID
OWNER_OPEN_ID
BUILT_IN_FORGE_API_URL
BUILT_IN_FORGE_API_KEY
OPENAI_API_KEY   (optional — only used if the direct-OpenAI code path is taken)
NODE_ENV, PORT   (standard Node/Express, not app-secrets)
```

- **No hardcoded secrets found anywhere in source** (grepped for common secret patterns — key prefixes, PEM headers, inline password literals — zero hits, consistent with the Phase 2/3B findings).
- **No `.env` file is committed**; `.gitignore` correctly excludes `.env`, `.env.local`, `.env.development.local`, `.env.test.local`, `.env.production.local`.
- **Whether Manus's platform supports genuinely separate values of each of these per environment** is a **platform capability question — NOT VERIFIED** from this session. What IS confirmed is that **nothing in the application code would break or behave incorrectly if given separate values per environment** — there's no cross-referencing, no baked-in assumption that any of these are shared. The app is fully compatible with per-environment secrets; whether the platform lets you configure it that way is unknown.

No secret values are reproduced anywhere in this report.

---

## 9. Domain / SSL

| Question | Answer | Classification |
|---|---|---|
| Current production domain | **NOT VERIFIED** — not present in any repo file | NOT VERIFIED |
| Custom domains supported? | NOT VERIFIED (platform question) | NOT VERIFIED |
| Can staging have its own subdomain? | NOT VERIFIED (platform question); app-side, nothing prevents it — the OAuth callback logic already derives everything from `window.location.origin`, so a subdomain "just works" from the app's perspective | NOT VERIFIED (platform), CONFIRMED (app-side compatibility) |
| SSL handling | App reads `x-forwarded-proto` to detect HTTPS (`server/_core/cookies.ts`'s `isSecureRequest()`), implying it expects to sit behind a TLS-terminating reverse proxy — consistent with most PaaS deployment models, but the actual TLS termination point is invisible from here | Partially confirmed (app expects proxy-terminated TLS); actual cert/provider NOT VERIFIED |
| HTTPS enforcement | No code-level redirect from HTTP→HTTPS exists in `server/_core/index.ts` — if enforced, it happens at the platform/proxy layer, not in this app | NOT VERIFIED (platform) |
| Redirect behavior | NOT VERIFIED | NOT VERIFIED |

No changes were made.

---

## 10. Rollback

**Application rollback and database rollback are genuinely different concerns, as the task notes — addressing each separately:**

### Application rollback
- **Deployment rollback, deployment history, version selection, git-commit-based deployment**: all **NOT VERIFIED** — these are Manus-platform features (if they exist), entirely outside what this repository's contents can confirm. Most modern PaaS-style platforms offer *some* form of "redeploy a previous build," but whether Manus does, and whether it's enabled for this project, is unknown from here.
- What IS true from the repo: every commit in this engagement's history (Phase 1 → 2 → 3A → 3B) is individually addressable by SHA (`fb7fd09`, `26d2d08`, `30d101f`, ...), so **if** Manus deploys from git refs, a rollback to any prior commit is at minimum git-mechanically possible. Whether Manus's *publish* mechanism actually supports "redeploy this specific past commit" as a one-click action is NOT VERIFIED.

### Database rollback
- **No down-migrations exist** — drizzle-kit did not generate rollback SQL for any of the 12 existing migrations, and none were hand-written (Phase 3B finding, re-confirmed: all 12 migration files are additive `CREATE`/`ALTER ADD COLUMN` only, zero `DROP`/destructive statements).
- This means: **"rolling back the database" today would mean restoring from a backup snapshot**, not applying a reverse migration — because no reverse migrations exist. This makes backup/restore capability (Sections 6–7 of the Phase 3B report, still NOT VERIFIED/NOT CONFIGURED as of this session) the *only* real database rollback mechanism available, whenever it's actually configured.
- **Application rollback and database rollback are not synchronized by anything in this repo.** If a future deployment rollback reverts the app code to a version expecting an older schema, but the database has already been migrated forward, there is no compatibility-checking mechanism — this is worth keeping in mind when the real CI/CD and migration-safety work (Phase 3B, Section 12) eventually happens.

---

## 11. Recommended BuildHub Environment (proposal only — nothing implemented)

Based only on what's actually verified (app-side compatibility) rather than assumed platform capability:

| | DEVELOPMENT | STAGING | PRODUCTION |
|---|---|---|---|
| Git branch | any feature branch / local | dedicated `staging` branch (recommend creating one when this is authorized) | `main` (assumed by convention — **confirm this is actually what Manus deploys from before relying on it**) |
| Deployment | local `pnpm dev` (Vite dev server + `tsx watch`) | Manus deployment triggered from the `staging` branch, **if Manus supports branch-based deploy triggers (NOT VERIFIED)** | Manus deployment triggered from `main`, **if that's confirmed as the production source (NOT VERIFIED)** |
| Database | local/dev DB, or none (`getDb()` degrades gracefully when `DATABASE_URL` is unset) | dedicated staging database, own credentials, freely resettable | dedicated production database, own credentials, backed up |
| Storage | dev Forge credentials (or none — uploads simply fail with a clear error if unset) | dedicated staging Forge credential pair, ideally a separate bucket/account | dedicated production Forge credential pair |
| Secrets | local `.env` (gitignored, never committed) | staging-specific secret store entries, distinct values for every var in Section 8 | production-specific secret store entries, distinct values, tightest access control |
| OAuth | dev OAuth app registration if available, or the dummy-user login path for local testing | staging-specific OAuth app registration if the provider supports multiple registrations, else the same provider with a staging-domain callback (already safe by construction per Section 5) | production OAuth app registration |
| Domain | `localhost:3000` | a staging subdomain (e.g. `staging.<domain>`, **if custom domains are supported — NOT VERIFIED**) | the real production domain |
| Monitoring | none needed | recommend enabling whatever Manus's built-in monitoring/logs offer (Section 3, NOT VERIFIED what exists) as a first pass before adding anything external | same, plus the external error/uptime monitoring recommended in the Phase 3B report (still not implemented) |

This table is a target shape, not a confirmed-achievable plan — every "if Manus supports X (NOT VERIFIED)" caveat is a real gate on whether this exact structure is buildable as described.

---

## 12. Exact Next Actions

Only items that don't require guessing at unverified platform capabilities:

1. **Get Manus dashboard access into this loop** — either grant this session a Manus API/CLI credential, or have someone with dashboard access answer Section 3's checklist directly (environment types, branch-deploy support, secrets-per-environment, backup/restore, monitoring, custom domains, rollback) and report back. Every other action below depends on the answers here.
2. **Confirm which branch Manus actually deploys from today** (Section 4) — check the Manus project's deployment settings, don't assume `main`.
3. **Confirm the actual database provider and engine** (Section 2) — check the `DATABASE_URL` host in the live production environment's configured secrets (without printing the value itself, just identify the provider from the hostname pattern, e.g. `*.rds.amazonaws.com`, `*.tidbcloud.com`, `*.psdb.cloud`, or a Manus-owned hostname).
4. **Determine whether Manus supports provisioning a second, isolated database** — if yes, that becomes the staging database; if no, an external managed MySQL/TiDB instance (e.g. a small RDS/TiDB Cloud/PlanetScale instance) becomes the fallback staging database, provisioned outside Manus but still connected via the same unconstrained `DATABASE_URL` mechanism the app already supports.
5. **Determine whether Manus supports environment-specific secrets and storage credentials** — if yes, use that; if no, the same fallback logic applies (a separate, externally-provisioned Forge-compatible or plain S3 bucket).
6. Only after 1–5 are answered: proceed to the concrete staging build-out from the Phase 3B report (provision staging DB → run `pnpm db:push` → provision staging storage/secrets → deploy → run the real-DB concurrency tests → configure backups → test restore → configure monitoring → stand up CI).

---

**No code was written, no files besides this report were created, no configuration was changed, no secrets were touched, no database was created, and nothing was deployed during this phase.**

Waiting for explicit authorization, and for the Manus-dashboard information gap identified in Section 0/3 to be closed, before any implementation begins.
