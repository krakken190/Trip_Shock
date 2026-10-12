import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { IntroSplash } from "@/components/intro-splash";
import { INTRO_COOKIE } from "@/lib/intro";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "TripShock — what if you change one thing?",
  description: "Dependency-aware what-if simulator for multi-city trips.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const introSeen = (await cookies()).has(INTRO_COOKIE);
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans">
        <IntroSplash seen={introSeen} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
