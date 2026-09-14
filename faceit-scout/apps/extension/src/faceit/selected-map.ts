const names = ["ancient", "anubis", "cache", "dust2", "inferno", "mirage", "nuke", "overpass", "train", "vertigo"];
export function normalizeMap(value: string | null): string | null {
  const name = value?.trim().toLowerCase().replace(/^de_/, "").replace(/\s+/g, "");
  return name && names.includes(name) ? `de_${name}` : null;
}
// Never choose the first map in a veto list. Ambiguity means we keep waiting.
export function chooseSelectedMap(selectedLabels: string[], visibleLabels: string[]): string | null {
  const selected = [...new Set(selectedLabels.map(normalizeMap).filter((value): value is string => !!value))];
  if (selected.length === 1) return selected[0];
  if (selected.length > 1) return null;
  const visible = [...new Set(visibleLabels.map(normalizeMap).filter((value): value is string => !!value))];
  return visible.length === 1 ? visible[0] : null;
}
