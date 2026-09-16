const RELOAD_MESSAGE = "Scout’s background extension did not reply. Reload FACEIT Scout in your browser’s extension manager after building, close and reopen this popup, then retry. Update the backend too if it is still running the old version.";

export async function checkedReply<T>(pending: Promise<unknown>): Promise<T> {
  let response: unknown;
  try { response = await pending; }
  catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (/receiving end|message port|connection.*establish|context invalidated/i.test(text)) throw new Error(RELOAD_MESSAGE);
    throw error;
  }
  if (!response || typeof response !== "object") throw new Error(RELOAD_MESSAGE);
  if ("error" in response && typeof response.error === "string") throw new Error(response.error);
  return response as T;
}
