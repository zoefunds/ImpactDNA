"use client";

import { useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { ErrorNote } from "@/components/ui";
import { api } from "@/lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/auth/forgot-password", { method: "POST", body: { email }, auth: false });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a secure one-time reset link.">
      {sent ? (
        <div className="bg-green/10 border border-green/30 text-green rounded-lg px-4 py-4 text-sm text-center">
          If that email exists, a reset link is on its way. Check your inbox (and spam folder).
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorNote message={error} />}
          <div>
            <label className="label-caps text-on-variant block mb-2">Email</label>
            <input
              className="input-field"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
