export type UploadState = { status: string; offset?: number };
export type ChunkResult = { complete?: boolean; offset?: number; status?: string };

export class UploadRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function isRetryableUploadError(error: unknown) {
  if (error instanceof UploadRequestError) return error.status === 408 || error.status === 429 || error.status >= 500;
  return error instanceof TypeError || (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name));
}

export async function retryUploadRequest<T>(options: {
  request: () => Promise<T>;
  onRetry?: (attempt: number) => void;
  wait?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
  shouldStop?: () => boolean;
}) {
  const maxRetries = options.maxRetries ?? Infinity;
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (let retries = 0; ; retries += 1) {
    if (options.shouldStop?.()) throw new Error("Upload paused. Click Upload / resume to continue.");
    try { return await options.request(); }
    catch (error) {
      if (!isRetryableUploadError(error) || retries >= maxRetries) throw error;
      const attempt = retries + 1;
      options.onRetry?.(attempt);
      await wait(Math.min(30000, 1000 * 2 ** Math.min(retries, 5)));
    }
  }
}

export async function sendChunkWithRecovery(options: {
  offset: number;
  end: number;
  send: () => Promise<ChunkResult>;
  inspect: () => Promise<UploadState>;
  onRetry?: (attempt: number) => void;
  wait?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
  shouldStop?: () => boolean;
}) {
  let retries = 0;

  while (true) {
    if (options.shouldStop?.()) throw new Error("Upload paused. Click Upload / resume to continue.");
    try {
      return await options.send();
    } catch (error) {
      if (!isRetryableUploadError(error) && !(error instanceof UploadRequestError && error.status === 409)) throw error;
      if (options.shouldStop?.()) throw new Error("Upload paused. Click Upload / resume to continue.");
      const state = await options.inspect().catch(() => null);
      if (state && ["WAITING_FOR_BATCH", "QUEUED", "PROCESSING", "COMPLETED"].includes(state.status)) {
        return { complete: true, offset: options.end, status: state.status };
      }
      if (state && !["AWAITING_UPLOAD", "UPLOADING"].includes(state.status)) throw new Error("This upload was cancelled or failed. Open the match again in the extension.");
      if (state && Number.isSafeInteger(state.offset) && state.offset! > options.offset) {
        return { complete: false, offset: state.offset };
      }
      if (!isRetryableUploadError(error) || retries >= (options.maxRetries ?? Infinity)) throw error;
      retries += 1;
      options.onRetry?.(retries);
      await (options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))))(Math.min(30000, 1000 * 2 ** Math.min(retries - 1, 5)));
    }
  }
}
