export interface RetryOptions {
  attempts: number;
  /** Delay before the 2nd attempt; doubles after each failure. */
  initialDelayMs: number;
  maxDelayMs: number;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Runs `fn` until it succeeds, with exponential backoff between attempts. */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  let delay = opts.initialDelayMs;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.attempts) throw err;
      opts.onRetry?.(err, attempt, delay);
      await sleep(delay);
      delay = Math.min(delay * 2, opts.maxDelayMs);
    }
  }
}
