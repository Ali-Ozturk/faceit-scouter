import { beforeEach, expect, it, vi } from "vitest";
import manifestSource from "../../manifest.source.json";
vi.mock("../storage/settings.js", () => ({ getSettings: async () => ({ backendUrl:"https://scout.example.com",importKey:"test-key-long-enough-for-imports",faceitPlayerId:"player" }), saveSettings:vi.fn() }));
const matchId = "1-12345678-1234-4234-8234-123456789abc";
let listener: (message: unknown, sender: unknown, reply: (value: unknown) => void) => void;
let api: any;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.resetModules();
  api = { alarms:{create:vi.fn(),onAlarm:{addListener:vi.fn()}},
    runtime:{onMessage:{addListener:vi.fn(fn => {listener=fn;})},sendMessage:vi.fn(async()=>{})},
    tabs:{query:vi.fn(async()=>[{url:`https://www.faceit.com/en/cs2/room/${matchId}`}]),create:vi.fn(async()=>({id:1}))},
    storage:{local:{get:vi.fn(async()=>({})),set:vi.fn(async()=>{})}} };
  vi.stubGlobal("chrome",api); vi.stubGlobal("browser",api);
  fetchMock=vi.fn(async()=>new Response(JSON.stringify({jobs:[{id:"a2345678-1234-4234-8234-123456789abc",faceitMatchId:matchId,status:"AWAITING_UPLOAD"}]})));
  vi.stubGlobal("fetch",fetchMock);
  await import("./service-worker");
});
it("reads only the active tab URL for match detection", async()=>{
  const result=await new Promise(resolve=>listener({type:"GET_CURRENT_FACEIT_MATCH"},{},resolve));
  expect(result).toMatchObject({matchId,selectedMap:null});
  expect(fetchMock).not.toHaveBeenCalled();
});
it("opens three matchrooms and the authenticated upload workflow without accessing FACEIT endpoints", async()=>{
  const candidates=[matchId,matchId.replace("12345678","22345678"),matchId.replace("12345678","32345678")].map(faceitMatchId=>({faceitMatchId,processed:false,map:"de_mirage"}));
  await new Promise(resolve=>listener({type:"OPEN_SELECTED_MATCHES",candidates,includeProcessed:false},{},resolve));
  expect(api.tabs.create).toHaveBeenCalledTimes(4);
  expect(api.tabs.create.mock.calls[0][0].url).toMatch(/^https:\/\/scout.example.com\/imports\?uploads=/);
  for(const call of api.tabs.create.mock.calls) expect(call[0].url).not.toContain("test-key");
  expect(fetchMock.mock.calls.every(([url])=>String(url)==="https://scout.example.com/api/demo-uploads")).toBe(true);
  const [, options] = fetchMock.mock.calls[0] as unknown as [string,RequestInit];
  expect(options.headers).toMatchObject({Authorization:"Bearer test-key-long-enough-for-imports"});
  expect(options.body).not.toContain('"url"');
});
it("ships without content scripts, script injection or FACEIT/CDN host permissions",()=>{
  const manifest = manifestSource as Record<string, any>;
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.permissions).not.toContain("scripting");
  expect(manifest.host_permissions).toEqual(["http://localhost/*","http://127.0.0.1/*"]);
});
