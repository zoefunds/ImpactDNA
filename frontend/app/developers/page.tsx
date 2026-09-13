"use client";

import { useEffect, useState } from "react";
import { GlassCard, ScoreBar, Spinner, ErrorNote } from "@/components/ui";
import { api, formatUsdc } from "@/lib/api";

interface Dev {
  username: string;
  display_name: string;
  verified: boolean;
  total_score: number;
  funded_count: number;
  total_granted_usdc: string;
}

export default function Developers() {
  const [rows, setRows] = useState<Dev[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ items: Dev[] }>("/api/platform/leaderboard?limit=50", { auth: false })
      .then((r) => setRows(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  return (
    <main className="max-w-container mx-auto w-full px-4 md:px-12 py-10 space-y-8 flex-grow">
      <header>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-primary">Developer Profiles</h1>
        <p className="text-on-variant mt-2">
          Impact leaderboard — cumulative validator-scored ecosystem impact per verified developer.
        </p>
      </header>

      {error && <ErrorNote message={error} />}
      {!rows ? (
        <Spinner />
      ) : !rows.length ? (
        <GlassCard className="p-12 text-center text-on-variant font-mono text-sm">
          No developers registered yet — be the first.
        </GlassCard>
      ) : (
        <div className="space-y-4">
          {rows.map((d, i) => {
            const max = Math.max(...rows.map((r) => r.total_score), 1);
            return (
              <GlassCard key={d.username} className="p-6 flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex items-center gap-4 md:w-1/3">
                  <span className={`font-mono text-2xl w-12 ${i === 0 ? "text-green" : i < 3 ? "text-primary" : "text-on-variant"}`}>
                    #{i + 1}
                  </span>
                  <div className="w-12 h-12 rounded-full dna-gradient flex items-center justify-center font-bold text-surface">
                    {d.display_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold">{d.display_name}</p>
                    <p className="font-mono text-xs text-on-variant">
                      @{d.username} {d.verified && <span className="text-green">✓ verified</span>}
                    </p>
                  </div>
                </div>
                <div className="flex-grow">
                  <ScoreBar value={d.total_score} max={max} />
                </div>
                <div className="flex gap-8 font-mono text-sm md:text-right">
                  <div>
                    <span className="label-caps text-on-variant block">Impact</span>
                    <span className="text-primary text-lg">{d.total_score}</span>
                  </div>
                  <div>
                    <span className="label-caps text-on-variant block">Grants</span>
                    <span className="text-cyan-dim text-lg">{d.funded_count}</span>
                  </div>
                  <div>
                    <span className="label-caps text-on-variant block">Earned</span>
                    <span className="text-green text-lg">{formatUsdc(d.total_granted_usdc)} USDC</span>
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </main>
  );
}
