"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { GlassCard, StatCard, Spinner, ErrorNote } from "@/components/ui";
import { api, currentUser, formatGen, getToken } from "@/lib/api";

interface User {
  role: string;
}

interface Treasury {
  address: string;
  balanceAtto: string;
}

interface PlatformInfo {
  current_epoch: string;
  treasury_atto: string;
  epoch_count: number;
}

interface Payout {
  grant_id: string;
  wallet: string;
  amount_atto: string;
  status: string;
  tx_hash: string | null;
  error: string | null;
}

export default function Admin() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [treasury, setTreasury] = useState<Treasury | null>(null);
  const [info, setInfo] = useState<PlatformInfo | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [depositAtto, setDepositAtto] = useState("");
  const [poolAtto, setPoolAtto] = useState("");
  const [epochLabel, setEpochLabel] = useState("");
  const [curatorAddr, setCuratorAddr] = useState("");

  const refresh = useCallback(async () => {
    await Promise.all([
      api<Treasury>("/api/admin/treasury").then(setTreasury).catch(() => null),
      api<PlatformInfo>("/api/platform/info", { auth: false }).then(setInfo).catch(() => null),
      api<{ items: Payout[] }>("/api/admin/grant-payouts").then((r) => setPayouts(r.items)).catch(() => null),
    ]);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api<{ user: User }>("/api/auth/me")
      .then((r) => {
        if (r.user.role !== "curator" && r.user.role !== "admin") {
          router.push("/dashboard");
          return;
        }
        setUser(r.user);
        refresh();
      })
      .catch(() => router.push("/login"));
  }, [router, refresh]);

  async function run(name: string, fn: () => Promise<unknown>, doneMsg: string) {
    setError("");
    setNotice("");
    setBusy(name);
    try {
      await fn();
      setNotice(doneMsg);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  if (!user) return <Spinner />;

  return (
    <main className="max-w-container mx-auto w-full px-4 md:px-12 py-10 space-y-6">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">Curator Admin</h1>
        <p className="text-on-variant mt-2 text-sm">Fund the treasury and run epoch-based funding rounds.</p>
      </header>

      {error && <ErrorNote message={error} />}
      {notice && (
        <div className="bg-green/10 border border-green/30 text-green rounded-lg px-4 py-3 text-sm">{notice}</div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard label="Treasury (real GEN)" value={`${formatGen(treasury?.balanceAtto)} GEN`} accent="text-green"
          sub="Backend-held wallet — sends real payouts on claim" />
        <StatCard label="On-chain ledger" value={`${formatGen(info?.treasury_atto)} GEN`} accent="text-cyan-dim"
          sub="Recorded via deposit_to_treasury (bookkeeping only)" />
        <StatCard label="Current epoch" value={info?.current_epoch || "none open"} accent="text-primary"
          sub={`${info?.epoch_count ?? 0} epochs run so far`} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassCard className="p-8">
          <h2 className="text-xl font-semibold mb-1">Treasury wallet</h2>
          <p className="text-on-variant text-sm mb-4">
            Send real GEN to this address, then record the matching ledger entry on-chain.
          </p>
          <p className="font-mono text-xs break-all bg-surface-lowest p-3 rounded-lg text-green mb-4">
            {treasury?.address ?? "—"}
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input className="input-field sm:max-w-xs" placeholder="atto amount deposited"
              value={depositAtto} onChange={(e) => setDepositAtto(e.target.value)} />
            <button className="btn-primary" disabled={busy !== "" || !depositAtto}
              onClick={() =>
                run("deposit", () =>
                  api("/api/admin/treasury/deposit", { method: "POST", body: { atto: depositAtto } }),
                  "Deposit recorded on-chain.")
              }>
              {busy === "deposit" ? "Recording…" : "Record deposit"}
            </button>
          </div>
        </GlassCard>

        <GlassCard className="p-8">
          <h2 className="text-xl font-semibold mb-1">Funding epoch</h2>
          <p className="text-on-variant text-sm mb-4">
            Open a round with a pool size; close it once contributions are evaluated to settle grants.
          </p>
          {!info?.current_epoch ? (
            <div className="space-y-3">
              <input className="input-field" placeholder="pool amount (atto)"
                value={poolAtto} onChange={(e) => setPoolAtto(e.target.value)} />
              <input className="input-field" placeholder="epoch label"
                value={epochLabel} onChange={(e) => setEpochLabel(e.target.value)} />
              <button className="btn-primary w-full" disabled={busy !== "" || !poolAtto || !epochLabel}
                onClick={() =>
                  run("open", () =>
                    api("/api/admin/epochs/open", { method: "POST", body: { poolAtto, label: epochLabel } }),
                    "Epoch opened.")
                }>
                {busy === "open" ? "Opening…" : "Open epoch"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="font-mono text-sm text-cyan-dim">Open: {info.current_epoch}</p>
              <button className="btn-ghost w-full" disabled={busy !== ""}
                onClick={() =>
                  run("close", () => api("/api/admin/epochs/close", { method: "POST" }),
                    "Epoch closed — grants settled.")
                }>
                {busy === "close" ? "Settling…" : "Close epoch"}
              </button>
            </div>
          )}
        </GlassCard>
      </section>

      {user.role === "admin" && (
        <GlassCard className="p-8">
          <h2 className="text-xl font-semibold mb-1">Curator management</h2>
          <p className="text-on-variant text-sm mb-4">
            Add or remove curators on-chain. This call is owner-gated by the contract — it only
            succeeds if your wallet is the deployed contract&apos;s owner.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input className="input-field sm:max-w-md" placeholder="0x… curator address"
              value={curatorAddr} onChange={(e) => setCuratorAddr(e.target.value)} />
            <button className="btn-primary" disabled={busy !== "" || !curatorAddr}
              onClick={() =>
                run("add-curator", () =>
                  api("/api/admin/curators", { method: "POST", body: { address: curatorAddr } }),
                  "Curator added.")
              }>
              {busy === "add-curator" ? "Adding…" : "Add curator"}
            </button>
            <button className="btn-ghost" disabled={busy !== "" || !curatorAddr}
              onClick={() =>
                run("remove-curator", () =>
                  api(`/api/admin/curators/${encodeURIComponent(curatorAddr)}`, { method: "DELETE" }),
                  "Curator removed.")
              }>
              {busy === "remove-curator" ? "Removing…" : "Remove curator"}
            </button>
          </div>
        </GlassCard>
      )}

      <GlassCard className="p-8">
        <h2 className="text-xl font-semibold mb-6">Grant payouts</h2>
        {!payouts.length ? (
          <p className="text-on-variant text-sm font-mono">No payouts recorded yet.</p>
        ) : (
          <div className="space-y-4">
            {payouts.map((p) => (
              <div key={p.grant_id}
                className="p-4 bg-surface-low border border-outline-variant/30 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-on-surface">{p.grant_id} <span className="text-on-variant text-xs">→ {p.wallet || "—"}</span></p>
                  <p className="font-mono text-sm text-green mt-1">{formatGen(p.amount_atto)} GEN</p>
                  {p.error && <p className="text-xs text-danger mt-1">{p.error}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`chip ${p.status === "sent" ? "bg-green/10 text-green border-green/20" : "bg-danger/10 text-danger border-danger/20"}`}>
                    {p.status}
                  </span>
                  {p.status === "failed" && (
                    <button className="btn-ghost !py-1.5 !px-4 text-xs" disabled={busy !== ""}
                      onClick={() =>
                        run(`retry-${p.grant_id}`, () =>
                          api(`/api/admin/grant-payouts/${p.grant_id}/retry`, { method: "POST" }),
                          "Payout retried.")
                      }>
                      {busy === `retry-${p.grant_id}` ? "Retrying…" : "Retry"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>
    </main>
  );
}
