import { extensionApi } from "../shared/extension-api.js";

let lastUrl = location.href;

type ContentMessage =
  | { type: "GET_CURRENT_FACEIT_MATCH" }
  | { type: "GET_FACEIT_DEMO_URL"; matchId: string }
  | { type: "TRIGGER_FACEIT_DEMO"; matchId: string };

extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isExtensionMessage(message)) return false;
  if (message.type === "GET_CURRENT_FACEIT_MATCH") {
    sendResponse(detectCurrentMatch());
    return true;
  }
  if (message.type === "GET_FACEIT_DEMO_URL") {
    fetchDemoUrlDirect(message.matchId)
      .then((demoUrl) => sendResponse({ matchId: message.matchId, demoUrl }))
      .catch((error) => sendResponse({ matchId: message.matchId, error: errorMessage(error) }));
    return true;
  }
  if (message.type === "TRIGGER_FACEIT_DEMO") {
    triggerDemo(message.matchId).then(sendResponse);
    return true;
  }
  return false;
});

setInterval(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  extensionApi.runtime.sendMessage({
    type: "CURRENT_FACEIT_MATCH",
    payload: detectCurrentMatch(),
  }).catch(() => undefined);
}, 700);

function detectCurrentMatch() {
  return {
    matchId: extractFaceitMatchId(location.href),
    selectedMap: detectSelectedMap(),
    url: location.href,
  };
}

function isExtensionMessage(value: unknown): value is ContentMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as Record<string, unknown>).type;
  return type === "GET_CURRENT_FACEIT_MATCH" || type === "GET_FACEIT_DEMO_URL" || type === "TRIGGER_FACEIT_DEMO";
}

function extractFaceitMatchId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("faceit.com")) return null;
    const roomMatch = parsed.pathname.match(/\/(?:[a-z]{2}\/)?(?:cs2|csgo)\/room\/([^/?#]+)/i);
    if (roomMatch?.[1]) return decodeURIComponent(roomMatch[1]);
    return parsed.searchParams.get("matchId") ?? parsed.searchParams.get("match_id");
  } catch {
    return null;
  }
}

function detectSelectedMap() {
  const directMapName = [...document.querySelectorAll<HTMLElement>("[class*='styles__Name-sc-cfcaa47d'], [class*='SelectedMap'], [title]")]
    .map((element) => normalizeMapName(element.textContent || element.getAttribute("title")))
    .find((mapName): mapName is string => mapName !== null);
  if (directMapName) return directMapName;

  const pageText = document.body?.innerText ?? "";
  for (const mapName of ["Ancient", "Anubis", "Cache", "Dust2", "Dust 2", "Inferno", "Mirage", "Nuke", "Overpass", "Train", "Vertigo"]) {
    if (new RegExp(`\\b${mapName.replace(" ", "\\s+")}\\b`, "i").test(pageText)) {
      return normalizeMapName(mapName);
    }
  }
  return null;
}

function normalizeMapName(value: string | null) {
  const normalized = value?.trim().toLowerCase().replace(/-/g, "_");
  if (!normalized) return null;
  const aliases: Record<string, string> = {
    ancient: "de_ancient",
    anubis: "de_anubis",
    cache: "de_cache",
    dust2: "de_dust2",
    "dust 2": "de_dust2",
    inferno: "de_inferno",
    mirage: "de_mirage",
    nuke: "de_nuke",
    overpass: "de_overpass",
    train: "de_train",
    vertigo: "de_vertigo",
  };
  if (normalized.startsWith("de_")) return normalized;
  return aliases[normalized] ?? null;
}

async function triggerDemo(matchId: string) {
  try {
    return { matchId, demoUrl: await fetchDemoUrlDirect(matchId) };
  } catch {
    // Fall back to the visible FACEIT action below. Some matches require the page flow.
  }

  const demoUrl = findDemoUrlInPage();
  if (demoUrl) return { matchId, demoUrl };

  const button = await waitForDemoButton();
  if (!button) {
    return {
      matchId,
      error: "Could not find FACEIT's demo download button. Opened the matchroom for manual download.",
    };
  }

  clickElement(button);
  await wait(3000);
  const clickedDemoUrl = findDemoUrlInPage();
  if (clickedDemoUrl) return { matchId, demoUrl: clickedDemoUrl };

  return {
    matchId,
    error: "FACEIT did not expose a demo URL yet. The demo may be unavailable or the page flow changed.",
  };
}

async function fetchDemoUrlDirect(matchId: string) {
  const matchResponse = await fetch(`https://www.faceit.com/api/match/v2/match/${encodeURIComponent(matchId)}`, {
    credentials: "include",
  });
  if (!matchResponse.ok) throw new Error(`FACEIT match API returned ${matchResponse.status}`);
  const matchData = await matchResponse.json();
  const demoUrl = matchData?.payload?.demoURLs?.[0];
  if (!demoUrl || typeof demoUrl !== "string") throw new Error("FACEIT match has no demo URL yet.");

  const downloadResponse = await fetch("https://www.faceit.com/api/download/v2/demos/download-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ resource_url: demoUrl }),
  });
  if (!downloadResponse.ok) throw new Error(`FACEIT download API returned ${downloadResponse.status}`);
  const downloadData = await downloadResponse.json();
  const signedUrl = downloadData?.payload?.download_url;
  if (!signedUrl || typeof signedUrl !== "string") throw new Error("FACEIT did not return a signed demo URL.");
  return signedUrl;
}

async function waitForDemoButton() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    const button = findDemoButton();
    if (button) return button;
    await wait(500);
  }
  return null;
}

function findDemoButton() {
  const candidates = [...document.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>("button,a")];
  return candidates.find((element) => {
    const text = `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""}`.toLowerCase().replace(/\s+/g, " ");
    return (text.includes("watch demo") || text.includes("download demo") || text.includes("demo")) && !element.hasAttribute("disabled");
  }) ?? null;
}

function clickElement(element: HTMLElement) {
  element.scrollIntoView({ block: "center", inline: "center" });
  element.focus();
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
}

function findDemoUrlInPage() {
  const anchors = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")];
  const found = anchors.find((anchor) => isLikelyDemoUrl(anchor.href));
  return found?.href;
}

function isLikelyDemoUrl(url: string) {
  const lower = url.toLowerCase();
  return lower.includes(".dem") || lower.includes(".dem.zst") || (lower.includes("s3") && lower.includes("demo"));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown FACEIT demo error";
}
