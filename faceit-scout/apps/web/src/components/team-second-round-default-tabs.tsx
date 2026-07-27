"use client";

import { useState } from "react";
import { RoundPathPreview } from "@/components/round-path-preview";
import { cn } from "@/lib/utils";
import type { PositionSample, PreviewFilterGroup, UtilitySample } from "@/components/round-path-preview";

type SecondRoundDefaultTab = {
  id: string;
  label: string;
  detail: string;
  tSamples: PositionSample[];
  ctSamples: PositionSample[];
  tUtilities: UtilitySample[];
  ctUtilities: UtilitySample[];
};

type TeamSecondRoundDefaultTabsProps = {
  mapName: string;
  tabs: SecondRoundDefaultTab[];
  filterGroups: PreviewFilterGroup[];
};

export function TeamSecondRoundDefaultTabs({ mapName, tabs, filterGroups }: TeamSecondRoundDefaultTabsProps) {
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id ?? "");
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  if (!activeTab) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]">
      <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTabId(tab.id)}
            className={cn(
              "shrink-0 rounded-md border bg-white px-3 py-2 text-left text-sm shadow-sm transition hover:border-violet-300",
              activeTab.id === tab.id
                ? "border-violet-400 bg-violet-50 text-violet-800 ring-2 ring-violet-100"
                : "border-slate-200 text-slate-700",
            )}
          >
            <span className="block font-semibold">{tab.label}</span>
            <span className="mt-0.5 block text-xs text-slate-500">{tab.detail}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <RoundPathPreview
          title={`${activeTab.label}: T second round`}
          mapName={mapName}
          samples={activeTab.tSamples}
          utilities={activeTab.tUtilities}
          showHeatmap
          allowFullscreen
          density="compact"
          filterGroups={filterGroups}
          maxLegendItems={8}
        />
        <RoundPathPreview
          title={`${activeTab.label}: CT second round`}
          mapName={mapName}
          samples={activeTab.ctSamples}
          utilities={activeTab.ctUtilities}
          showHeatmap
          allowFullscreen
          density="compact"
          filterGroups={filterGroups}
          maxLegendItems={8}
        />
      </div>
    </div>
  );
}
