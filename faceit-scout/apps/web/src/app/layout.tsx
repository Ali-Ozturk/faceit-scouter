import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "FACEIT Scout",
  description: "Local CS2 demo ingestion and scouting dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-4">
            <Link href="/" className="text-lg font-bold">FACEIT Scout</Link>
            <Link href="/analyses" className="text-sm text-slate-700">Discovery</Link>
            <Link href="/imports" className="text-sm text-slate-700">Imports</Link>
            <Link href="/teams" className="text-sm text-slate-700">Lineups</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
