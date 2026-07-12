"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GlassCard, StatCard, StatusChip, Spinner, ErrorNote } from "@/components/ui";
import { api, formatGen, shortAddr } from "@/lib/api";

interface Epoch {
  id: string;
  label: string;
  status: string;
  pool_atto: string;
  allocated_atto: string;
  grant_ids: string[];
}

interface Grant {
  id: string;
  epoch: string;
  contribution: string;
  developer: string;
  wallet: string;
  amount_atto: string;
  claimed: boolean;
}

export default function Funding() {
  const [epochs, setEpochs] = useState<{ items: Epoch[]; current: string } | null>(null);
  const [grants, setGrants] = useState<{ total: number; items: Grant[] } | null>(null);
  const [info, setInfo] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api<{ items: Epoch[]; current: string }>("/api/platform/epochs", { auth: false }),
      api<{ total: number; items: Grant[] }>("/api/platform/grants?limit=50", { auth: false }),
      api<{ info?: Record<string, unknown> }>("/api/platform/info", { auth: false }).then((r) => r.info ?? null),
    ])
      .then(([e, g, i]) => {
        setEpochs(e);
        setGrants(g);
        setInfo(i);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <main className="max-w-container mx-auto w-full px-4 md:px-12 py-10 space-y-8 flex-grow">
      <header>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-primary">Funding Explorer</h1>
        <p className="text-on-variant mt-2">
          Epoch-based retroactive pools, settled deterministically by quadratic impact weight.
        </p>
      </header>

      {error && <ErrorNote message={error} />}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard label="Treasury" value={`${formatGen(String(info?.treasury_atto ?? "0"))} GEN`} accent="text-green"
          sub="Available for future epochs" />
        <StatCard label="Total granted" value={`${formatGen(String(info?.total_granted_atto ?? "0"))} GEN`} accent="text-primary"
          sub="Distributed retroactively to date" />
        <StatCard label="Current epoch" value={epochs?.current || "none open"} accent="text-cyan-dim"
          sub="Contributions evaluated now compete in this epoch" />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Epochs</h2>
        {!epochs?.items.length ? (
          <GlassCard className="p-10 text-center text-on-variant font-mono text-sm">
            No epochs opened yet — a curator opens the first funding round.
          </GlassCard>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {epochs.items.map((e) => (
              <GlassCard key={e.id} className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-mono text-lg">{e.label}</h3>
                    <p className="text-xs text-on-variant font-mono mt-1">{e.id}</p>
                  </div>
                  <StatusChip status={e.status} />
                </div>
                <div className="grid grid-cols-2 gap-4 font-mono text-sm">
                  <div className="bg-surface-lowest p-3 rounded-lg">
                    <span className="label-caps text-on-variant block mb-1">Pool</span>
                    <span className="text-green">{formatGen(e.pool_atto)} GEN</span>
                  </div>
                  <div className="bg-surface-lowest p-3 rounded-lg">
                    <span className="label-caps text-on-variant block mb-1">Allocated</span>
                    <span className="text-primary">{formatGen(e.allocated_atto)} GEN</span>
                  </div>
                </div>
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
                  {["Grant", "Contribution", "Developer", "Recipient", "Amount", "Status"].map((h) => (
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
                    <td className="px-5 py-4 text-green">{formatGen(g.amount_atto)} GEN</td>
                    <td className="px-5 py-4">
                      <span className={`chip ${g.claimed ? "bg-green/10 text-green border-green/20" : "bg-cyan/10 text-cyan-dim border-cyan/20"}`}>
                        {g.claimed ? "claimed" : "claimable"}
                      </span>
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
