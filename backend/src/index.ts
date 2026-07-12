import express from "express";
import helmet from "helmet";
import cors from "cors";
import { config, isProd } from "./config.js";
import { migrate, pool } from "./db.js";
import { closeRedis } from "./redis.js";
import { logger } from "./lib/logger.js";
import { authRouter } from "./routes/auth.js";
import { walletRouter } from "./routes/wallet.js";
import { platformRouter } from "./routes/platform.js";
import { contributionsRouter } from "./routes/contributions.js";
import { adminRouter } from "./routes/admin.js";
import { notFound, errorHandler } from "./middleware/errors.js";
import { rateLimit } from "./middleware/rateLimit.js";

/**
 * ImpactDNA API server.
 * Designed to run 24/7 on Fly.io: never exits on recoverable errors,
 * health-checked at /health, drains connections on SIGTERM (deploys).
 */

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(helmet());
app.use(
  cors({
    origin: config.CORS_ORIGINS.split(",").map((s) => s.trim()),
    credentials: false,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  }),
);
app.use(express.json({ limit: "64kb" }));

// Global in-process limiter (0 Redis cost) as a coarse safety net.
app.use(rateLimit("global", 600, 300));

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), version: "1.0.0" });
});

app.use("/api/auth", authRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/platform", platformRouter);
app.use("/api/contributions", contributionsRouter);
app.use("/api/admin", adminRouter);

app.use(notFound);
app.use(errorHandler);

// Crash-proofing: log and keep serving. Fly restarts the machine on a
// real crash, but recoverable async failures must never kill the API.
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandled rejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception");
  if (!isProd) process.exit(1);
});

async function main(): Promise<void> {
  await migrate();
  const server = app.listen(config.PORT, "0.0.0.0", () => {
    logger.info({ port: config.PORT }, "ImpactDNA API listening");
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down gracefully");
    server.close(async () => {
      await Promise.allSettled([pool.end(), closeRedis()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "failed to start");
  process.exit(1);
});
