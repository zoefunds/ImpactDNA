"use client";

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui";

// Uses the AppKit wallet-connect hook, which is only initialized
// client-side (components/Providers.tsx) — never server-rendered.
const LoginInner = dynamic(() => import("./LoginInner"), { ssr: false, loading: () => <Spinner /> });

export default function Login() {
  return <LoginInner />;
}
