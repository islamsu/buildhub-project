# BuildHub — Infrastructure Readiness & GitHub → Vultr Architecture

**Branch:** `claude/phase4b-readiness-audit-hardening`
**Baseline:** `91a4fea`
**Date:** 2026-08-20
**Scope:** architecture and readiness assessment. **No infrastructure was created, nothing
was deployed, no DNS was touched, no production database or credential exists.**

---

## 0. Executive summary

BuildHub's application is closer to deployable than its infrastructure is: the codebase
is clean (660 tests, TypeScript clean, both builds green) and Slice 1 already fixed
several defects that would have blocked any deploy. What does not exist is **any**
deployment machinery — no Dockerfile, no CI, no `.github/` directory at all.

Three findings dominate this report.

**Finding 1 — I cannot do the Egypt latency testing you asked for, and will not fake
it.** Vultr is unreachable from this sandbox: `api.vultr.com`, `vultr.com` and
`fra-de-ping.vultr.com` all return `000` through the egress allowlist. §4 gives you a
ready-to-run procedure to measure it yourself from Egypt, with a decision rule.
**Requires your action.**

**Finding 2 — a platform dependency, but a much smaller one than it first appears.**
Five modules reference `BUILT_IN_FORGE_API_URL/KEY`, a Manus scaffold service Vultr
does not provide. On tracing importers, **four are dead code** — `imageGeneration.ts`,
`voiceTranscription.ts`, `heartbeat.ts` and `_core/map.ts` are imported by nothing.
The only live dependency is `server/storage.ts`, used by five upload paths. Vultr
Object Storage is S3-compatible, so this is one adapter, not a platform migration.
See §2.

**Finding 3 — the production sign-in path needs your decision.** `auth.signInDummy`
only accepts accounts with `isDummy = true`. Real users authenticate through OAuth
against `OAUTH_SERVER_URL`, another Manus-platform service. Before launch you must
decide whether that service remains reachable in production or whether BuildHub needs
its own authentication. This is a launch blocker and is **not** in the 22-item list.

> **On Vultr specifics.** I could not reach Vultr to confirm its current region list,
> instance catalogue or pricing. Every Vultr SKU, region and price below is marked
> *verify* and must be checked against Vultr's console before you commit money.

---

## 1. Current-state inventory (read-only, evidence-based)

| Aspect | Finding |
|---|---|
| Runtime | Node ESM (`"type": "module"`). **No `engines` field** — Node version is unpinned. Development runs Node 22. |
| Build | `vite build` → `dist/public`; `esbuild … --packages=external` → `dist/index.js` (~220 kB). `--packages=external` means **`node_modules` must ship with the artifact**. |
| Start | `NODE_ENV=production node dist/index.js` |
| Static assets | `serveStatic()` mounts `express.static(dist/public)` — **the app serves its own frontend**, so a separate nginx tier is optional, not required. |
| Database | MariaDB/MySQL via `mysql2` 3.15 + Drizzle ORM 0.44. 17 migrations in `drizzle/`. |
| Migrations | `db:migrate` = `drizzle-kit migrate` (apply-only, added in Slice 1). `db:push` still generates — never use it in a pipeline. |
| Dependencies | 64 production, 23 dev. |
| Deployment config | **None.** No Dockerfile, `.dockerignore`, docker-compose, Procfile, `fly.toml`, `vercel.json`, `render.yaml`, `railway.json`, `ecosystem.config.js`. |
| CI | **None.** No `.github/` directory exists, so `check`, `test` and `build` never run automatically. |
| Health endpoint | `system.health` exists but is **unusable as a probe**: tRPC-only at `/api/trpc/system.health`, requires a superjson-encoded `timestamp` input, and returns `{ok:true}` unconditditionally without touching the database. |
| Secrets | No `.env` in the repo (correctly gitignored). `.env.example` added in Slice 1. |

### Already fixed in Slice 1 — this architecture depends on all of it

- Boot-time env validation: production **refuses to start** on a missing/short
  `JWT_SECRET` or absent `DATABASE_URL`, instead of booting and signing sessions with
  an empty key.
- Deterministic port binding: production binds `PORT` or exits, instead of silently
  scanning 20 ports and landing somewhere the load balancer is not looking.
- `trust proxy` set in production, so `req.protocol` and `req.ip` are real behind a
  load balancer — required for correct cookies and for IP-keyed rate limiting.
