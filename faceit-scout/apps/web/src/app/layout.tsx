import "./globals.css";

export const metadata = {
  title: "FACEIT Scout",
  description: "Local CS2 demo ingestion and scouting dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
          <nav className="mx-auto flex max-w-[1800px] items-center justify-between px-6 py-3">
            <a href="/" className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-md bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 text-sm font-bold text-white shadow-sm shadow-violet-500/25">FS</span>
              <span>
                <span className="block text-sm font-semibold leading-4">FACEIT Scout</span>
                <span className="block text-xs text-muted-foreground">CS2 prep console</span>
              </span>
            </a>
            <div className="flex items-center gap-1 rounded-lg border bg-white/70 p-1 shadow-sm shadow-violet-500/5 backdrop-blur">
              <a href="/analyses" className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-violet-100 hover:text-violet-700">Discovery</a>
              <a href="/imports" className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-cyan-100 hover:text-cyan-700">Imports</a>
              <a href="/teams" className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-amber-100 hover:text-amber-800">Lineups</a>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-[1800px] px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
