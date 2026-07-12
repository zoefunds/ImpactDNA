"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { ErrorNote } from "@/components/ui";
import { api, setSession } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api<{ user: unknown; accessToken: string; refreshToken: string }>(
        "/api/auth/login",
        { method: "POST", body: form, auth: false },
      );
      setSession(res.accessToken, res.refreshToken, res.user);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your ImpactDNA account.">
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNote message={error} />}
        <div>
          <label className="label-caps text-on-variant block mb-2">Email</label>
          <input
            className="input-field"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label className="label-caps text-on-variant block mb-2">Password</label>
          <input
            className="input-field"
            type="password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div className="flex justify-between text-sm">
          <Link href="/forgot-password" className="text-cyan-dim hover:underline">
            Forgot password?
          </Link>
          <Link href="/register" className="text-primary hover:underline">
            Create account
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
