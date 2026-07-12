"use client";

import { ReactNode } from "react";
import { GlassCard } from "./ui";
import { LogoMark } from "./Logo";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="flex-grow flex items-center justify-center px-4 py-16 relative">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[600px] glow-primary pointer-events-none" />
      <GlassCard className="w-full max-w-md p-8 md:p-10 relative z-10">
        <div className="flex flex-col items-center gap-3 mb-8 text-center">
          <LogoMark size={40} />
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-on-variant text-sm">{subtitle}</p>
        </div>
        {children}
      </GlassCard>
    </main>
  );
}