- Cookie `Secure` pinned in production (`SameSite=None` is dropped by browsers without
  it).
- tRPC `errorFormatter` strips stack traces and genericises internal errors.
- Apply-only `db:migrate` script.

---

## 2. Platform coupling — the Forge and OAuth dependencies

### 2.1 Forge: one live module, four dead ones

| Module | Forge refs | Imported by | Status |
|---|---|---|---|
| `server/storage.ts` | 3 | `routers.ts` | **LIVE** |
| `server/_core/imageGeneration.ts` | 16 | nothing | dead scaffold |
| `server/_core/voiceTranscription.ts` | 8 | nothing (a comment only) | dead scaffold |
| `server/_core/heartbeat.ts` | 6 | nothing | dead scaffold |
| `server/_core/map.ts` | 3 | nothing | dead scaffold |
| `client/src/components/Map.tsx` | `VITE_FRONTEND_FORGE_*` | not rendered anywhere | dead scaffold |

`storagePut()` has exactly five call sites: registration documents, project documents,
RFQ attachments, message attachments, avatars. It obtains a presigned PUT URL from
Forge and uploads directly to S3.

**Recommendation.** Replace `storage.ts` with a direct S3 signer against **Vultr Object
Storage** (S3-compatible). The public interface `storagePut(key, buffer, contentType)`
→ `{key, url}` stays identical, so no call site changes, and `authorizeStorageKey()` in
`storageProxy.ts` keeps working unchanged. Delete or quarantine the four dead modules
so they stop implying a dependency that is not real.
**Requires implementation** — small and well-bounded.

### 2.2 OAuth: a genuine launch blocker

`registerOAuthRoutes(app)` is live in `server/_core/index.ts`, and `sdk.ts` logs an
explicit error when `OAUTH_SERVER_URL` is unset. The only other sign-in path,
`auth.signInDummy`, refuses any account without `isDummy = true`.

**So a self-registered real user cannot sign in without a reachable
`OAUTH_SERVER_URL`.** Decide before launch whether that Manus service is available to
your Vultr deployment or whether BuildHub needs its own auth. **Blocked — requires your
decision.**

---

## 3. Staging and production architecture

Same shape in both environments, different sizing, complete isolation.

```
GitHub (islamsu/buildhub-project)
  │
  ├─ push to any branch ─────────► CI: install → tsc → vitest → build      (no deploy)
  │
  ├─ merge to `develop` ─────────► Deploy STAGING  (automatic)
  │                                  └─ migrate → restart → health → smoke
  │
  └─ merge to `main` ────────────► Deploy PRODUCTION
                                     └─ GitHub Environment gate: MANUAL APPROVAL
                                        └─ backup → migrate → restart → health → smoke
                                           └─ rollback on failure

VULTR (one region, chosen per §4)
┌─────────────────────────── VPC 2.0 (private network) ───────────────────────────┐
│                                                                                  │
│   [Firewall Group: web]        [Firewall Group: db]                              │
│   ┌──────────────────┐         ┌──────────────────────┐                          │
│   │ Cloud Compute    │────────►│ Managed MySQL        │  (private endpoint only) │
│   │ Node 22 + app    │  :3306  │ automated backups    │                          │
│   │ :3000 behind TLS │         └──────────────────────┘                          │
│   └────────┬─────────┘                                                           │
│            │  S3 API                                                             │
│            ▼                                                                      │
│   ┌──────────────────┐                                                            │
│   │ Object Storage   │  uploads; app proxies + authorises every read              │
│   └──────────────────┘                                                            │
└──────────────────────────────────────────────────────────────────────────────────┘
        ▲ :443 only, from the internet
```

**Staging and production must not share** a database, an object-storage bucket, a
firewall group, or a set of secrets.

---

## 4. Region selection — procedure, not a fabricated measurement

Vultr has **no Egypt region** (*verify*). Candidates to test, nearest-first for Cairo:
**Frankfurt, Amsterdam, London, Paris, Stockholm**, plus **Tel Aviv** and
**Johannesburg** if they still exist in Vultr's catalogue (*verify*).

Run this **from Egypt**, on the network your users will actually use — ideally both a
Cairo fixed line and a mobile connection:

