# BuildHub — Owner Preview on Staging

**What you asked for:** open BuildHub and see the release candidate while work
continues, with production untouched.

**What is blocking it:** one Render setting. Everything on the code side is
ready.

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

## The precise owner action

Render's `buildhub-staging` service currently tracks **`main`**. `main` is 41
commits behind the release candidate, which is why staging shows old work.

**In the Render dashboard → `buildhub-staging` → Settings:**

1. **Branch** → change from `main` to
   `claude/buildhub-global-release-candidate`
2. **Auto-Deploy** → confirm it is **On**
3. **Environment → Add Environment Variable:**
   - Key: `APP_ENV`
   - Value: `staging`
4. **Save**, then **Manual Deploy → Deploy latest commit**

That is the whole change. Four fields.

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

## Confirming it worked

Open:

```
https://<your-staging-host>/version
```

You should see four fields and nothing else:

```json
{
  "commit": "72f3b17...",
  "shortCommit": "72f3b17",
  "buildTime": "2026-09-22T...",
  "environment": "staging"
}
```

- `shortCommit` must match the release-candidate head.
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
