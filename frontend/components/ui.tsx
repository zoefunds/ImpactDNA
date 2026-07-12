"use client";

import { ReactNode } from "react";

export function GlassCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`glass rounded-xl ${className}`}>{children}</div>;
}

export function StatCard({
  label,
  value,
  accent = "text-primary",
  sub,
}: {
  label: string;
  value: string | number;
  accent?: string;
  sub?: string;
}) {
  return (
    <GlassCard className="p-6">
      <span className="label-caps text-on-variant">{label}</span>
      <div className={`font-mono text-3xl md:text-4xl mt-3 tracking-tighter ${accent}`}>{value}</div>
      {sub && <p className="mt-3 text-sm text-on-variant">{sub}</p>}
    </GlassCard>
  );
}

/** Cyan→purple "DNA sequence" progress bar. */
export function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-2 w-full bg-surface-highest rounded-full overflow-hidden">
      <div
        className="h-full dna-gradient rounded-full shadow-[0_0_10px_rgba(0,238,252,0.4)] transition-all duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function DimensionBar({
  label,
  value,
  max = 20,
  color = "bg-green",
}: {
  label: string;
  value: number;
  max?: number;
  color?: string;
}) {
  return (
    <div>
      <div className="flex justify-between items-end mb-2">
        <span className="text-sm text-on-surface">{label}</span>
        <span className="font-mono text-sm text-green">
          {value}/{max}
        </span>
      </div>
      <div className="h-2 bg-surface-container rounded-full relative overflow-hidden">
        <div
          className={`absolute h-full ${color} rounded-full transition-all duration-1000`}
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  submitted: "bg-cyan/10 text-cyan-dim border-cyan/20",
  evaluated: "bg-green/10 text-green border-green/20",
  funded: "bg-green/20 text-green-fixed border-green/30",
  rejected: "bg-danger/10 text-danger border-danger/20",
  flagged: "bg-danger/20 text-danger border-danger/30",
  appealed: "bg-primary/10 text-primary border-primary/20",
  open: "bg-cyan/10 text-cyan-dim border-cyan/20",
  closed: "bg-surface-highest text-on-variant border-outline-variant/40",
};

export function StatusChip({ status }: { status: string }) {
  return (
    <span className={`chip ${STATUS_STYLE[status] ?? "bg-surface-highest text-on-variant border-outline-variant/40"}`}>
      {status}
    </span>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center gap-3 text-on-variant font-mono text-sm py-8 justify-center">
      <span className="w-2 h-2 rounded-full bg-cyan animate-ping" />
      Syncing with GenLayer…
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">
      {message}
    </div>
  );
}
