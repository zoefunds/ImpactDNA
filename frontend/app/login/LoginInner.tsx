"use client";


import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAppKit } from "@reown/appkit/react";
import { useAccount, useSignMessage, useDisconnect } from "wagmi";
import { AuthShell } from "@/components/AuthShell";
import { ErrorNote } from "@/components/ui";
import { api, setSession, shortAddr } from "@/lib/api";

export default function LoginInner() {
  const router = useRouter();
  const { open } = useAppKit();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  async function signIn() {
    if (!address) return;
    setError("");
    setBusy(true);
    try {
      const { message } = await api<{ nonce: string; message: string }>(
        `/api/auth/nonce?address=${address}`,
        { auth: false },
      );
      const signature = await signMessageAsync({ message });
      const res = await api<{ user: unknown; accessToken: string; refreshToken: string }>(
        "/api/auth/verify",
        { method: "POST", body: { address, message, signature }, auth: false },
      );
      setSession(res.accessToken, res.refreshToken, res.user);
      setSignedIn(true);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  // Prompt the signature step automatically once a wallet connects.
  useEffect(() => {
    if (isConnected && address && !signedIn && !busy) {
      void signIn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  return (
    <AuthShell title="Connect your wallet" subtitle="Sign in to ImpactDNA — no email or password needed.">
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}
        {!isConnected ? (
          <button className="btn-primary w-full" onClick={() => open()}>
            Connect wallet
          </button>
        ) : (
          <div className="space-y-3 text-center">
            <p className="text-on-variant text-sm">
              Connected as <span className="font-mono text-primary">{shortAddr(address)}</span>
            </p>
            <button className="btn-primary w-full" disabled={busy} onClick={signIn}>
              {busy ? "Signing…" : "Sign message to log in"}
            </button>
            <button
              className="text-xs text-on-variant hover:underline"
              onClick={() => disconnect()}
            >
              Use a different wallet
            </button>
          </div>
        )}
        <p className="text-on-variant text-xs text-center mt-4">
          Signing is free and only proves wallet ownership — it never sends a transaction.
        </p>
      </div>
    </AuthShell>
  );
}