```bash
# Latency. Vultr publishes a ping host per region (verify the current hostnames
# in Vultr's console — these are the conventional pattern).
for r in fra-de ams-nl lon-gb par-fr sto-se; do
  echo "== $r =="
  ping -c 20 "$r-ping.vultr.com" | tail -2
done

# Throughput, for the two or three lowest-latency regions only.
curl -o /dev/null -w 'dl: %{speed_download} B/s\n' \
     "https://fra-de-ping.vultr.com/vultr.com.100MBtest.bin"
```

**Decision rule.** Pick the lowest **median** RTT, not the best single ping. Prefer a
region within ~15 ms of the best if it also has Managed MySQL *and* Object Storage
available — a slightly slower region that keeps the database on a private network beats
a faster one that forces cross-region traffic. Record the numbers in this document.

**Classification: Requires your action.** I cannot measure this; anything I asserted
would be invented.

---

## 5. Compute sizing

Sizing for controlled beta (§28 of the master plan: ~100–150 vendors, ~50–100 customers).

| Environment | Recommendation | Rationale |
|---|---|---|
| **Staging** | Smallest shared-vCPU instance, ~1 vCPU / 2 GB (*verify SKU*) | Correctness rehearsal, not load. |
| **Production** | 2 vCPU / 4 GB, shared or high-frequency (*verify SKU*) | Node is single-process here; 4 GB gives headroom for the 50 MB body limit and base64 upload buffering. Start here and measure — the app has no load data yet. |

**Notes.** The app is a single Node process with no clustering, so extra vCPUs do not
help until you add a process manager or a second instance. `express.json({limit:"50mb"})`
plus base64 upload decoding means memory spikes with concurrent uploads. Vertical
scaling first; revisit only with real metrics.

---

## 6. Managed MySQL

Use **Vultr Managed Databases for MySQL** (*verify availability in the chosen region*).
Do not self-host MySQL on the app instance — it forfeits managed backups and puts the
data on the same disk as the code.

| Setting | Value |
|---|---|
| Version | MySQL 8.x, or MariaDB if offered — development runs MariaDB 10.11 and Drizzle targets the `mysql2` driver, so **verify migrations apply cleanly on the chosen engine before launch** |
| Networking | **Private/VPC endpoint only.** No public access. |
| Users | One least-privilege application user per environment. Never the admin user. |
| TLS | Required in the connection string |
| Sizing | Smallest tier for both environments initially; the schema is 27 small tables |

`DATABASE_URL` is validated at boot (Slice 1), so a misconfigured connection string
fails the deploy loudly rather than silently serving empty results.

---

## 7. Object storage

**Vultr Object Storage**, S3-compatible, one bucket per environment
(`buildhub-staging`, `buildhub-production`).

**The bucket must be private.** BuildHub already proxies and authorises every read
through `/manus-storage/*` → `authorizeStorageKey()`, which enforces per-prefix rules
(registration docs → owner only; project documents → project owner; message
attachments → sender or receiver; avatars and RFQ attachments → any authenticated
user; everything else fails closed). A public bucket would bypass all of it.

Requires the `storage.ts` S3 adapter from §2.1. Also carry over the **A10 finding**
from the readiness audit: upload content types are client-declared with no magic-byte
sniffing, and `image/svg+xml` passes every image path. Set
`Content-Disposition: attachment` on the bucket or at signing time.

---

## 8. Backups and database recovery

| Item | Position |
|---|---|
| Automated backups | Enable Vultr Managed Database daily backups; confirm the retention window (*verify*) |
| Pre-deploy backup | The production pipeline takes an on-demand snapshot **before** running migrations |
| Restore procedure | Must be documented **and rehearsed** |
| Object storage | Vultr Object Storage is not automatically backed up (*verify*) — treat uploads as needing their own sync/versioning |

**A backup that has never been restored is not a backup.** `BUILDHUB_DATABASE_MIGRATION_RUNBOOK.md`
already exists and states honestly that it has been proven in a sandbox but never run
against staging or production. Do a full restore drill into a scratch database before
launch.

---

## 9. Firewall and network

Two firewall groups, default-deny:

**web** (app instance) — inbound `443/tcp` from anywhere; `80/tcp` only for ACME
HTTP-01 challenge and immediate redirect; `22/tcp` **only from the GitHub Actions
runner path** (see §16) or your own IP. Never expose `3000` publicly.

