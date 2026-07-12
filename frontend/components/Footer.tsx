import Link from "next/link";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="mt-auto w-full bg-surface-lowest border-t border-outline-variant/30">
      <div className="max-w-container mx-auto px-4 md:px-12 py-12 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex flex-col gap-2 items-center md:items-start">
          <Logo />
          <span className="label-caps text-on-variant/70">
            © {new Date().getFullYear()} ImpactDNA · powered by GenLayer
          </span>
        </div>
        <div className="flex flex-wrap justify-center gap-8">
          <Link href="/docs" className="label-caps text-on-variant hover:text-cyan-fixed transition-colors">
            Documentation
          </Link>
          <a
            href="https://docs.genlayer.com"
            target="_blank"
            rel="noreferrer"
            className="label-caps text-on-variant hover:text-cyan-fixed transition-colors"
          >
            GenLayer Resources
          </a>
          <a
            href="https://github.com/zoefunds/ImpactDNA"
            target="_blank"
            rel="noreferrer"
            className="label-caps text-on-variant hover:text-cyan-fixed transition-colors"
          >
            Source Code
          </a>
        </div>
      </div>
    </footer>
  );
}
