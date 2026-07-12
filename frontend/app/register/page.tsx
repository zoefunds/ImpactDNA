"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { ErrorNote } from "@/components/ui";
import { api, setSession } from "@/lib/api";

export default function Register() {
  const router = useRouter();
  const [form, setForm] = useState({ displayName: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await api<{ user: unknown; accessToken: string; refreshToken: string }>(
        "/api/auth/register",
        { method: "POST", body: form, auth: false },
      );
      setSession(res.accessToken, res.refreshToken, res.user);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="A permanent blockchain wallet is generated for you — it survives device changes and never changes address."
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNote message={error} />}
        <div>
          <label className="label-caps text-on-variant block mb-2">Display name</label>
          <input
            className="input-field"
            required
            minLength={2}
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="Ada Lovelace"
          />
        </div>
        <div>
          <label className="label-caps text-on-variant block mb-2">Email</label>
          <input
            className="input-field"
            type="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="label-caps text-on-variant block mb-2">Password</label>
          <input
            className="input-field"
            type="password"
            required
            minLength={10}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="10+ chars, upper, lower, digit"
          />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
        <p className="text-center text-sm text-on-variant">
          Already registered?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