**db** (Managed MySQL) — inbound `3306/tcp` **only** from the app instance's private
address. No public access.

Both instances on the same **VPC 2.0** private network so database traffic never
crosses the public internet.

---

## 10. HTTPS / SSL

Caddy or nginx + Certbot on the app instance, terminating TLS on `443` and proxying to
`127.0.0.1:3000`. Caddy is the simpler choice: automatic issuance and renewal with a
two-line config.

**Non-negotiable, because Slice 1 depends on it:** the proxy must send
`X-Forwarded-Proto: https`. Production has `trust proxy` enabled and pins the session
cookie's `Secure` flag; the cookie is `SameSite=None`, which browsers **discard**
without `Secure`. Get this wrong and users are silently signed out.

Set HSTS. The audit also found no `helmet` and no security headers at all — add them
with this tier.

---

## 11. DNS

| Record | Points to | Notes |
|---|---|---|
| `buildhub.<domain>` | production instance IP | A record |
| `www` | `buildhub.<domain>` | CNAME → redirect |
| `staging.<domain>` | staging instance IP | A record; **exclude from indexing** |

Keep TTL low (300 s) during rollout. Reserve a static IP for each instance so a rebuild
does not change DNS. **Requires your action** — I have not touched DNS and will not.

---

## 12. GitHub Actions — CI pipeline

`.github/workflows/ci.yml`, on every push and pull request:

```
checkout → setup-node (pin 22, cache) → npm ci
        → npm run check        (tsc)
        → npm test             (vitest, 660 tests)
        → npm run build        (client + server)
```

No secrets, no deployment. Make this a **required status check** on `main` and
`develop` (§22). **Requires implementation** — nothing exists today.

---

## 13. Staging deployment pipeline

`.github/workflows/deploy-staging.yml`, on push to `develop`:

```
CI must pass → build artifact → rsync/scp to staging
             → npm ci --omit=dev  (--packages=external means node_modules must ship)
             → npm run db:migrate  (apply-only)
             → restart service     (systemd)
             → health check        (§18)
             → smoke tests
```

No approval gate. Staging exists to fail first.

---

## 14. Production deployment pipeline + manual approval

`.github/workflows/deploy-production.yml`, on push to `main`, targeting a GitHub
**Environment** named `production` with **required reviewers**. The job pauses until a
human approves; that approval is recorded in the deployment history (§21).

```
CI must pass
  → [MANUAL APPROVAL GATE]
  → database backup snapshot
  → deploy artifact
  → npm run db:migrate
  → restart
  → health check + smoke tests
  → on failure: automatic rollback (§19)
```

Also set the environment's **deployment branch rule to `main` only** — this is what
makes it impossible to deploy production from a feature branch (§22).

---

## 15. Secrets management

GitHub **Environment** secrets, scoped per environment so a staging secret can never
reach production:

| Secret | Staging | Production |
|---|---|---|
| `JWT_SECRET` | distinct | distinct, ≥32 chars (enforced at boot) |
| `DATABASE_URL` | staging DB | production DB |
| `OAUTH_SERVER_URL`, `VITE_APP_ID`, `OWNER_OPEN_ID` | ✓ | ✓ |
| Object storage keys | staging bucket | production bucket |
| `SSH_HOST`, `SSH_USER`, `SSH_KEY` | staging host | production host |

Never in the repository, never echoed in workflow logs, never passed on a command line
where `ps` can see them. Rotate on any suspicion. `.env.example` documents the full
list without values.

---

## 16. SSH / deployment authentication

A dedicated `deploy` user per host, not root. An **ed25519 key used only by CI**, with
`command=` restrictions in `authorized_keys` so the key cannot open an interactive
shell. Private key in GitHub Environment secrets; public key on the host.

Because GitHub-hosted runners have changing IPs, either allow SSH from GitHub's
published ranges, or run a self-hosted runner inside the VPC — cleaner, and it keeps
`22/tcp` closed to the internet entirely. **Requires your action** to create the key
pair and the host user.

---

## 17. Database migration strategy

- **Apply-only in pipelines**: `npm run db:migrate` (`drizzle-kit migrate`). Never
  `db:push` — it runs `generate` first and would author new migrations from whatever
  schema the runner happens to see.
