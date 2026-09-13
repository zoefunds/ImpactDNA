"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { GlassCard, DimensionBar, StatusChip, Spinner, ErrorNote } from "@/components/ui";
import { api, getToken, formatUsdc } from "@/lib/api";
import { genlayerWrite } from "@/lib/genlayerClient";

interface Contribution {
  id: string;
  repo: string;
  category: string;
  description: string;
  developer: string;
  wallet: string;
  status: string;
  epoch: string;
  score_total: number;
  dimensions: Record<string, number>;
  eligible: boolean;
  manipulation_flag: boolean;
  evaluation_summary: string;
  manipulation_summary: string;
  evidence: Record<string, unknown>;
  granted_usdc: string;
}

const DIM_LABELS: Record<string, string> = {
  downstream_usage: "Downstream Usage",
  technical_importance: "Technical Importance",
  originality: "Originality",
  ecosystem_influence: "Ecosystem Influence",
  community_adoption: "Community Adoption",
};

const DIM_COLORS = ["bg-green", "bg-cyan", "bg-primary", "bg-cyan-dim", "bg-green-fixed"];

export default function EvaluationReport() {
  const { id } = useParams<{ id: string }>();
  const [c, setC] = useState<Contribution | null>(null);
  const [error, setError] = useState("");
  const [appealReason, setAppealReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [appealFiled, setAppealFiled] = useState(false);

  useEffect(() => {
    api<Contribution>(`/api/platform/contributions/${id}`, { auth: false })
      .then(setC)
      .catch((e) => setError(e instanceof Error ? e.message : "Not found"));
  }, [id]);

  async function appeal() {
    setBusy(true);
    setError("");
    try {
      await genlayerWrite("request_appeal", [id, appealReason]);
      setAppealFiled(true);
      setNotice("Appeal filed on-chain — a curator will trigger independent re-review.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Appeal failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !c) return <main className="max-w-container mx-auto px-4 md:px-12 py-16 w-full"><ErrorNote message={error} /></main>;
  if (!c) return <Spinner />;

  return (
    <main className="max-w-container mx-auto w-full px-4 md:px-12 py-10 flex-grow">
      {/* Header */}
      <header className="mb-10 flex flex-col md:flex-row justify-between md:items-end gap-6">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="label-caps text-green tracking-widest">Autonomous evaluation report</span>
            <StatusChip status={c.status} />
          </div>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight break-all">{c.repo}</h1>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <p className="label-caps text-on-variant">Contributor</p>
              <p className="font-mono text-primary">@{c.developer}</p>
            </div>
            <div className="h-10 w-px bg-outline-variant/30 hidden md:block" />
            <div>
              <p className="label-caps text-on-variant">Contribution ID</p>
              <p className="font-mono">{c.id}</p>
            </div>
            <div className="h-10 w-px bg-outline-variant/30 hidden md:block" />
            <div>
              <p className="label-caps text-on-variant">Category</p>
              <p className="font-mono">{c.category}</p>
            </div>
            <div className="h-10 w-px bg-outline-variant/30 hidden md:block" />
            <div>
              <p className="label-caps text-on-variant">Epoch</p>
              <Link href={`/funding`} className="font-mono text-cyan-dim hover:underline">{c.epoch || "—"}</Link>
            </div>
          </div>
        </div>
        <GlassCard className="p-6 flex flex-col items-center min-w-[200px]">
          <p className="label-caps text-on-variant mb-2">Impact DNA score</p>
          <div className="text-6xl font-bold text-green leading-none tracking-tighter font-mono">
            {c.score_total}
          </div>
          <div className="mt-3 w-full h-1 bg-surface-container rounded-full overflow-hidden">
            <div className="h-full dna-gradient" style={{ width: `${c.score_total}%` }} />
          </div>
        </GlassCard>
      </header>

      {notice && <div className="mb-6 bg-green/10 border border-green/30 text-green rounded-lg px-4 py-3 text-sm">{notice}</div>}
      {error && <div className="mb-6"><ErrorNote message={error} /></div>}

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Analysis */}
        <GlassCard className="md:col-span-8 p-8">
          <h2 className="text-2xl font-semibold mb-6 flex items-center gap-3">
            <span className="text-primary">◉</span> GenLayer Analysis
          </h2>
          <p className="text-on-variant leading-relaxed mb-6">{c.description}</p>
          {c.evaluation_summary ? (
            <div className="p-4 bg-primary/5 border-l-2 border-primary italic text-on-surface leading-relaxed">
              “{c.evaluation_summary}”
              <span className="block not-italic font-mono text-xs text-primary mt-3">
                — validator consensus, ImpactDNA Intelligent Contract
              </span>
            </div>
          ) : (
            <p className="font-mono text-sm text-on-variant">Not evaluated yet.</p>
          )}
          {c.manipulation_summary && (
            <div className="mt-6 p-4 bg-danger/5 border-l-2 border-danger text-sm">
              <span className="label-caps text-danger block mb-2">Fraud screen</span>
              {c.manipulation_summary}
            </div>
          )}
          {/* Evidence */}
          {Object.keys(c.evidence ?? {}).length > 0 && (
            <div className="mt-8">
              <h3 className="label-caps text-on-variant mb-4">Consensus evidence (fetched from GitHub in-contract)</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 font-mono text-xs">
                {Object.entries(c.evidence).map(([k, v]) => (
                  <div key={k} className="bg-surface-lowest p-3 rounded-lg border border-outline-variant/20">
                    <span className="text-on-variant block uppercase text-[10px] mb-1">{k.replace(/_/g, " ")}</span>
                    <span className="text-cyan-dim break-all">{String(v) || "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </GlassCard>

        {/* Metric breakdown + funding */}
        <section className="md:col-span-4 flex flex-col gap-6">
          <GlassCard className="p-6 flex-1">
            <h3 className="label-caps text-on-variant mb-6 tracking-widest">Metric breakdown</h3>
            <div className="space-y-6">
              {Object.entries(DIM_LABELS).map(([key, label], i) => (
                <DimensionBar key={key} label={label} value={Number(c.dimensions?.[key] ?? 0)} color={DIM_COLORS[i % DIM_COLORS.length]} />
              ))}
            </div>
          </GlassCard>

          <GlassCard className={`p-6 ${c.eligible ? "border-green/20 bg-green/5" : ""}`}>
            <h3 className="label-caps text-green tracking-widest mb-4">Funding decision</h3>
            <p className="font-semibold text-lg mb-1">
              {c.status === "funded"
                ? "Retroactive grant awarded"
                : c.eligible
                  ? "Eligible for retroactive funding"
                  : "Not eligible"}
            </p>
            <p className="text-on-variant text-sm mb-6">
              {c.eligible
                ? "Verified by GenLayer validator consensus over live GitHub evidence."
                : c.manipulation_flag
                  ? "Flagged by the fraud screen — appeal available below."
                  : "Score below the eligibility gate, a fork, or ownership mismatch."}
            </p>
            {c.status === "funded" && (
              <div className="bg-surface-low p-4 rounded-lg border border-outline-variant/20 flex justify-between items-center">
                <div>
                  <p className="label-caps text-on-variant">Allocation</p>
                  <p className="font-mono text-lg">
                    {formatUsdc(c.granted_usdc)} <span className="text-primary text-sm">USDC</span>
                  </p>
                </div>
                <span className="text-green text-2xl">✓</span>
              </div>
            )}
            {(c.status === "rejected" || c.status === "flagged") && getToken() && (
              appealFiled ? (
                <p className="mt-2 font-mono text-xs text-green">✓ Appeal filed — awaiting curator review.</p>
              ) : (
                <div className="space-y-3 mt-2">
                  <textarea className="input-field min-h-[80px]"
                    placeholder="Appeal reason (min 20 chars) — cite evidence the evaluation missed"
                    value={appealReason} onChange={(e) => setAppealReason(e.target.value)} />
                  <button className="btn-ghost w-full" disabled={busy || appealReason.length < 20} onClick={appeal}>
                    {busy ? "Filing appeal…" : "File on-chain appeal"}
                  </button>
                </div>
              )
            )}
          </GlassCard>
        </section>
      </div>
    </main>
  );
}
