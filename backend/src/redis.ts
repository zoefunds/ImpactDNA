import { Redis } from "ioredis";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";

/**
 * Redis conservation strategy (Upstash bills per command):
 *  - single lazy connection, no periodic PINGs, no keyspace scans;
 *  - every key carries a TTL (nothing accumulates);
 *  - reads go through an in-process micro-cache first, so hot keys cost
 *    one Redis command per TTL window per instance, not per request;
 *  - if Redis is unreachable the app degrades to in-memory behaviour
 *    instead of hammering the endpoint with retries.
 */

let client: Redis | null = null;
let broken = false;

function getClient(): Redis | null {
  if (!config.REDIS_URL || broken) return null;
  if (!client) {
    client = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 2000, 10_000)),
    });
    client.on("error", (err) => {
      logger.warn({ err: err.message }, "redis error — degrading to memory");
    });
    client.on("end", () => {
      broken = true; // stop issuing commands until process restart
    });
  }
  return client;
}

/** In-process micro-cache in front of Redis. */
const memCache = new Map<string, { value: string; expiresAt: number }>();
const MEM_CACHE_MAX = 500;

function memGet(key: string): string | null {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    memCache.delete(key);
    return null;
  }
  return hit.value;
}

function memSet(key: string, value: string, ttlSeconds: number): void {
  if (memCache.size >= MEM_CACHE_MAX) {
    const first = memCache.keys().next().value;
    if (first) memCache.delete(first);
  }
  memCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheGet(key: string): Promise<string | null> {
  const local = memGet(key);
  if (local !== null) return local;
  const r = getClient();
  if (!r) return null;
  try {
    const value = await r.get(key);
    if (value !== null) memSet(key, value, Math.min(config.CACHE_TTL_SECONDS, 60));
    return value;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  const ttl = ttlSeconds ?? config.CACHE_TTL_SECONDS;
  memSet(key, value, Math.min(ttl, 60));
  const r = getClient();
  if (!r) return;
  try {
    await r.set(key, value, "EX", ttl);
  } catch {
    /* degraded mode */
  }
}

/** Fixed-window rate limiter: exactly 1-2 Redis commands per hit. */
const memCounters = new Map<string, { count: number; resetAt: number }>();

export async function rateLimitHit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const r = getClient();
  if (r) {
    try {
      const full = `rl:${key}`;
      const count = await r.incr(full);
      if (count === 1) await r.expire(full, windowSeconds);
      return count <= limit;
    } catch {
      /* fall through to memory */
    }
  }
  const now = Date.now();
  const entry = memCounters.get(key);
  if (!entry || entry.resetAt < now) {
    memCounters.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
  }
}
