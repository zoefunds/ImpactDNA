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
      "1 · Connect — sign a short-lived nonce with your own wallet; ImpactDNA never holds the key. 2 · Link GitHub — authenticated OAuth creates a public gist binding the GitHub account to that wallet, and validators verify both ownership and the exact payload on-chain. 3 · Submit — propose an owned repository to an open epoch. 4 · Evaluate — validators independently fetch GitHub evidence and score five impact dimensions. 5 · Fund — anyone can deposit Base Sepolia USDC; the relayer reconciles each uniquely identified deposit before an opener or curator closes the epoch. 6 · Claim — settled grants are relayed to the Base escrow and recipients claim directly from their wallets. Rejected or flagged work can be appealed once.",
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
    if leader.eligible != mine.eligible:   return False
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
      "When an epoch closes, every eligible, unflagged contribution receives pool × weight ÷ total_weight where weight = score². The quadratic emphasis rewards high-impact work disproportionately while still funding solid mid-tier contributions. Unallocated remainder stays in the closed Base escrow pool and can be withdrawn only after settlement; a funded epoch with no eligible recipients reaches that terminal state through relayer-only settleEmptyEpoch. Active accepted collateral cannot be withdrawn. This settlement step is pure integer math — no LLM, no web — so consensus on it is trivial.",
    ],
  },
  {
    title: "Wallets & security",
    body: [
      "Your connected wallet is your identity and signs every user action; the backend never stores or exports its private key. GitHub usernames cannot be squatted because registration requires an OAuth-created, wallet-bound public proof gist. Base deposits remain pending until the relayer reconciles GenLayer's decision, and late deposits become exactly refundable. GenLayer writes count as successful only when a finalized leader execution returns successfully; finalized execution errors are rejected. Rate limiting, role checks, audit logging, durable relay queues, and strict input validation protect the API. StudioNet is gasless, while Base Sepolia actions require test ETH for gas.",
    ],
  },
  {
    title: "Contract reference",
    body: [
      "The evaluation ledger is deployed on GenLayer StudioNet and USDC custody is deployed on Base Sepolia. Key GenLayer writes include register_developer, submit_contribution, evaluate_contribution, detect_manipulation, open_epoch, close_epoch, request_appeal and resolve_appeal. Relayer-only writes record deposits and acknowledge allocations and claims. The Base escrow exposes deposit(epochId, depositId, amount), refundDeposit, claim and claimMany; settlement uses setGrants or settleEmptyEpoch.",
    ],
    code: `GenLayer: 0xC7606d65963A7e45a2A5E08B102C73efBB307466
Escrow:   0x51c7575D0893D6a5cc98dA5356A8e727502Eb8B0
USDC:     0x036CbD53842c5426634e7929541eC2318f3dCF7e
Networks: GenLayer StudioNet + Base Sepolia`,
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
