import { expect, it } from "vitest";
import { checkedReply } from "./rpc";
it("explains missing replies after rebuilding with a stale background worker", async () => {
  await expect(checkedReply(Promise.resolve(undefined))).rejects.toThrow("Reload FACEIT Scout");
  await expect(checkedReply(Promise.resolve(null))).rejects.toThrow("Reload FACEIT Scout");
  await expect(checkedReply(Promise.reject(new Error("Could not establish connection. Receiving end does not exist.")))).rejects.toThrow("Reload FACEIT Scout");
});
it("preserves backend failures and successful manual upload replies", async () => {
  await expect(checkedReply(Promise.resolve({error:"Invalid import access key."}))).rejects.toThrow("Invalid import access key");
  await expect(checkedReply(Promise.resolve({statuses:[]}))).resolves.toEqual({statuses:[]});
});
