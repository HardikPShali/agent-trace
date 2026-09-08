import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Agent Trace | Understand Every AI Decision",
  description: "A visual workspace for debugging, comparing and evaluating AI agent runs.",
  other: { "codex-preview": "development" },
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
