import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Zero-dependency .env loader for local development — Fly.io injects
 * real secrets as process env vars directly, so this only matters when
 * running outside production and only fills in vars not already set
 * (never overrides a real deployment's env).
 */
function loadDotEnv(): void {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.join(dir, "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

/**
 * Environment validation — the process refuses to boot with a broken
 * configuration instead of failing at request time.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z.string().min(10),
  REDIS_URL: z.string().min(10).optional(),

  JWT_SECRET: z.string().min(32),

  BREVO_API_KEY: z.string().min(10).optional(),
  BREVO_SENDER_EMAIL: z.string().email().default("preciousmofeoluwa@gmail.com"),
  BREVO_SENDER_NAME: z.string().default("ImpactDNA"),

  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  BACKEND_URL: z.string().url().default("http://localhost:8080"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  GENLAYER_RPC_URL: z.string().url().default("https://studio.genlayer.com/api"),
  GENLAYER_CONTRACT_ADDRESS: z.string().default(""),
  GENLAYER_NETWORK: z.string().default("studionet"),

  // Base Sepolia relay: bridges GenLayer's ledger to the ImpactDnaEscrow
  // USDC vault. One relayer key signs on both chains (a plain secp256k1
  // EOA works as both an ethers.js wallet and a genlayer-js account).
  BASE_SEPOLIA_RPC_URL: z.string().url().default("https://sepolia.base.org"),
  BASE_SEPOLIA_RELAYER_PRIVATE_KEY: z.string().default(""),
  USDC_CONTRACT_ADDRESS: z.string().default("0x036CbD53842c5426634e7929541eC2318f3dCF7e"),
  IMPACT_DNA_ESCROW_ADDRESS: z.string().default(""),
  BASE_SEPOLIA_DEPOSIT_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(3),
  RELAY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),

  // Curator/admin GenLayer writes (open/close epoch, fraud screen, appeal
  // resolution, curator management) stay backend-signed by one operator
  // key — these are rare, trusted-operator actions, unlike per-user
  // writes (submit_contribution, evaluate_contribution, ...), which are
  // now signed client-side by the user's own connected wallet.
  GENLAYER_OPERATOR_PRIVATE_KEY: z.string().default(""),

  GITHUB_CLIENT_ID: z.string().default(""),
  GITHUB_CLIENT_SECRET: z.string().default(""),
  GITHUB_OAUTH_CALLBACK_URL: z.string().url().optional(),

  ACCESS_TOKEN_TTL: z.string().default("2h"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Redis conservation knobs — long TTLs keep command volume low.
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(180),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
});

// Treat empty-string env vars as unset (common with .env templates).
const cleanedEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== ""),
);

const parsed = EnvSchema.safeParse(cleanedEnv);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === "production";
export const githubCallbackUrl =
  config.GITHUB_OAUTH_CALLBACK_URL || `${config.BACKEND_URL}/api/auth/github/callback`;
