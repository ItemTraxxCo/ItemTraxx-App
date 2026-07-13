export class TimeoutError extends Error {
  constructor(message = "Request timed out. Unable to reach ItemTraxx servers.") {
    super(message);
    this.name = "TimeoutError";
  }
}

export const withTimeout = async <T>(
  promise: PromiseLike<T>,
  timeoutMs: number,
  message = "Request timed out. Unable to reach ItemTraxx Servers."
): Promise<T> => {
  let timeoutId: number | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new TimeoutError(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  }
};
