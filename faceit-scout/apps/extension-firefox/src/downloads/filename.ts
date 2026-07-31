export function sanitizeFileSegment(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 120);
}

export function createDemoFilename(matchId: string, preferredSubdirectory: string) {
  const directory = preferredSubdirectory
    .split(/[\\/]+/)
    .map((part) => sanitizeFileSegment(part.trim()))
    .filter(Boolean)
    .join("/");
  const filename = `${sanitizeFileSegment(matchId)}.dem.zst`;
  return directory ? `${directory}/${filename}` : filename;
}
