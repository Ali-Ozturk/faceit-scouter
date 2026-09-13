import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const demoRequest = z.object({
  demos: z.array(z.object({
    faceitMatchId: z.string().regex(/^1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    url: z.string().max(12000).refine(isDemoUrl, "Unsupported FACEIT demo URL"),
  })).min(1).max(3),
});

export function isDemoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hosts = (process.env.DEMO_DOWNLOAD_HOSTS ?? "demos-europe-central-faceit-cdn.s3.eu-central-003.backblazeb2.com,demos-us-east-faceit-cdn.s3.us-east-005.backblazeb2.com").split(",").map(h => h.trim().toLowerCase());
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash
      && hosts.includes(url.hostname) && /\.dem(?:\.zst)?$/i.test(url.pathname);
  } catch { return false; }
}

export function authorizeDemoRequest(request: Request): boolean {
  const key = process.env.SCOUT_IMPORT_KEY ?? "";
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${key}`;
  return key.length >= 24 && Buffer.byteLength(supplied) === Buffer.byteLength(expected)
    && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
