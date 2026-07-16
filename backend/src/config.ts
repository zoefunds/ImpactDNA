import { z } from "zod";

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
  WALLET_ENCRYPTION_KEY: z.string().min(32),

  BREVO_API_KEY: z.string().min(10).optional(),
  BREVO_SENDER_EMAIL: z.string().email().default("preciousmofeoluwa@gmail.com"),
  BREVO_SENDER_NAME: z.string().default("ImpactDNA"),

  FRONTEND_URL: z.string().url().default("http://localhost:3000"),
  BACKEND_URL: z.string().url().default("http://localhost:8080"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  GENLAYER_RPC_URL: z.string().url().default("https://studio.genlayer.com/api"),
  GENLAYER_CONTRACT_ADDRESS: z.string().default(""),
  GENLAYER_NETWORK: z.string().default("studionet"),

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
