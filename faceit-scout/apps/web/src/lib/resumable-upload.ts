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
}) {
  const maxRetries = options.maxRetries ?? 4;
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  for (let retries = 0; ; retries += 1) {
    try { return await options.request(); }
    catch (error) {
      if (!isRetryableUploadError(error) || retries >= maxRetries) throw error;
      const attempt = retries + 1;
      options.onRetry?.(attempt);
      await wait(1000 * 2 ** retries);
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
}) {
  let retries = 0;

  while (true) {
    try {
      return await options.send();
    } catch (error) {
      const state = await options.inspect().catch(() => null);
      if (state && ["QUEUED", "PROCESSING", "COMPLETED"].includes(state.status)) {
        return { complete: true, offset: options.end, status: state.status };
      }
      if (state && Number.isSafeInteger(state.offset) && state.offset! > options.offset) {
        return { complete: false, offset: state.offset };
      }
      if (!isRetryableUploadError(error) || retries >= (options.maxRetries ?? 4)) throw error;
      retries += 1;
      options.onRetry?.(retries);
      await (options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))))(1000 * 2 ** (retries - 1));
    }
  }
}
