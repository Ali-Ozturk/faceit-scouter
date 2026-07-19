"use client";

import { useEffect, useState } from "react";
import { Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";

export type OpeningMatrixNavItem = {
  id: string;
  nickname: string;
  rounds: number;
  tRounds: number;
  ctRounds: number;
  utilityEvents: number;
};

export function OpeningMatrixNav({ items }: { items: OpeningMatrixNavItem[] }) {
  const [activeId, setActiveId] = useState(items[0]?.id ?? "");

  useEffect(() => {
    if (!items.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (visible?.target.id) setActiveId(visible.target.id);
      },
      { rootMargin: "-22% 0px -58% 0px", threshold: [0.08, 0.25, 0.5, 0.75] },
    );

    for (const item of items) {
      const element = document.getElementById(item.id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [items]);

  const jumpToPlayer = (id: string) => {
    const scrollToTarget = (behavior: ScrollBehavior) => {
      const element = document.getElementById(id);
      if (!element) return;
      const top = element.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo({ top, behavior });
    };

    setActiveId(id);
    window.history.replaceState(null, "", `#${id}`);
    scrollToTarget("auto");
    window.setTimeout(() => scrollToTarget("auto"), 120);
    window.setTimeout(() => scrollToTarget("auto"), 320);
  };

  return (
    <aside className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-hidden rounded-lg border bg-white shadow-sm">
      <div className="border-b bg-slate-50 px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-cyan-100 text-cyan-700">
            <Crosshair className="h-4 w-4" />
          </span>
          Players
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Jump to an opening preview</p>
      </div>
      <nav className="max-h-[calc(100vh-12rem)] overflow-y-auto p-2">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={(event) => {
                event.preventDefault();
                jumpToPlayer(item.id);
              }}
              className={cn(
                "group block rounded-md border border-transparent px-3 py-3 transition-colors",
                active
                  ? "border-cyan-200 bg-cyan-50 text-cyan-950 shadow-sm"
                  : "text-slate-700 hover:border-slate-200 hover:bg-slate-50",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{item.nickname}</span>
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold">
                  <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700">T: {item.tRounds}</span>
                  <span className="rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-cyan-700">CT: {item.ctRounds}</span>
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {item.rounds} rounds · {item.utilityEvents} util
              </div>
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
