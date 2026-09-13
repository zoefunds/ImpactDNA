"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { GlassCard } from "@/components/ui";

interface PlatformInfo {
  configured: boolean;
  info?: {
    developer_count: number;
    contribution_count: number;
    grant_count: number;
    total_granted_usdc: string;
  };
}

const PILLARS = [
  {
    accent: "text-primary",
    bg: "bg-primary/10 border-primary/20",
    icon: "◉",
    title: "Deep Ecosystem Analysis",
    body: "The Intelligent Contract fetches live GitHub evidence inside consensus — repository lineage, ownership, license, fork status — so no claim rests on user-submitted text.",
    items: ["Contract-side web fetching", "Stable-field consensus", "Ownership verification"],
  },
  {
    accent: "text-green",
    bg: "bg-green/10 border-green/20",
    icon: "🧠",
    title: "Intelligent Reasoning",
    badge: "AI VALIDATOR CORE",
    body: "GenLayer validators independently score five impact dimensions — downstream usage, technical importance, originality, ecosystem influence, adoption — and must agree.",
    items: ["Comparative validation", "Tolerant score buckets", "Fraud & fork detection"],
  },
  {
    accent: "text-cyan-dim",
    bg: "bg-cyan-dim/10 border-cyan-dim/20",
    icon: "⬢",
    title: "Retroactive Rewards",
    body: "Funding epochs settle deterministically: the pool is split by quadratic impact weight across eligible contributions. Months-late recognition, automatic payout.",
    items: ["Epoch-based pools", "Quadratic impact weights", "On-chain grant ledger"],
  },
];

