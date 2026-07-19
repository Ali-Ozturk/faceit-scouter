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
          <nav className="mx-auto flex max-w-[1800px] items-center gap-6 px-6 py-4">
            <a href="/" className="text-lg font-bold">FACEIT Scout</a>
            <a href="/analyses" className="text-sm text-slate-700">Discovery</a>
            <a href="/imports" className="text-sm text-slate-700">Imports</a>
            <a href="/teams" className="text-sm text-slate-700">Lineups</a>
          </nav>
        </header>
        <main className="mx-auto max-w-[1800px] px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
