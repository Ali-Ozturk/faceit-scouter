import { chooseSelectedMap } from "../faceit/selected-map.js";
let lastUrl = location.href;

type ContentMessage =
  | { type: "GET_CURRENT_FACEIT_MATCH" }
  | { type: "GET_FACEIT_DEMO_URL"; matchId: string };

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
  return false;
});

setInterval(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  chrome.runtime.sendMessage({
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
  return type === "GET_CURRENT_FACEIT_MATCH" || type === "GET_FACEIT_DEMO_URL";
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
  const labels = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)]
    .filter(element => element.getClientRects().length > 0)
    .flatMap(element => [element.textContent ?? "", element.getAttribute("title") ?? ""]);
  return chooseSelectedMap(
    labels("[class*='SelectedMap'], [data-testid='selected-map'], [class*='styles__Name-sc-cfcaa47d']"),
    labels("[title]")
  );
}

async function fetchDemoUrlDirect(matchId: string) {
  const matchResponse = await fetch(`https://www.faceit.com/api/match/v2/match/${encodeURIComponent(matchId)}`, {
    credentials: "include",
    signal: AbortSignal.timeout(15000),
  });
  if (!matchResponse.ok) throw new Error(`FACEIT match API returned ${matchResponse.status}`);
  const matchData = await matchResponse.json();
  const demoUrl = matchData?.payload?.demoURLs?.[0];
  if (!demoUrl || typeof demoUrl !== "string") throw new Error("FACEIT match has no demo URL yet.");

  const downloadResponse = await fetch("https://www.faceit.com/api/download/v2/demos/download-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ resource_url: demoUrl }),
  });
  if (!downloadResponse.ok) throw new Error(`FACEIT download API returned ${downloadResponse.status}`);
  const downloadData = await downloadResponse.json();
  const signedUrl = downloadData?.payload?.download_url;
  if (!signedUrl || typeof signedUrl !== "string") throw new Error("FACEIT did not return a signed demo URL.");
  return signedUrl;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown FACEIT demo error";
}
