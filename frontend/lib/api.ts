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

/** USDC uses 6 decimals (base units), unlike GEN's 18. */
export function formatUsdc(units?: string | number | null): string {
  if (units === null || units === undefined) return "0";
  try {
    const n = BigInt(String(units));
    const whole = n / 10n ** 6n;
    const frac = n % 10n ** 6n;
    return `${whole.toLocaleString()}${frac > 0n ? "." + String(frac).padStart(6, "0").replace(/0+$/, "") : ""}`;
  } catch {
    return String(units);
  }
}

/** Parse a human USDC amount ("100" or "1.50") into a base-unit integer string. */
export function parseUsdc(usdc: string): string {
  const s = usdc.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter a valid USDC amount, e.g. 100 or 1.50");
  const [whole, frac = ""] = s.split(".");
  if (frac.length > 6) throw new Error("USDC amount has too many decimal places");
  const fracPadded = frac.padEnd(6, "0");
  return (BigInt(whole || "0") * 10n ** 6n + BigInt(fracPadded || "0")).toString();
}
