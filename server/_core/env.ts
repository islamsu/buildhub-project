export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  // Test-user sign-in (auth.signInDummy), OFF unless explicitly switched on.
  //
  // It cannot be gated on isProduction: staging runs NODE_ENV=production too
  // (render.yaml sets it), so that check would either disable test login on
  // staging - the one place it is meant to work - or leave it live in
  // production. Neither is acceptable, so the switch is its own explicit,
  // default-denied flag.
  //
  // Compared against the exact string "true": an unset, empty, misspelt or
  // truthy-looking value ("1", "yes", "TRUE") all mean OFF. A misconfiguration
  // must fail closed, and this is the flag standing between a production
  // deployment and a password-less session.
  //
  // PRODUCTION MUST NEVER SET THIS.
  // OBJECT STORAGE AND NOTIFICATIONS ONLY. The AI assistant used to run through
  // this gateway too; it now talks to OpenAI directly (see openAi* below), and
  // nothing on the /ai path reads either of these.
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // ── AI assistant: OpenAI, directly ─────────────────────────────────────────
  //
  // The key is the only thing that decides whether the feature exists. The
  // model has a default so a deployment cannot be half-configured into a
  // confusing state - a key with no model still works.
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  // gpt-5.6-luna, not the bare "gpt-5.6" alias: that alias routes to Sol, a
  // different and more expensive model. BuildHub AI is a high-volume assistant,
  // and Luna is the cost/performance tier intended for exactly that.
  openAiModel: (process.env.OPENAI_MODEL ?? "").trim() || "gpt-5.6-luna",
  // Optional. Only for a compatible gateway or a regional endpoint; empty means
  // the official https://api.openai.com/v1.
  openAiBaseUrl: (process.env.OPENAI_BASE_URL ?? "").trim(),
  // Public origin of this deployment, e.g. https://buildhub.eg. Used to build
  // the links inside outbound email. Deliberately NOT derived from the request's
  // Host header: an attacker who can set that header could otherwise have a
  // password-reset link addressed to a host they control mailed to the victim.
  appBaseUrl: (process.env.APP_BASE_URL ?? "").replace(/\/+$/, ""),
  // S3-compatible object storage (Slice 5). When a bucket is configured these
  // take precedence over Forge, so migrating off the Manus platform is a
  // configuration change rather than a code change. Vultr Object Storage, AWS
  // S3, MinIO and Backblaze B2 all speak this.
  s3Endpoint: (process.env.S3_ENDPOINT ?? "").replace(/\/+$/, ""),
  s3Region: process.env.S3_REGION ?? "",
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  // Virtual-host addressing needs a wildcard certificate on the endpoint, which
  // most non-AWS providers do not have. Default on; set false for AWS proper.
  s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
};

/**
 * Minimum acceptable length for the session-signing secret.
 *
 * The value that matters is not this number but the fact that ANY check exists:
 * before this, `JWT_SECRET` defaulted to `""` and `getSessionSecret()` happily
 * returned `new TextEncoder().encode("")`, so a deployment with the variable
 * missing would start normally and sign every session JWT with a zero-length
 * key. Nothing anywhere reported it. 32 characters is the conventional floor
 * for an HMAC secret.
 */
const MIN_SECRET_LENGTH = 32;

export type EnvProblem = { variable: string; problem: string };

/**
 * Check the variables whose absence causes a SILENT failure.
 *
 * Deliberately narrow. A variable belongs here only if the application keeps
 * running while quietly doing the wrong thing:
 *
 *  - `JWT_SECRET` — signs and verifies sessions. Empty means forgeable tokens.
 *  - `DATABASE_URL` — `getDb()` returns null and every caller degrades to an
 *    empty result, so the app looks healthy while serving nothing.
 *
 * Variables that already fail loudly are NOT listed. `BUILT_IN_FORGE_*` throws
 * a clear error on first upload (`storage.ts`), and `OAUTH_SERVER_URL` logs an
 * explicit error at startup. Adding them here would turn a working deployment
 * that simply does not use uploads into a boot failure.
 */
export function findEnvProblems(env = ENV): EnvProblem[] {
  const problems: EnvProblem[] = [];

  if (env.cookieSecret.length === 0) {
    problems.push({ variable: "JWT_SECRET", problem: "is not set; sessions would be signed with an empty key" });
  } else if (env.cookieSecret.length < MIN_SECRET_LENGTH) {
    problems.push({
      variable: "JWT_SECRET",
      problem: `is only ${env.cookieSecret.length} characters; at least ${MIN_SECRET_LENGTH} are required`,
    });
  }

  if (env.databaseUrl.length === 0) {
    problems.push({ variable: "DATABASE_URL", problem: "is not set; every query would silently return nothing" });
  }

  return problems;
}

/**
 * Fail fast on a misconfigured production boot.
 *
 * Production refuses to start. Development only warns, so local work against a
 * throwaway secret and no database keeps behaving as it always has - the tests
 * and the local dev server both rely on that.
 *
 * Called explicitly from startServer() rather than at module load, so importing
 * this module (which the whole test suite does, transitively) can never throw.
 */
export function assertEnvOrExit(env = ENV, log: Pick<Console, "error" | "warn"> = console): void {
  const problems = findEnvProblems(env);
  if (problems.length === 0) return;

  const lines = problems.map(p => `  - ${p.variable} ${p.problem}`).join("\n");

  if (!env.isProduction) {
    log.warn(`[env] Configuration problems (allowed outside production):\n${lines}`);
    return;
  }

  log.error(
    `[env] Refusing to start: required configuration is missing or unusable.\n${lines}\n` +
      `Set these before starting in production. See .env.example.`,
  );
  process.exit(1);
}

/**
 * Is test-user sign-in (auth.signInDummy) switched on for this deployment?
 *
 * Read at CALL TIME rather than baked into ENV at import, so the boundary is
 * exercisable by tests without module-reset gymnastics. A flag nobody can test
 * is a flag nobody should trust, and this one stands between a production
 * deployment and a password-only session.
 *
 * It cannot be derived from isProduction: staging runs NODE_ENV=production too
 * (render.yaml sets it), so that check would either disable test login on
 * staging - the one place it is meant to work - or leave it live in
 * production.
 *
 * Compared against the exact string "true". Unset, empty, "1", "yes", "TRUE"
 * and " true" all mean OFF: a misconfiguration must fail closed.
 *
 * PRODUCTION MUST NEVER SET THIS.
 */
export function isTestLoginEnabled(): boolean {
  return process.env.TEST_LOGIN_ENABLED === "true";
}
