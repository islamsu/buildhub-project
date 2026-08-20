export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Public origin of this deployment, e.g. https://buildhub.eg. Used to build
  // the links inside outbound email. Deliberately NOT derived from the request's
  // Host header: an attacker who can set that header could otherwise have a
  // password-reset link addressed to a host they control mailed to the victim.
  appBaseUrl: (process.env.APP_BASE_URL ?? "").replace(/\/+$/, ""),
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
