import { GlassCard } from "@/components/ui";

export const metadata = { title: "Documentation | ImpactDNA" };

const SECTIONS: Array<{ title: string; body: string[]; code?: string }> = [
  {
    title: "What is ImpactDNA?",
    body: [
      "ImpactDNA is a retroactive public-goods funding protocol. Instead of funding proposals before work begins, it evaluates open-source repositories months after release and rewards the ones that became genuinely foundational.",
      "The judgment — is this work original, adopted, and influential? — is subjective. That is why the core of the platform is a GenLayer Intelligent Contract: multiple validators independently reason over live evidence and must reach consensus before anything is recorded or funded.",
    ],
  },
  {
    title: "The lifecycle",
    body: [
      "1 · Register — create an account; a permanent custodial wallet is generated and encrypted server-side. 2 · Verify — the contract fetches your GitHub profile inside consensus to prove the identity exists and matches. 3 · Submit — propose a repository you shipped, with a category and description. 4 · Evaluate — validators fetch the repo from GitHub in-contract, score five impact dimensions with LLM reasoning, and cross-check each other. 5 · Fund — when a curator closes an epoch, the pool is split deterministically across eligible contributions by quadratic impact weight. 6 · Appeal — rejected or flagged work can be appealed once; validators re-judge against fresh evidence.",
    ],
  },
  {
    title: "How consensus stays honest (and non-strict)",
    body: [
      "Hard gates — fork status, repository ownership, eligibility — must match exactly between leader and validators, because these are the facts a dishonest leader would falsify. Scores, being LLM judgments, agree if they land in the same or an adjacent 25-point bucket. Errors are classified (expected / external / transient / LLM) so validators can agree on failure paths instead of rotating leaders needlessly.",
      "Validators never check only the output format. Each one re-fetches the GitHub evidence and re-runs the scoring, then compares substance: gates, buckets, and repository identity.",
    ],
    code: `def validator_fn(leader):
    mine = refetch_and_rescore()          # independent evidence
    if leader.fork != mine.fork:           return False
    if leader.owner_match != mine.owner_match: return False
    if leader.eligible != mine.eligible:   return False  # narrow threshold corridor allowed
    return buckets_agree(leader.score, mine.score)`,
  },
  {
    title: "Impact dimensions",
    body: [
      "Each contribution is scored 0–20 on five axes, summing to 0–100: downstream usage (is it depended on?), technical importance (does it solve a hard, foundational problem?), originality (forks and boilerplate score near zero — enforced by a deterministic gate, not just the LLM), ecosystem influence (did it shape how others build?), and community adoption (traction relative to its niche).",
    ],
  },
  {
    title: "Funding mathematics",
    body: [
      "When an epoch closes, every eligible, unflagged contribution receives pool × weight ÷ total_weight where weight = score². The quadratic emphasis rewards high-impact work disproportionately while still funding solid mid-tier contributions. Unallocated remainder returns to the treasury. This settlement step is pure integer math — no LLM, no web — so consensus on it is trivial.",
    ],
  },
  {
    title: "Wallets & security",
    body: [
      "Every account gets a wallet at signup. The address never changes and survives device changes, browser resets and reinstalls — the private key is stored AES-256-GCM encrypted and can be exported after re-confirming your password. Rate limiting, RBAC (developer / curator / admin), audit logging, and strict input validation protect the API. StudioNet is gasless, so contract interactions need no token balance.",
    ],
  },
  {
    title: "Contract reference",
    body: [
      "Deployed on GenLayer StudioNet. Key write methods: register_developer, verify_developer, submit_contribution, evaluate_contribution, detect_manipulation (curator), open_epoch / close_epoch (curator), claim_grant, request_appeal, resolve_appeal (curator). Key views: get_platform_info, get_contribution, list_contributions, get_leaderboard, list_epochs, list_grants, get_audit_log.",
    ],
    code: `Contract: 0x0B20d8C224FE2BE01469C70663C0eEcbBD155978
Network:  GenLayer StudioNet (gasless)
Source:   contracts/impact_dna.py — 1,500+ lines, genvm-lint clean`,
  },
];

export default function Docs() {
  return (
    <main className="max-w-4xl mx-auto w-full px-4 md:px-12 py-12 space-y-8 flex-grow">
      <header className="mb-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-primary">Documentation</h1>
        <p className="text-on-variant mt-2">How the protocol evaluates, verifies and funds open-source impact.</p>
      </header>
      {SECTIONS.map((s) => (
        <GlassCard key={s.title} className="p-8">
          <h2 className="text-xl font-semibold mb-4">{s.title}</h2>
          {s.body.map((p, i) => (
            <p key={i} className="text-on-variant text-sm leading-relaxed mb-3">{p}</p>
          ))}
          {s.code && (
            <pre className="mt-4 bg-surface-lowest border border-outline-variant/30 rounded-lg p-4 font-mono text-xs text-cyan-dim overflow-x-auto">
              {s.code}
            </pre>
          )}
        </GlassCard>
      ))}
    </main>
  );
}
