"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./Logo";
import { clearSession, currentUser, shortAddr } from "@/lib/api";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/explorer", label: "Contribution Explorer" },
  { href: "/funding", label: "Funding Explorer" },
  { href: "/developers", label: "Developer Profiles" },
  { href: "/docs", label: "Docs" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ displayName?: string; walletAddress?: string; role?: string } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setUser(currentUser());
  }, [pathname]);

  return (
    <nav className="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-md border-b border-white/10">
      <div className="max-w-container mx-auto px-4 md:px-12 h-16 md:h-20 flex items-center justify-between">
        <div className="flex items-center gap-10">
          <Link href="/">
            <Logo />
          </Link>
          <div className="hidden lg:flex items-center gap-6">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={
                  pathname?.startsWith(l.href)
                    ? "text-primary border-b-2 border-primary pb-1 text-sm"
                    : "text-on-variant hover:text-primary transition-colors text-sm"
                }
              >
                {l.label}
              </Link>
            ))}
            {(user?.role === "curator" || user?.role === "admin") && (
              <Link
                href="/admin"
                className={
                  pathname?.startsWith("/admin")
                    ? "text-primary border-b-2 border-primary pb-1 text-sm"
                    : "text-on-variant hover:text-primary transition-colors text-sm"
                }
              >
                Admin
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <div className="hidden md:flex flex-col items-end mr-1">
                <span className="label-caps text-on-variant">{user.displayName}</span>
                <span className="font-mono text-xs text-green">{shortAddr(user.walletAddress)}</span>
              </div>
              <button
                className="btn-ghost !py-2 !px-4"
                onClick={() => {
                  clearSession();
                  setUser(null);
                  router.push("/");
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="btn-primary !py-2 !px-5 text-sm">
              Connect wallet
            </Link>
          )}
          <button
            className="lg:hidden text-on-variant text-2xl leading-none px-2"
            aria-label="Menu"
            onClick={() => setOpen(!open)}
          >
            ≡
          </button>
        </div>
      </div>
      {open && (
        <div className="lg:hidden border-t border-white/10 bg-surface px-6 py-4 flex flex-col gap-3">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-on-variant hover:text-primary" onClick={() => setOpen(false)}>
              {l.label}
            </Link>
          ))}
          {(user?.role === "curator" || user?.role === "admin") && (
            <Link href="/admin" className="text-on-variant hover:text-primary" onClick={() => setOpen(false)}>
              Admin
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}
