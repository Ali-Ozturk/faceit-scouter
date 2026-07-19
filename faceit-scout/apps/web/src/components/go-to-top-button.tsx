"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function GoToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="Go to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={cn(
        "fixed bottom-5 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-slate-200 bg-white/85 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm shadow-slate-950/10 backdrop-blur transition-all hover:border-cyan-200 hover:bg-white hover:text-cyan-700",
        visible ? "pointer-events-auto translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      <ArrowUp className="h-3.5 w-3.5" />
      Go to top
    </button>
  );
}
