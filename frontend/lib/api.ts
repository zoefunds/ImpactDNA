"use client";

/** Typed client for the ImpactDNA API with token persistence. */

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("impactdna_token");
}

export function setSession(token: string, refresh: string, user: unknown): void {
  localStorage.setItem("impactdna_token", token);
  localStorage.setItem("impactdna_refresh", refresh);
  localStorage.setItem("impactdna_user", JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem("impactdna_token");
  localStorage.removeItem("impactdna_refresh");
  localStorage.removeItem("impactdna_user");
}

export function currentUser<T = Record<string, unknown>>(): T | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("impactdna_user");
  return raw ? (JSON.parse(raw) as T) : null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, String(data.error ?? `Request failed (${res.status})`));
  }
  return data as T;
}

export function shortAddr(addr?: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatGen(atto?: string | number | null): string {
  if (atto === null || atto === undefined) return "0";
  try {
    const n = BigInt(String(atto));
    const whole = n / 10n ** 18n;
    const frac = (n % 10n ** 18n) / 10n ** 14n;
    return `${whole.toLocaleString()}${frac > 0n ? "." + String(frac).padStart(4, "0").replace(/0+$/, "") : ""}`;
  } catch {
    return String(atto);
  }
}

/** Parse a human GEN amount ("100" or "1.5") into an atto-unit integer string. */
export function parseGen(gen: string): string {
  const s = gen.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter a valid GEN amount, e.g. 100 or 1.5");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 18) throw new Error("GEN amount has too many decimal places");
  const fracPadded = frac.padEnd(18, "0");
  return (BigInt(whole || "0") * 10n ** 18n + BigInt(fracPadded || "0")).toString();
}