- **Backup immediately before migrating** in production.
- **Additive-first discipline**, already the project's convention: recent migrations
  are `CREATE TABLE` / `ADD COLUMN` only, with RESTRICT foreign keys. Keep destructive
  changes out of automated deploys; do them deliberately, with a fresh backup.
- Migrations run **before** the new code starts, so additive changes are compatible
  with both the old and new process during the restart window.

---

## 18. Health checks and smoke tests

**The current health endpoint is unusable as a probe.** `system.health` is a tRPC
procedure requiring a superjson-encoded input, and it checks nothing — it cannot tell
you the database is reachable.

**Requires implementation:** a plain `GET /healthz` that returns 200 only when the
process is up **and** a trivial database query succeeds, and 503 otherwise. That is
what the deploy gate and any future load balancer need.

Smoke tests after each deploy: `/healthz` 200 · `/` serves the app shell ·
`billing.plans` returns the catalogue (public, no auth, exercises the tRPC stack) ·
`/pricing` renders · an unauthenticated protected procedure returns 401 rather than
500. Fail the deploy — and roll back — if any fails.

---

## 19. Rollback strategy

Deploy to a timestamped directory with a `current` symlink; rollback is repointing the
symlink and restarting — seconds, no rebuild.

```
/srv/buildhub/releases/2026-08-20T14-22-05/
/srv/buildhub/current -> releases/2026-08-20T14-22-05
```

Keep the last five releases. Rollback triggers automatically on a failed health check
or smoke test.

**Database rollback is not symmetric and must not be automated.** Additive migrations
are safe to leave in place while the code rolls back. A destructive migration needs the
pre-deploy backup and a human decision — which is the main reason destructive changes
stay out of automated deploys (§17).

---

## 20. Logging and monitoring

The audit found **no structured logging** (25 raw `console.*`), **no error tracking**,
and no metrics. Minimum for production:

- **Structured JSON logging** with a request id — replace `console.*` with `pino`.
- **Error tracking** (Sentry or equivalent). `ErrorBoundary.componentDidCatch` was
  added in Slice 1 specifically as the hook point.
- **Uptime monitoring** against `/healthz` with alerting.
- **Log rotation** on the host; ship off-instance so a rebuild does not lose them.

**Never log** passwords, session tokens, `JWT_SECRET`, database credentials, or object
storage keys. The Slice 1 `errorFormatter` already stops internal error text reaching
clients; logging must not undo that at the other end.

---

## 21. Deployment audit trail

GitHub gives most of this for free once §14 is in place: every deployment recorded
against a commit SHA, with the approver's identity, timestamp and full job log, in the
`production` Environment's deployment history. Retain workflow logs at the maximum
setting. On the host, `releases/` directory names are themselves a deployment log.

Tag every production release (`v2026.08.20-1`) so a rollback target is nameable.

---

## 22. Protection against accidental deployment from a feature branch

Four independent layers — any one alone is insufficient:

1. **Environment deployment branch rule**: `production` accepts deployments from
   `main` only. This is the hard stop.
2. **Workflow trigger**: `on: push: branches: [main]`.
3. **Branch protection on `main`**: require a pull request, require CI to pass, no
   force-push, no deletion.
4. **Required reviewers** on the `production` environment — a human approves each
   deployment.

---

## 23. Exact Vultr resources to create

*All SKUs, regions and prices to be verified in the Vultr console — I could not reach
Vultr from this environment.*

| # | Resource | Spec | Environment |
|---|---|---|---|
| 1 | VPC 2.0 network | private subnet | staging |
| 2 | VPC 2.0 network | private subnet | production |
| 3 | Cloud Compute | ~1 vCPU / 2 GB, Ubuntu LTS | staging |
| 4 | Cloud Compute | ~2 vCPU / 4 GB, Ubuntu LTS | production |
| 5 | Managed MySQL | smallest tier, private endpoint, backups on | staging |
| 6 | Managed MySQL | smallest tier, private endpoint, backups on | production |
| 7 | Object Storage bucket | private, `buildhub-staging` | staging |
| 8 | Object Storage bucket | private, `buildhub-production` | production |
| 9 | Firewall group `web` | 443 public; 80 ACME; 22 restricted | both |
| 10 | Firewall group `db` | 3306 from app private IP only | both |
| 11 | Reserved IP | static, per instance | both |

**Order of creation:** VPC → Managed MySQL → Compute → attach firewall groups →
Object Storage → reserved IPs → DNS → TLS.

