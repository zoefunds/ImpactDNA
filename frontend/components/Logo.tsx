/** DNA double-helix mark — the ImpactDNA brand glyph. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <defs>
        <linearGradient id="dna-g" x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor="#00eefc" />
          <stop offset="100%" stopColor="#d8b9ff" />
        </linearGradient>
      </defs>
      <path
        d="M10 3c0 6 12 8 12 13S10 21 10 29"
        stroke="url(#dna-g)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M22 3c0 6-12 8-12 13s12 5 12 13"
        stroke="url(#dna-g)"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.55"
      />
      <line x1="11.5" y1="7.5" x2="20.5" y2="7.5" stroke="#d8b9ff" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12.5" y1="16" x2="19.5" y2="16" stroke="#00eefc" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="11.5" y1="24.5" x2="20.5" y2="24.5" stroke="#00e475" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <LogoMark size={size} />
      <span className="text-xl font-bold tracking-tighter text-primary">ImpactDNA</span>
    </span>
  );
}
