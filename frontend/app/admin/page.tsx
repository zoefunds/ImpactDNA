"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { GlassCard, StatCard, Spinner, ErrorNote } from "@/components/ui";
import { api, formatUsdc, getToken } from "@/lib/api";
import { genlayerWrite } from "@/lib/genlayerClient";

interface User {
  role: string;
}

interface PlatformInfo {
  treasury_usdc: string;
  epoch_count: number;
  min_eligible_score: number;
}

interface Epoch {
  id: string;
  label: string;
  status: string;
  pool_usdc: string;
}

interface Appeal {
  id: string;
  contribution: string;
  appellant: string;
  reason: string;
  status: string;
}

export default function Admin() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [info, setInfo] = useState<PlatformInfo | null>(null);
  const [openEpochs, setOpenEpochs] = useState<Epoch[]>([]);
  const [openAppeals, setOpenAppeals] = useState<Appeal[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [curatorAddr, setCuratorAddr] = useState("");
  const [minScore, setMinScore] = useState("");
  const [fraudScreenId, setFraudScreenId] = useState("");

  const refresh = useCallback(async () => {
    await api<{ info: PlatformInfo }>("/api/platform/info", { auth: false })
      .then((r) => setInfo(r.info))
      .catch(() => null);
    await api<{ items: Epoch[] }>("/api/platform/epochs", { auth: false })
      .then((r) => setOpenEpochs(r.items.filter((e) => e.status === "open")))
      .catch(() => null);
    await api<{ items: Appeal[] }>("/api/platform/appeals", { auth: false })
      .then((r) => setOpenAppeals(r.items.filter((a) => a.status === "open")))
      .catch(() => null);
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

  async function run(
    name: string,
    fn: () => Promise<unknown>,
    doneMsg: string,
    opts?: { skipRefresh?: boolean },
  ) {
    setError("");
    setNotice("");
    setBusy(name);
    try {
      await fn();
      setNotice(doneMsg);
      // Actions that already applied a precise local update (close epoch,
      // resolve appeal) skip this — otherwise this cached backend refetch
      // immediately clobbers the fresh state we just set with stale data.
      if (!opts?.skipRefresh) await refresh();
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
        <StatCard label="Treasury (USDC)" value={`${formatUsdc(info?.treasury_usdc)} USDC`} accent="text-green"
          sub="Total ever deposited across all epochs, relayed from Base Sepolia automatically" />
        <StatCard label="Open epochs" value={String(openEpochs.length)} accent="text-primary"
          sub={`${info?.epoch_count ?? 0} epochs opened in total`} />
        <StatCard label="Eligibility gate" value={String(info?.min_eligible_score ?? "—")} accent="text-cyan-dim"
          sub="Minimum impact score to compete for funding" />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassCard className="p-8">
          <h2 className="text-xl font-semibold mb-1">Epochs are permissionless</h2>
          <p className="text-on-variant text-sm mb-4">
            Anyone can open, name, and deposit USDC into a funding epoch from the{" "}
            <a href="/funding" className="text-primary hover:underline">Funding page</a> — those
            actions are signed by the acting user&apos;s own wallet, not this admin panel. A
            curator can still close any open epoch below (its own opener can too).
          </p>
        </GlassCard>

        <GlassCard className="p-8">
          <h2 className="text-xl font-semibold mb-1">Close an epoch</h2>
          <p className="text-on-variant text-sm mb-4">
            Settles grants deterministically by quadratic impact weight over that epoch&apos;s pool.
          </p>
          {openEpochs.length === 0 ? (
            <p className="text-on-variant text-sm font-mono">No open epochs right now.</p>
          ) : (
            <div className="space-y-3">
              {openEpochs.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 bg-surface-lowest p-3 rounded-lg">
                  <div className="font-mono text-sm">
                    <span className="text-cyan-dim">{e.id}</span> — {e.label}
                    <span className="text-on-variant ml-2">{formatUsdc(e.pool_usdc)} USDC pooled</span>
                  </div>
                  <button className="btn-ghost !py-1.5 !px-4 text-xs" disabled={busy !== ""}
                    onClick={() =>
                      run(`close-${e.id}`, async () => {
                        await genlayerWrite("close_epoch", [e.id]);
                        // Remove it locally instead of waiting on the
                        // backend's ~2min cached epoch list to catch up.
                        setOpenEpochs((prev) => prev.filter((x) => x.id !== e.id));
                      }, "Epoch closed — grants settled.", { skipRefresh: true })
                    }>
                    {busy === `close-${e.id}` ? "Settling…" : "Close"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassCard className="p-8">
          <h2 className="text-xl font-semibold mb-1">Fraud screen</h2>
          <p className="text-on-variant text-sm mb-4">
            Run the manipulation check against a submitted contribution (e.g. <code>c-3</code>).
            Funded contributions are immutable and can&apos;t be re-screened.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input className="input-field sm:max-w-xs" placeholder="contribution id, e.g. c-3"
              value={fraudScreenId} onChange={(e) => setFraudScreenId(e.target.value)} />
            <button className="btn-primary" disabled={busy !== "" || !fraudScreenId}
              onClick={() =>
                run("fraud-screen", () =>
                  api(`/api/admin/contributions/${encodeURIComponent(fraudScreenId)}/detect-manipulation`, { method: "POST" }),
                  "Fraud screen complete.")
              }>
              {busy === "fraud-screen" ? "Screening…" : "Run screen"}
            </button>
          </div>
        </GlassCard>

        <GlassCard className="p-8">
          <h2 className="text-xl font-semibold mb-1">Open appeals</h2>
          <p className="text-on-variant text-sm mb-4">
            Resolving re-judges the original decision against fresh evidence — upheld only if it
            materially contradicts the original verdict.
          </p>
          {openAppeals.length === 0 ? (
            <p className="text-on-variant text-sm font-mono">No open appeals right now.</p>
          ) : (
            <div className="space-y-3">
              {openAppeals.map((a) => (
                <div key={a.id} className="bg-surface-lowest p-3 rounded-lg space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm text-cyan-dim">{a.id} · {a.contribution}</span>
                    <button className="btn-ghost !py-1.5 !px-4 text-xs" disabled={busy !== ""}
                      onClick={() =>
                        run(`resolve-${a.id}`, async () => {
                          await api(`/api/admin/appeals/${a.id}/resolve`, { method: "POST" });
                          setOpenAppeals((prev) => prev.filter((x) => x.id !== a.id));
                        }, "Appeal resolved.", { skipRefresh: true })
                      }>
                      {busy === `resolve-${a.id}` ? "Resolving…" : "Resolve"}
                    </button>
                  </div>
                  <p className="text-xs text-on-variant">{a.reason}</p>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </section>

      {user.role === "admin" && (
        <GlassCard className="p-8">
          <h2 className="text-xl font-semibold mb-1">Eligibility gate</h2>
          <p className="text-on-variant text-sm mb-4">
            Minimum impact score (0–100) a contribution must clear to compete for funding.
            Currently <span className="text-primary font-mono">{info?.min_eligible_score ?? "—"}</span>.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input className="input-field sm:max-w-xs" placeholder="new score (0-100)"
              value={minScore} onChange={(e) => setMinScore(e.target.value)} />
            <button className="btn-primary" disabled={busy !== "" || minScore === ""}
              onClick={() =>
                run("min-score", () =>
                  api("/api/admin/config/min-eligible-score", { method: "POST", body: { score: Number(minScore) } }),
                  "Eligibility gate updated.")
              }>
              {busy === "min-score" ? "Updating…" : "Update gate"}
            </button>
          </div>
        </GlassCard>
      )}

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
    </main>
  );
}