---

## 24. Classification of all 22 requested items

| # | Item | Classification |
|---|---|---|
| 1 | Staging architecture | **Requires implementation** (designed here) |
| 2 | Production architecture | **Requires implementation** (designed here) |
| 3 | Region from Egypt latency testing | **Requires your action** — unreachable from here (§4) |
| 4 | Compute sizing | **Requires configuration** — recommended §5, verify SKUs |
| 5 | Managed MySQL | **Requires configuration** (§6) |
| 6 | Object/file storage | **Requires implementation** — needs the S3 adapter (§2.1, §7) |
| 7 | Backups and recovery | **Requires configuration** + a restore drill (§8) |
| 8 | Firewall / network | **Requires configuration** (§9) |
| 9 | HTTPS / SSL | **Requires configuration** (§10) |
| 10 | DNS / domain | **Requires your action** (§11) |
| 11 | GitHub Actions CI | **Requires implementation** — no `.github/` exists (§12) |
| 12 | Staging deploy pipeline | **Requires implementation** (§13) |
| 13 | Production deploy pipeline | **Requires implementation** (§14) |
| 14 | Production env + manual approval | **Requires your action** (GitHub settings) + implementation (§14) |
| 15 | Secrets management | **Requires your action** (§15) |
| 16 | SSH / deployment auth | **Requires your action** (§16) |
| 17 | Migration strategy | **Already available** — `db:migrate` shipped in Slice 1 (§17) |
| 18 | Health checks and smoke tests | **Requires implementation** — current endpoint unusable (§18) |
| 19 | Rollback strategy | **Requires implementation** (§19) |
| 20 | Logging and monitoring | **Requires implementation** (§20) |
| 21 | Deployment audit trail | **Requires configuration** — mostly free with §14 (§21) |
| 22 | Feature-branch deploy protection | **Requires configuration** (§22) |
| — | Forge storage coupling | **Requires implementation** (§2.1) |
| — | OAuth sign-in path | **BLOCKED — requires your decision** (§2.2) |

---

## 25. Compatibility with Phase 4A / 4B

Verified compatible. The architecture carries every environment variable those phases
depend on and preserves each fail-closed behaviour:

- Boot validation (`JWT_SECRET`, `DATABASE_URL`) turns a misconfigured deploy into a
  failed deploy rather than a silently broken one.
- `trust proxy` + pinned `Secure` cookie require the TLS tier of §10 to forward
  `X-Forwarded-Proto` — called out there explicitly.
- Session revocation now **fails closed** on database loss, so database availability is
  a hard dependency of authentication. This is why §6 puts MySQL on a private endpoint
  in the same VPC rather than across the internet.
- The Phase 4B billing lifecycle uses `SELECT … FOR UPDATE` row locks — fine on
  Managed MySQL, but it means **exactly one migration runner at a time**; the pipelines
  are serialised accordingly.
- `authorizeStorageKey()` authorises every object read, which is why §7 requires a
  private bucket.
- No payment provider is configured, so nothing here provisions Paymob resources.
  Phase 4B.5 remains blocked on its own prerequisites.

---

## 26. Recommended sequence

1. **You:** decide the OAuth question (§2.2). It gates real-user sign-in.
2. **You:** run the Egypt latency test (§4) and record the numbers here.
3. **Me:** the storage S3 adapter and dead-scaffold cleanup (§2.1).
4. **Me:** `/healthz` (§18), structured logging and helmet (§20).
5. **Me:** CI workflow (§12) — valuable immediately, independent of any hosting.
6. **You:** create Vultr resources in the §23 order for **staging only**.
7. **Me:** staging deploy pipeline (§13); prove the whole path end to end.
8. **You + me:** restore drill (§8) before production exists.
9. **You:** production resources; **me:** production pipeline with the approval gate.
10. Smoke, rollback rehearsal, then a real deployment decision.

Staging first, always. Nothing about production is designed to be attempted before the
same path has worked on staging.

---

## Final status

**ARCHITECTURE READY FOR REVIEW — NOT READY TO IMPLEMENT.**

Two items need your decision before implementation starts: the **OAuth sign-in path**
(§2.2, a launch blocker) and the **region latency measurement** (§4, which I cannot
perform). Everything else is specified and sequenced.

**STOP.** No pipeline implementation until you have reviewed this architecture.
