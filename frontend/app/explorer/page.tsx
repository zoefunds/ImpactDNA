"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GlassCard, ScoreBar, StatusChip, Spinner, ErrorNote } from "@/components/ui";
import { api } from "@/lib/api";

interface Contribution {
  id: string;
  repo: string;
  category: string;
  status: string;
  developer: string;
  score_total: number;
  eligible: boolean;
  evaluation_summary: string;
  granted_usdc: string;
}

interface Page {
  total: number;
  next_offset: number;
  items: Contribution[];
}

const STATUSES = ["", "submitted", "evaluated", "funded", "rejected", "flagged"];

export default function Explorer() {
  const [page, setPage] = useState<Page | null>(null);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError("");
    api<Page>(`/api/platform/contributions?offset=${offset}&limit=20&status=${status}`, { auth: false })
      .then(setPage)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [offset, status]);

  const items = (page?.items ?? []).filter(
    (c) =>
      !query ||
      c.repo.toLowerCase().includes(query.toLowerCase()) ||
      c.developer.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <main className="max-w-container mx-auto w-full px-4 md:px-12 py-10 space-y-6 flex-grow">
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-primary">Contribution Explorer</h1>
          <p className="text-on-variant mt-2">Mapping the genetic dependencies of the open-source web.</p>
        </div>
        <div className="glass px-4 py-2 rounded-lg">
          <p className="label-caps text-outline">On-chain contributions</p>
          <p className="font-mono text-lg text-primary">{page?.total ?? "—"}</p>
        </div>
      </header>

      {/* Search + filter */}
      <div className="glass p-2 rounded-2xl flex flex-col sm:flex-row gap-2">
        <input
          className="flex-grow bg-transparent border-none px-4 py-3 text-sm focus:outline-none placeholder:text-on-variant/50"
          placeholder="Filter by repository or developer…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="bg-surface-lowest border border-outline-variant/30 rounded-xl px-4 py-3 text-sm"
          value={status}
          onChange={(e) => {
            setOffset(0);
            setStatus(e.target.value);
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s || "All statuses"}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorNote message={error} />}
      {loading ? (
        <Spinner />
      ) : !items.length ? (
        <GlassCard className="p-12 text-center text-on-variant font-mono text-sm">
          No contributions match. Be the first — submit yours from the dashboard.
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {items.map((c) => (
            <GlassCard key={c.id} className="p-6 hover:border-primary/50 transition-all">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-surface-highest border border-outline-variant/30 flex items-center justify-center font-mono text-primary">
                    {c.repo.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <Link href={`/contributions/${c.id}`} className="font-mono text-on-surface hover:text-primary transition-colors">
                      {c.repo}
                    </Link>
                    <p className="text-on-variant text-sm">by @{c.developer}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="label-caps text-outline block">Impact score</span>
                  <span className="font-mono text-2xl text-primary">{c.score_total}</span>
                </div>
              </div>
              {c.evaluation_summary && (
                <div className="bg-surface-lowest/50 p-4 rounded-lg border border-outline-variant/10 mb-4">
                  <span className="label-caps text-green block mb-1">Validator consensus summary</span>
                  <p className="text-sm text-on-surface line-clamp-3">{c.evaluation_summary}</p>
                </div>
              )}
              <ScoreBar value={c.score_total} />
              <div className="flex items-center justify-between mt-4">
                <div className="flex gap-2">
                  <span className="chip bg-cyan/10 text-cyan-dim border-cyan/20">{c.category}</span>
                  <StatusChip status={c.status} />
                </div>
                <Link href={`/contributions/${c.id}`} className="text-cyan-dim text-sm font-mono hover:underline">
                  Report →
                </Link>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Pagination */}
      {page && page.total > 20 && (
        <div className="flex items-center justify-between pt-6 border-t border-outline-variant/10">
          <p className="text-on-variant font-mono text-xs">
            Showing {offset + 1}–{Math.min(page.next_offset, page.total)} of {page.total}
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost !py-2 !px-4" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>
              ←
            </button>
            <button className="btn-ghost !py-2 !px-4" disabled={page.next_offset >= page.total} onClick={() => setOffset(page.next_offset)}>
              →
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
