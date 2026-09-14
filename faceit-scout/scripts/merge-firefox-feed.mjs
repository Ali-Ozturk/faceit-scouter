import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function compareVersions(left, right) {
  const a = left.split('.').map(Number), b = right.split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}
export function mergeFeed(current, incoming) {
  const result = structuredClone(current ?? { addons: {} });
  result.addons ??= {};
  for (const [id, addon] of Object.entries(incoming.addons)) {
    const newest = updates => [...(updates ?? [])].sort((a, b) => compareVersions(b.version, a.version))[0];
    const previous = newest(result.addons[id]?.updates);
    const next = newest(addon.updates);
    if (next && (!previous || compareVersions(next.version, previous.version) >= 0)) result.addons[id] = addon;
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [target, source] = process.argv.slice(2);
  const old = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : undefined;
  fs.writeFileSync(target, JSON.stringify(mergeFeed(old, JSON.parse(fs.readFileSync(source, 'utf8'))), null, 2) + '\n');
}
