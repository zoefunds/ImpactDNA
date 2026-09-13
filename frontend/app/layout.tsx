import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Providers } from "@/components/Providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "ImpactDNA | Retroactive Funding for Open Source",
  description:
    "ImpactDNA uses GenLayer Intelligent Contracts to discover and reward open-source contributions based on their true downstream ecosystem impact.",
  icons: {
    icon: [
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="32" y2="32"><stop offset="0%" stop-color="#00eefc"/><stop offset="100%" stop-color="#d8b9ff"/></linearGradient></defs><rect width="32" height="32" rx="7" fill="#0c0e14"/><path d="M11 4c0 5.5 10 7 10 12S11 19.5 11 28" stroke="url(#g)" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M21 4c0 5.5-10 7-10 12s10 5.5 10 12" stroke="url(#g)" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".55"/><line x1="12.5" y1="8" x2="19.5" y2="8" stroke="#d8b9ff" stroke-width="1.6" stroke-linecap="round"/><line x1="13" y1="16" x2="19" y2="16" stroke="#00eefc" stroke-width="1.6" stroke-linecap="round"/><line x1="12.5" y1="24" x2="19.5" y2="24" stroke="#00e475" stroke-width="1.6" stroke-linecap="round"/></svg>`,
          ),
        type: "image/svg+xml",
      },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${jetbrains.variable} font-sans min-h-screen flex flex-col grid-bg`}>
        <Providers>
          <Nav />
          <div className="pt-16 md:pt-20 flex-grow flex flex-col">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
