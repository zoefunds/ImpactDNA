import type { Request, Response, NextFunction } from "express";
import { rateLimitHit } from "../redis.js";
import { config } from "../config.js";

/**
 * Named rate limit buckets. Sensitive auth endpoints get strict Redis-
 * backed limits (shared across instances); general API traffic is
 * limited in-process only, costing zero Redis commands.
 */
export function rateLimit(bucket: string, limit: number, windowSeconds?: number) {
  const windowSecs = windowSeconds ?? config.RATE_LIMIT_WINDOW_SECONDS;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip ?? "unknown";
    const ok = await rateLimitHit(`${bucket}:${ip}`, limit, windowSecs);
    if (!ok) {
      res.status(429).json({ error: "Too many requests — slow down" });
      return;
    }
    next();
  };
}
