# BuildHub — Owner Preview on Staging

**What you asked for:** open BuildHub and see the release candidate while work
continues, with production untouched.

**Owner decision:** staging should track the active release candidate during final QA. The repository Blueprint now records that decision. An existing Render service may still require a Blueprint sync or dashboard branch change before the live service actually follows it.

---

## The blocker, diagnosed once

`api.render.com:443` is refused **at the network proxy**, not by Render:

```
connect_rejected  api.render.com:443
```

That is this engineering container's organization egress policy. It is not a
credential problem, not TLS, and not something a retry fixes. **I cannot reach
Render from here and will not keep rediscovering that.** The setting below has
to be made by you in the Render dashboard.

---

## Owner-approved staging source

The owner has approved using the canonical release-candidate branch for the staging preview during final QA.

The repository Blueprint now declares:

```yaml
branch: claude/buildhub-global-release-candidate
autoDeploy: true
```

This aligns the checked-in deployment intent with the release process.

**Important:** an already-provisioned Render service does not become current merely because this file changed. If Render has not synchronized the Blueprint/source setting yet, use the Render dashboard for `buildhub-staging` to:

1. confirm **Branch** = `claude/buildhub-global-release-candidate`
2. confirm **Auto-Deploy** = On
3. confirm `APP_ENV=staging`
4. save/sync and deploy the latest commit

No deployment is considered proven until `/version` reports the exact current RC SHA and `environment: "staging"`.

### Why `APP_ENV` is on that list

Staging sets `NODE_ENV=production` — every deployed environment does, because
React and Vite need it to take their optimised paths. `/version` was reporting
that as the environment, so **staging announced itself as production**. That is
the single most dangerous thing the build stamp can say, and the exact
ambiguity it exists to remove. `APP_ENV` names the deployment; `NODE_ENV` stays
a build mode.

Without step 3 the site still works — it will just report `environment:
"production"` while being staging.

---

## Confirming it worked — and why you have to be the one to do it

**`*.onrender.com` is blocked from this engineering container, not just the
Render API.** Confirmed at the proxy:

```
connect_rejected  buildhub-staging.onrender.com:443
```

A control request to an allowed host succeeds from the same container, so this
is the organization egress policy and not a network fault. **I cannot open the
staging site, so I will never tell you a SHA is deployed — only you can see
that.** What I can do is make checking it mechanical rather than a matter of
comparing two long hex strings by eye:

```
curl -s https://buildhub-staging.onrender.com/version | node scripts/verify-staging.mjs
```

It compares against the release-candidate head in your checkout and prints one
of two answers. It exits non-zero on any of:

- staging is **behind** — it says by how many commits
- the build reports `commit: "unknown"` — it cannot identify itself
- `environment` reads `production` — wrong host, or `APP_ENV` is missing

Paste its output to me and I will treat it as the build identity for that host.

## What you should see

Open:

```
https://<your-staging-host>/version
```

You should see four fields and nothing else:

```json
{
  "commit": "<current-release-candidate-sha>",
  "shortCommit": "<first-7-chars>",
  "buildTime": "2026-09-22T...",
  "environment": "staging"
}
```

- `commit` / `shortCommit` must match the exact release-candidate head you intended to preview.
- `environment` must read **`staging`**, not `production`.

The same four facts are on **Admin → Operations**, in the "Deployed build"
card, so you can check without leaving the product.

---

## How I will use it

Once staging is reachable, every browser acceptance run is pinned:

```
ZG_EXPECT_COMMIT=<rc-sha> ZG_BASE=https://<staging-host> node evidence/<probe>.mjs
```

The probes **refuse to run** — exit 3, before a single assertion — when the
served build does not match. A pass against the wrong build is worse than no
pass, because somebody acts on it. So if I ever report a feature as visually
verified on staging, the SHA matched.

---

## What stays protected

- Production is **not** deployed by any of this, and never will be without
  your explicit approval.
- Staging keeps its **own** database (`buildhub-staging-db`, a private service)
  and its own generated `JWT_SECRET`. No production secret appears in the
  blueprint.
- Object storage and SMTP remain `sync: false` — supplied in the dashboard or
  left unset. Unset is reported honestly as "not configured" rather than shown
  green.
- Migrations run as `preDeployCommand`, so a bad migration **refuses the
  deploy** and keeps the previous version serving, rather than taking the site
  down. All 57 migrations are proven to apply from empty and over a populated
  database (`evidence/zg-migration0056.mjs`).

---

## After the merge

When the release candidate is eventually merged, switch the branch back to
`main` and redeploy. Staging then verifies the exact merged SHA, which is the
last step before you authorise production.
