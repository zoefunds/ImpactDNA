"use client";


import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { GlassCard, StatCard, StatusChip, Spinner, ErrorNote } from "@/components/ui";
import { api, formatUsdc, parseUsdc, shortAddr } from "@/lib/api";
import { genlayerWrite, genlayerRead } from "@/lib/genlayerClient";
import { depositUsdc, claimGrant } from "@/lib/escrowClient";

interface Epoch {
  id: string;
  label: string;
  status: string;
  opener: string;
  pool_usdc: string;
  allocated_usdc: string;
  grant_ids: string[];
}

interface Grant {
  id: string;
  epoch: string;
  contribution: string;
  developer: string;
  wallet: string;
  amount_usdc: string;
  claimed: boolean;
  relayed: boolean;
}

export default function FundingInner() {
  const { address, isConnected } = useAccount();
  const { open } = useAppKit();
  const [epochs, setEpochs] = useState<{ items: Epoch[] } | null>(null);
  const [grants, setGrants] = useState<{ total: number; items: Grant[] } | null>(null);
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const [newLabel, setNewLabel] = useState("");
  const [depositAmounts, setDepositAmounts] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const [e, g, i] = await Promise.all([
      api<{ items: Epoch[] }>("/api/platform/epochs", { auth: false }),
      api<{ total: number; items: Grant[] }>("/api/platform/grants?limit=50", { auth: false }),
      api<{ info?: Record<string, unknown> }>("/api/platform/info", { auth: false }).then((r) => r.info ?? null),
    ]);
    setEpochs(e);
    setGrants(g);
    setInfo(i);
  }, []);

  useEffect(() => {
    refresh()
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [refresh]);

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
      // claim) skip this — otherwise this cached, ~2min-TTL backend refetch
      // immediately clobbers the fresh state we just set with stale data.
      if (!opts?.skipRefresh) await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  if (loading) return <Spinner />;

  return (
    <main className="max-w-container mx-auto w-full px-4 md:px-12 py-10 space-y-8 flex-grow">
      <header>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-primary">Funding Explorer</h1>
        <p className="text-on-variant mt-2">
          Anyone can open and name a funding epoch, and anyone can deposit USDC into it on Base
          Sepolia. When it closes, the pool splits by quadratic impact weight — same formula no
          matter who opened or funded the round.
        </p>
      </header>

      {error && <ErrorNote message={error} />}
      {notice && (
        <div className="bg-green/10 border border-green/30 text-green rounded-lg px-4 py-3 text-sm">{notice}</div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <StatCard label="Total deposited (all epochs)" value={`${formatUsdc(String(info?.treasury_usdc ?? "0"))} USDC`} accent="text-green" />
        <StatCard label="Total granted" value={`${formatUsdc(String(info?.total_granted_usdc ?? "0"))} USDC`} accent="text-primary"
          sub="Distributed retroactively to date" />
      </section>

      <GlassCard className="p-6">
        <h2 className="text-lg font-semibold mb-3">Open a new epoch</h2>
        <p className="text-on-variant text-sm mb-4">
          Anyone can open and name a funding round. It starts empty — deposit USDC into it below,
          or share it so others do.
        </p>
        {!isConnected ? (
          <button className="btn-primary" onClick={() => open()}>Connect wallet to open an epoch</button>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <input className="input-field sm:max-w-xs" placeholder="epoch name, e.g. Q1 grants"
              value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <button className="btn-primary" disabled={busy !== "" || !newLabel}
              onClick={() =>
                run("open-epoch", async () => {
                  await genlayerWrite("open_epoch", [newLabel]);
                  setNewLabel("");
                }, "Epoch opened.")
              }>
              {busy === "open-epoch" ? "Opening…" : "Open epoch"}
            </button>
          </div>
        )}
      </GlassCard>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Epochs</h2>
        {!epochs?.items.length ? (
          <GlassCard className="p-10 text-center text-on-variant font-mono text-sm">
            No epochs opened yet — be the first.
          </GlassCard>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {epochs.items.map((e) => (
              <GlassCard key={e.id} className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-mono text-lg">{e.label}</h3>
                    <p className="text-xs text-on-variant font-mono mt-1">
                      {e.id} · opened by {shortAddr(e.opener)}
                    </p>
                  </div>
                  <StatusChip status={e.status} />
                </div>
                <div className="grid grid-cols-2 gap-4 font-mono text-sm mb-4">
                  <div className="bg-surface-lowest p-3 rounded-lg">
                    <span className="label-caps text-on-variant block mb-1">Pool</span>
                    <span className="text-green">{formatUsdc(e.pool_usdc)} USDC</span>
                  </div>
                  <div className="bg-surface-lowest p-3 rounded-lg">
                    <span className="label-caps text-on-variant block mb-1">Allocated</span>
                    <span className="text-primary">{formatUsdc(e.allocated_usdc)} USDC</span>
                  </div>
                </div>

                {e.status === "open" && (
                  isConnected ? (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input className="input-field flex-1" placeholder="USDC amount"
                          value={depositAmounts[e.id] ?? ""}
                          onChange={(ev) => setDepositAmounts({ ...depositAmounts, [e.id]: ev.target.value })} />
                        <button className="btn-primary" disabled={busy !== "" || !depositAmounts[e.id]}
                          onClick={() =>
                            run(`deposit-${e.id}`, async () => {
                              const units = BigInt(parseUsdc(depositAmounts[e.id]));
                              await depositUsdc(e.id, units);
                              await api("/api/platform/deposits/sync", { method: "POST", body: { epochId: e.id } }).catch(() => null);
                              setDepositAmounts({ ...depositAmounts, [e.id]: "" });
                            }, "Deposit sent — it appears here once the relayer confirms it (usually under a minute).")
                          }>
                          {busy === `deposit-${e.id}` ? "Depositing…" : "Deposit"}
                        </button>
                      </div>
                      {address?.toLowerCase() === e.opener.toLowerCase() && (
                        <button className="btn-ghost w-full !py-2 text-xs" disabled={busy !== ""}
                          onClick={() =>
                            run(`close-${e.id}`, async () => {
                              await genlayerWrite("close_epoch", [e.id]);
                              // GenLayer settlement is synchronous — read the
                              // fresh state directly instead of waiting on the
                              // backend's ~2min cached read, so the epoch and
                              // any new grants show up immediately.
                              const [freshEpoch, freshGrants] = await Promise.all([
                                genlayerRead("get_epoch", [e.id]) as Promise<Epoch>,
                                genlayerRead("list_grants", [0, 50]) as Promise<{ items: Grant[]; total: number }>,
                              ]);
                              setEpochs((prev) =>
                                prev ? { items: prev.items.map((x) => (x.id === e.id ? freshEpoch : x)) } : prev,
                              );
                              setGrants(freshGrants);
                            }, "Epoch closed — grants settled by quadratic weight.", { skipRefresh: true })
                          }>
                          {busy === `close-${e.id}` ? "Settling…" : "Close this epoch (you opened it)"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <button className="btn-ghost w-full" onClick={() => open()}>Connect wallet to deposit</button>
                  )
                )}
                <p className="mt-4 text-xs text-on-variant font-mono">{e.grant_ids?.length ?? 0} grants settled</p>
              </GlassCard>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Grant ledger</h2>
        {!grants?.items.length ? (
          <GlassCard className="p-10 text-center text-on-variant font-mono text-sm">
            No grants yet. Eligible contributions receive automatic allocations when an epoch closes.
          </GlassCard>
        ) : (
          <GlassCard className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-outline-variant/30 text-left">
                  {["Grant", "Contribution", "Developer", "Recipient", "Amount", "Status", ""].map((h) => (
                    <th key={h} className="label-caps text-on-variant px-5 py-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                {grants.items.map((g) => (
                  <tr key={g.id} className="border-b border-outline-variant/10 hover:bg-white/[0.02]">
                    <td className="px-5 py-4 text-cyan-dim">{g.id}</td>
                    <td className="px-5 py-4">
                      <Link href={`/contributions/${g.contribution}`} className="text-primary hover:underline">
                        {g.contribution}
                      </Link>
                    </td>
                    <td className="px-5 py-4">@{g.developer}</td>
                    <td className="px-5 py-4 text-on-variant">{shortAddr(g.wallet)}</td>
                    <td className="px-5 py-4 text-green">{formatUsdc(g.amount_usdc)} USDC</td>
                    <td className="px-5 py-4">
                      <span className={`chip ${g.claimed ? "bg-green/10 text-green border-green/20" : "bg-cyan/10 text-cyan-dim border-cyan/20"}`}>
                        {g.claimed ? "claimed" : g.relayed ? "claimable" : "pending relay"}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      {!g.claimed && g.relayed && address?.toLowerCase() === g.wallet.toLowerCase() && (
                        <button className="btn-ghost !py-1 !px-3 text-xs" disabled={busy !== ""}
                          onClick={() =>
                            run(`claim-${g.id}`, async () => {
                              await claimGrant(g.epoch);
                              // The escrow transaction succeeding IS the
                              // authoritative claim — GenLayer's own
                              // `claimed` flag only flips once the relayer
                              // later mirrors the event, so update locally
                              // now instead of showing a stale "claimable".
                              setGrants((prev) =>
                                prev
                                  ? { ...prev, items: prev.items.map((x) => (x.id === g.id ? { ...x, claimed: true } : x)) }
                                  : prev,
                              );
                            }, "Claim sent — USDC transferred directly by the escrow.", { skipRefresh: true })
                          }>
                          {busy === `claim-${g.id}` ? "Claiming…" : "Claim"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
        )}
      </section>
    </main>
  );
}
