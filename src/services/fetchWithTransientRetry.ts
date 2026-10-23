const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_MAX_RETRIES = 1;

type TransientRetryOptions = {
  delayMs?: number;
  maxRetries?: number;
  onRetry?: (retryCount: number) => void;
};

const methodFor = (input: string | URL | Request, init?: RequestInit) =>
  (init?.method ?? (
    typeof Request !== "undefined" && input instanceof Request ? input.method : "GET"
  )).toUpperCase();

const isSafeRetryMethod = (method: string) => method === "GET" || method === "HEAD";

const isAbortError = (error: unknown) =>
  typeof DOMException !== "undefined" &&
  error instanceof DOMException &&
  error.name === "AbortError";

// A cross-origin Cloudflare managed challenge commonly appears to browser
// JavaScript as a generic TypeError because the challenge response has no CORS
// headers. Keep this deliberately narrow so ordinary application errors are
// not retried and request methods with side effects are never repeated.
const isTransientFetchError = (error: unknown) =>
  !isAbortError(error) &&
  (error instanceof TypeError || (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "NetworkError"
  ));

const isCloudflareChallenge = (response: Response) =>
  response.status === 403 &&
  response.headers.get("cf-mitigated")?.trim().toLowerCase() === "challenge";

const waitBeforeRetry = (delayMs: number, signal?: AbortSignal | null) => {
  if (delayMs <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
};

/**
 * Retry only idempotent requests that fail before JavaScript can inspect a
 * response. Cloudflare's managed challenge is one such failure for a
 * cross-origin browser request; a subsequent attempt can succeed after the
 * browser has completed the challenge/clearance exchange.
 */
export const fetchWithTransientRetry = async (
  input: string | URL | Request,
  init: RequestInit = {},
  options: TransientRetryOptions = {},
): Promise<Response> => {
  const method = methodFor(input, init);
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? DEFAULT_MAX_RETRIES));
  const delayMs = Math.max(0, options.delayMs ?? DEFAULT_RETRY_DELAY_MS);
  const canRetry = isSafeRetryMethod(method) &&
    !(typeof navigator !== "undefined" && navigator.onLine === false);
  const shouldRetry = () => canRetry && !init.signal?.aborted;
  let retryCount = 0;

  while (true) {
    try {
      const response = await fetch(input, init);
      if (shouldRetry() && retryCount < maxRetries && isCloudflareChallenge(response)) {
        retryCount += 1;
        options.onRetry?.(retryCount);
        await waitBeforeRetry(delayMs, init.signal);
        continue;
      }
      return response;
    } catch (error) {
      if (!shouldRetry() || retryCount >= maxRetries || !isTransientFetchError(error)) {
        throw error;
      }
      retryCount += 1;
      options.onRetry?.(retryCount);
      await waitBeforeRetry(delayMs, init.signal);
    }
  }
};
