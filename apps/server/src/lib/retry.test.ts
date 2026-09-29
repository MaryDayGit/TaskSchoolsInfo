import { describe, expect, it } from 'vitest';
import { retry } from './retry.js';

describe('retry', () => {
  it('retries with exponential backoff until success', async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await retry(
      async () => {
        calls++;
        if (calls < 4) throw new Error('not yet');
        return 'ok';
      },
      {
        attempts: 10,
        initialDelayMs: 100,
        maxDelayMs: 300,
        sleep: async (ms) => void delays.push(ms),
      },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(4);
    expect(delays).toEqual([100, 200, 300]);
  });

  it('gives up after the last attempt with the original error', async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new Error(`fail ${calls}`);
        },
        { attempts: 3, initialDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
      ),
    ).rejects.toThrow('fail 3');
    expect(calls).toBe(3);
  });
});
