"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { ErrorNote } from "@/components/ui";
import { api } from "@/lib/api";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: { token, password },
        auth: false,
      });
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <ErrorNote message="Missing reset token — use the link from your email." />;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorNote message={error} />}
      <div>
        <label className="label-caps text-on-variant block mb-2">New password</label>
        <input
          className="input-field"
          type="password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="10+ chars, upper, lower, digit"
        />
      </div>
      <button className="btn-primary w-full" disabled={busy}>
        {busy ? "Saving…" : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPassword() {
  return (
    <AuthShell title="Choose a new password" subtitle="This link works once and expires after 30 minutes.">
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
