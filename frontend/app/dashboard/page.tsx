"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { GlassCard, StatCard, StatusChip, Spinner, ErrorNote } from "@/components/ui";
import { api, API_URL, currentUser, formatGen, getToken, shortAddr } from "@/lib/api";

interface User {
  displayName: string;
  email: string;
  githubUsername: string | null;
  walletAddress: string;
  role: string;
}

interface Mine {
  items: Array<{
    contribution_id: string;
    repo: string;
    category: string;
    status: string;
    tx_hash: string | null;
    created_at: string;
  }>;
}

interface Grants {
  items: Array<{
    id: string;
    epoch: string;
    contribution: string;
    amount_atto: string;
    claimed: boolean;
    payout: { status: string; tx_hash: string | null } | null;
  }>;
}

const CATEGORIES = [
  "library", "sdk", "tooling", "documentation", "smart-contract",
  "infrastructure", "education", "research", "application",
];

export default function Dashboard() {
  return (
    <Suspense fallback={<Spinner />}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<User | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [grants, setGrants] = useState<Grants | null>(null);
  const [onchainDev, setOnchainDev] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const [submitForm, setSubmitForm] = useState({ repo: "", category: "library", description: "" });
  const [exportPw, setExportPw] = useState("");
  const [exportedKey, setExportedKey] = useState("");

  const refresh = useCallback(async () => {
    const u = currentUser<User>();
    setUser(u);
    if (!u) return;
    api<Mine>("/api/contributions/mine").then(setMine).catch(() => null);
    api<Grants>("/api/contributions/grants/mine").then(setGrants).catch(() => null);
    if (u.githubUsername) {
      api<Record<string, unknown>>(`/api/platform/developers/${u.githubUsername}`, { auth: false })
        .then(setOnchainDev)
        .catch(() => setOnchainDev(null));
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.push("/login");
      return;
    }
    api<{ user: User }>("/api/auth/me")
      .then((r) => {
        localStorage.setItem("impactdna_user", JSON.stringify(r.user));
        refresh();
      })
      .catch(() => router.push("/login"));
  }, [router, refresh]);

  useEffect(() => {
    const github = searchParams.get("github");
    if (github === "connected") setNotice("GitHub account connected. You can now register on-chain.");
    else if (github === "error") {
      const reason = searchParams.get("reason") ?? "unknown_error";
      setError(`GitHub connection failed: ${reason.replace(/_/g, " ")}`);
    }
    if (github) router.replace("/dashboard");
  }, [searchParams, router]);

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

  const verified = Boolean(onchainDev?.verified);

  return (
    <main className="max-w-container mx-auto w-full px-4 md:px-12 py-10 space-y-6">
      <header className="flex flex-col md:flex-row justify-between md:items-end gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-xs text-green uppercase tracking-widest">● Network pulse</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight">Impact Dashboard</h1>
        </div>
        <div className="glass rounded-full px-5 py-2 flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="label-caps text-on-variant">Wallet</span>
            <span className="font-mono text-sm text-green">{shortAddr(user.walletAddress)}</span>
          </div>
          <div className="w-8 h-8 rounded-full dna-gradient" />
        </div>
      </header>

      {error && <ErrorNote message={error} />}
      {notice && (
        <div className="bg-green/10 border border-green/30 text-green rounded-lg px-4 py-3 text-sm">{notice}</div>
      )}

      {/* Identity stats */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard label="GitHub identity" value={user.githubUsername ?? "not set"} accent="text-primary"
          sub={verified ? "Verified on-chain via GitHub evidence" : "Unverified — verify below"} />
        <StatCard label="On-chain impact score" value={String(onchainDev?.total_score ?? 0)} accent="text-cyan-dim"
          sub="Cumulative across evaluated contributions" />
        <StatCard label="Grants received" value={String(onchainDev?.funded_count ?? 0)} accent="text-green"
          sub="Retroactive funding events" />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-6">
          {/* Step 1: on-chain identity */}
          <GlassCard className="p-8">
            <h2 className="text-xl font-semibold mb-1 flex items-center gap-3">
              <span className="text-primary">01</span> On-chain developer identity
            </h2>
            <p className="text-on-variant text-sm mb-6">
              Connect your GitHub account (OAuth — we never accept a typed username, so you can
              only link the account you actually control), register it on-chain, then verify it —
              validators fetch your GitHub profile inside consensus to prove it exists and matches.
            </p>
            {!user.githubUsername ? (
              <a className="btn-primary inline-flex items-center gap-2"
                href={`${API_URL}/api/auth/github/start?token=${encodeURIComponent(getToken() ?? "")}`}>
                Connect GitHub
              </a>
            ) : !onchainDev ? (
              <div className="flex items-center gap-4">
                <span className="font-mono text-sm text-on-variant">@{user.githubUsername} connected</span>
                <button className="btn-primary" disabled={busy !== ""}
                  onClick={() =>
                    run("register", () =>
                      api("/api/contributions/register-developer", {
                        method: "POST",
                        body: { displayName: user.displayName },
                      }), "Developer registered on-chain. Now verify your identity.")
                  }>
                  {busy === "register" ? "Submitting to GenLayer…" : "Register on-chain"}
                </button>
              </div>
            ) : verified ? (
              <div className="flex items-center gap-3 font-mono text-sm text-green">
                ✓ @{user.githubUsername} verified by validator consensus
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <span className="font-mono text-sm text-on-variant">@{user.githubUsername}</span>
                <button className="btn-ghost" disabled={busy !== ""}
                  onClick={() =>
                    run("verify", () => api("/api/contributions/verify-developer", { method: "POST" }),
                      "GitHub identity verified on-chain.")
                  }>
                  {busy === "verify" ? "Validators verifying…" : "Verify via GitHub"}
                </button>
              </div>
            )}
          </GlassCard>

          {/* Step 2: submit contribution */}
          <GlassCard className="p-8">
            <h2 className="text-xl font-semibold mb-1 flex items-center gap-3">
              <span className="text-cyan-dim">02</span> Submit a contribution
            </h2>
            <p className="text-on-variant text-sm mb-6">
              Submit an open-source repository you shipped. Evaluation judges its real downstream
              impact months after release — thin demos and forks score near zero.
            </p>
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <input className="input-field" placeholder="owner/repository"
                value={submitForm.repo}
                onChange={(e) => setSubmitForm({ ...submitForm, repo: e.target.value })} />
              <select className="input-field" value={submitForm.category}
                onChange={(e) => setSubmitForm({ ...submitForm, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <textarea className="input-field min-h-[100px] mb-4"
              placeholder="What does it do, and what depends on it? (min 20 chars — validators treat this skeptically and check real evidence)"
              value={submitForm.description}
              onChange={(e) => setSubmitForm({ ...submitForm, description: e.target.value })} />
            <button className="btn-primary" disabled={busy !== "" || !verified}
              onClick={() =>
                run("submit", () =>
                  api("/api/contributions", { method: "POST", body: submitForm }),
                  "Contribution submitted on-chain.")
              }>
              {busy === "submit" ? "Submitting to GenLayer…" : verified ? "Submit for evaluation" : "Verify identity first"}
            </button>
          </GlassCard>

          {/* My contributions */}
          <GlassCard className="p-8">
            <h2 className="text-xl font-semibold mb-6 flex items-center gap-3">
              <span className="text-green">03</span> My contributions
            </h2>
            {!mine?.items.length ? (
              <p className="text-on-variant text-sm font-mono">No submissions yet.</p>
            ) : (
              <div className="space-y-4">
                {mine.items.map((c) => (
                  <div key={c.contribution_id}
                    className="p-4 bg-surface-low border border-outline-variant/30 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <Link href={`/contributions/${c.contribution_id}`}
                        className="font-mono text-on-surface hover:text-primary transition-colors">
                        {c.repo}
                      </Link>
                      <p className="text-xs text-on-variant mt-1 font-mono">
                        {c.contribution_id} · {c.category}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusChip status={c.status} />
                      {c.status === "submitted" && (
                        <button className="btn-ghost !py-1.5 !px-4 text-xs" disabled={busy !== ""}
                          onClick={() =>
                            run(`eval-${c.contribution_id}`, () =>
                              api(`/api/contributions/${c.contribution_id}/evaluate`, { method: "POST" }),
                              "Evaluation complete — check the report.")
                          }>
                          {busy === `eval-${c.contribution_id}` ? "Consensus running…" : "Evaluate now"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          {/* My grants */}
          {Boolean(grants?.items.length) && (
            <GlassCard className="p-8">
              <h2 className="text-xl font-semibold mb-6 flex items-center gap-3">
                <span className="text-primary">04</span> My grants
              </h2>
              <div className="space-y-4">
                {grants!.items.map((g) => (
                  <div key={g.id}
                    className="p-4 bg-surface-low border border-outline-variant/30 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-on-surface">{g.id} <span className="text-on-variant text-xs">· {g.contribution}</span></p>
                      <p className="font-mono text-sm text-green mt-1">{formatGen(g.amount_atto)} GEN</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {g.claimed ? (
                        <span className="font-mono text-xs text-green">
                          ✓ claimed{g.payout?.status === "sent" ? " — GEN sent to your wallet" : g.payout?.status === "failed" ? " — payout retry pending" : ""}
                        </span>
                      ) : (
                        <button className="btn-primary !py-1.5 !px-4 text-xs" disabled={busy !== ""}
                          onClick={() =>
                            run(`claim-${g.id}`, () =>
                              api(`/api/contributions/grants/${g.id}/claim`, { method: "POST" }),
                              "Grant claimed — your GEN payout is on its way.")
                          }>
                          {busy === `claim-${g.id}` ? "Claiming…" : "Claim"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>

        {/* Right rail: wallet */}
        <div className="lg:col-span-4 space-y-6">
          <GlassCard className="p-6">
            <h3 className="label-caps text-on-variant mb-4">Permanent wallet</h3>
            <p className="font-mono text-xs break-all bg-surface-lowest p-3 rounded-lg text-green mb-4">
              {user.walletAddress}
            </p>
            <p className="text-xs text-on-variant mb-6 leading-relaxed">
              Generated at signup, AES-256-GCM encrypted server-side. Survives device changes,
              reinstalls and cache clears. StudioNet is gasless — no funding needed.
            </p>
            <h4 className="label-caps text-on-variant mb-3">Export private key</h4>
            {exportedKey ? (
              <div className="space-y-3">
                <p className="font-mono text-[11px] break-all bg-surface-lowest p-3 rounded-lg text-danger">
                  {exportedKey}
                </p>
                <p className="text-xs text-danger">
                  Store this in a password manager. Anyone with it controls your wallet.
                </p>
                <button className="btn-ghost w-full !py-2 text-xs" onClick={() => setExportedKey("")}>
                  Hide key
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <input className="input-field" type="password" placeholder="Confirm account password"
                  value={exportPw} onChange={(e) => setExportPw(e.target.value)} />
                <button className="btn-ghost w-full !py-2 text-xs" disabled={busy !== "" || !exportPw}
                  onClick={() =>
                    run("export", async () => {
                      const r = await api<{ privateKey: string }>("/api/wallet/export", {
                        method: "POST",
                        body: { password: exportPw },
                      });
                      setExportedKey(r.privateKey);
                      setExportPw("");
                    }, "Key revealed below — handle with care.")
                  }>
                  {busy === "export" ? "Verifying…" : "Reveal private key"}
                </button>
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-6">
            <h3 className="label-caps text-on-variant mb-4">How evaluation works</h3>
            <ol className="space-y-3 text-sm text-on-variant list-none">
              {[
                "Leader validator fetches your repo from GitHub inside the contract",
                "LLM scores 5 impact dimensions over the fetched evidence",
                "Every validator independently re-fetches and re-scores",
                "Hard gates (fork / ownership / eligibility) must match; scores agree within tolerance",
                "Eligible work competes for the epoch funding pool by impact weight",
              ].map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="font-mono text-cyan-dim text-xs pt-0.5">{String(i + 1).padStart(2, "0")}</span>
                  {s}
                </li>
              ))}
            </ol>
          </GlassCard>
        </div>
      </section>
    </main>
  );
}
