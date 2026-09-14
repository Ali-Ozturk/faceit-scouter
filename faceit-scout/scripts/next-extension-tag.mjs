import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function nextTag(tags, tagsAtCommit = []) {
  const parse = tag => /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag) ? tag.slice(1).split(".").map(Number) : null;
  const ordered = list => list.map(tag => ({ tag, parts: parse(tag) })).filter(item => item.parts)
    .sort((a, b) => b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2]);
  // Rerunning a successful push rebuilds its release, without allocating another version.
  const existing = ordered(tagsAtCommit)[0];
  if (existing) return existing.tag;
  const parts = [...(ordered(tags)[0]?.parts ?? [0, 1, 0])];
  parts[2]++;
  if (parts[2] > 65535) { parts[2] = 0; parts[1]++; }
  if (parts[1] > 65535) { parts[1] = 0; parts[0]++; }
  if (parts.some(part => part > 65535)) throw new Error("Extension version components must be <= 65535");
  return "v" + parts.join(".");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tags = (...args) => execFileSync("git", ["tag", ...args], { encoding: "utf8" }).trim().split(/\r?\n/);
  console.log(nextTag(tags(), tags("--points-at", "HEAD")));
}