export default function Landing() {
  const [stats, setStats] = useState<PlatformInfo | null>(null);

  useEffect(() => {
    api<PlatformInfo>("/api/platform/info", { auth: false })
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  return (
    <main>
      {/* Hero */}
      <section className="relative min-h-[80vh] flex items-center overflow-hidden px-4 md:px-12">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] glow-primary pointer-events-none" />
        <div className="max-w-container mx-auto grid md:grid-cols-2 gap-6 items-center relative z-10 py-20">
          <div className="flex flex-col gap-8">
            <div className="glass inline-flex items-center gap-2 px-3 py-1 w-fit rounded-full border-primary/20">
              <span className="w-2 h-2 rounded-full bg-green animate-pulse" />
              <span className="label-caps text-green">GenLayer powered protocol</span>
            </div>
            <h1 className="text-4xl md:text-[48px] md:leading-[56px] font-bold tracking-tight">
              Retroactive funding for <span className="text-primary">foundational</span> open source
            </h1>
            <p className="text-on-variant max-w-lg leading-relaxed">
              ImpactDNA uses GenLayer Intelligent Contracts to discover and reward software
              contributions by their true downstream value — judged by validator consensus over
              real evidence, months after the code shipped. We look beyond raw metrics to find the
              hidden code that powers the ecosystem.
            </p>
            <div className="flex flex-wrap gap-4 pt-2">
              <Link href="/explorer" className="btn-primary flex items-center gap-2 group">
                Explore contributions
                <span className="group-hover:translate-x-1 transition-transform">→</span>
              </Link>
              <Link href="/docs" className="btn-ghost">
                How it works
              </Link>
            </div>
          </div>
          <div className="hidden md:flex justify-center">
            <GlassCard className="p-8 w-full max-w-md space-y-6">
              <div className="p-4 bg-surface-container rounded-lg border border-outline-variant/30 font-mono text-xs">
                <div className="flex justify-between mb-3 text-on-variant">
                  <span>EVALUATION_NODE_04</span>
                  <span className="text-green animate-pulse">CONSENSUS…</span>
                </div>
                <div className="h-1 bg-white/5 rounded overflow-hidden mb-2">
                  <div className="h-full dna-gradient w-3/4" />
                </div>
                <div className="text-on-variant/70">
                  Validators re-fetching github.com/repos/… and re-scoring impact dimensions
                </div>
              </div>
              <div className="p-4 bg-surface-container rounded-lg border border-outline-variant/30 font-mono text-xs">
                <div className="flex justify-between mb-3 text-on-variant">
                  <span>IMPACT_SCORE_VECTOR</span>
                  <span className="text-primary">82/100</span>
                </div>
                <div className="h-20 flex items-end gap-1">
                  {[20, 45, 35, 90, 60, 75, 55].map((h, i) => (
                    <div key={i} className={`w-full ${i === 3 ? "bg-primary" : "bg-primary/40"}`} style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between font-mono text-xs text-on-variant">
                <span>GATE: eligible=true · fork=false</span>
                <span className="text-green">✓ AGREED</span>
              </div>
            </GlassCard>
          </div>
        </div>
      </section>

      {/* Stats ribbon — live from the intelligent contract */}
      <section className="border-y border-outline-variant/30 bg-surface-low py-10 px-4 md:px-12">
        <div className="max-w-container mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat label="Registered developers" value={stats?.info ? String(stats.info.developer_count) : "—"} accent="text-primary" />
          <Stat label="Contributions analyzed" value={stats?.info ? String(stats.info.contribution_count) : "—"} accent="text-cyan-dim" />
          <Stat label="Grants distributed" value={stats?.info ? String(stats.info.grant_count) : "—"} accent="text-green" />
          <Stat label="Consensus engine" value="GenLayer" accent="text-on-surface" />
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-4 md:px-12 relative">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] glow-cyan pointer-events-none" />
        <div className="max-w-container mx-auto relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight mb-4">Tracing the lineage of value</h2>
            <p className="text-on-variant max-w-2xl mx-auto">
              The protocol identifies the genetic markers of high-impact code across the open-source landscape.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {PILLARS.map((p) => (
              <GlassCard key={p.title} className="p-8 relative">
                {p.badge && (
                  <span className="absolute top-4 right-4 label-caps text-green bg-green/10 px-2 py-1 rounded">
                    {p.badge}
                  </span>
                )}
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-6 border ${p.bg}`}>
                  <span className={`${p.accent} text-xl`}>{p.icon}</span>
                </div>
                <h3 className="text-xl font-semibold mb-4">{p.title}</h3>
                <p className="text-on-variant text-sm mb-6 leading-relaxed">{p.body}</p>
                <ul className={`flex flex-col gap-3 font-mono text-xs ${p.accent}`}>
                  {p.items.map((i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span>✓</span> {i}
                    </li>
                  ))}
                </ul>
              </GlassCard>
            ))}
          </div>
        </div>
      </section>

      {/* GenLayer advantage */}
      <section className="py-24 bg-surface-lowest px-4 md:px-12">
        <div className="max-w-container mx-auto grid md:grid-cols-2 gap-16 items-center">
          <GlassCard className="p-10 border-green/20">
            <div className="font-mono text-xs space-y-4">
              <p className="text-on-variant">// Validator agreement, not leader trust</p>
              <p>
                <span className="text-primary">def</span> <span className="text-cyan-dim">validator_fn</span>(leader):
              </p>
              <p className="pl-6 text-on-variant">mine = re_fetch_and_rescore()</p>
              <p className="pl-6">
                <span className="text-primary">if</span> leader.fork != mine.fork: <span className="text-danger">return False</span>
              </p>
              <p className="pl-6">
                <span className="text-primary">if</span> leader.eligible != mine.eligible: <span className="text-danger">return False</span>
              </p>
              <p className="pl-6">
                <span className="text-primary">return</span> buckets_agree(leader.score, mine.score) <span className="text-green"># tolerant</span>
              </p>
            </div>
          </GlassCard>
          <div className="flex flex-col gap-8">
            <h2 className="text-3xl font-semibold tracking-tight">The GenLayer advantage: intelligent subjectivity</h2>
            <p className="text-on-variant">
              Stars and download counts are easily gamed and miss quiet, foundational work. ImpactDNA&apos;s
              evaluations are subjective where it matters and verifiable where it counts.
            </p>
            {[
              ["Beyond deterministic logic", "Validators reason about why a library is critical, even when its star count is low."],
              ["Consensus-based fairness", "Every score requires independent validator agreement — hard gates match exactly, scores agree within tolerance."],
              ["Real evidence only", "Ownership, originality and fork status are checked against GitHub inside the contract, never taken from submitted text."],
            ].map(([t, b]) => (
              <div key={t} className="flex gap-4">
                <span className="text-green pt-1">✦</span>
                <div>
                  <h4 className="font-bold">{t}</h4>
                  <p className="text-on-variant text-sm">{b}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4 md:px-12">
        <GlassCard className="max-w-container mx-auto rounded-3xl p-12 md:p-24 text-center relative">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-green/5 pointer-events-none" />
          <div className="relative z-10 flex flex-col items-center gap-8">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight max-w-3xl">
              Ready to uncover the DNA of your ecosystem?
            </h2>
            <p className="text-on-variant max-w-xl">
              Create an account, get a permanent wallet, verify your GitHub identity, and let validator
              consensus judge your work&apos;s real impact.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/login" className="btn-primary text-lg px-10 py-4">
                Create your account
              </Link>
              <Link href="/docs" className="btn-ghost text-lg px-10 py-4">
                Read documentation
              </Link>
            </div>
          </div>
        </GlassCard>
      </section>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label-caps text-on-variant">{label}</span>
      <span className={`font-mono text-xl ${accent}`}>{value}</span>
    </div>
  );
}
