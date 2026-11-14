import { afterEach, expect, test, vi } from 'vitest';
import { createCache } from '../src/media/cache';

afterEach(() => vi.useRealTimers());

test('replies are reused for a minute, then loaded again', async () => {
  vi.useFakeTimers();
  const { cached } = createCache();
  const load = vi.fn(async () => 'x');
  await cached('a', load);
  vi.advanceTimersByTime(30_000);
  await cached('b', load);
  vi.advanceTimersByTime(31_000);
  // Evict a at 61 s; retain b at 31 s.
  await cached('b', load);
  await cached('a', load);
  await cached('a', load);
  expect(load).toHaveBeenCalledTimes(3);
});

test('clearing drops every reply', async () => {
  const { cached, clear } = createCache();
  const load = vi.fn(async () => 'x');
  await cached('a', load);
  clear();
  await cached('a', load);
  expect(load).toHaveBeenCalledTimes(2);
});

test('a failed request can be retried after the server recovers', async () => {
  const { cached } = createCache();
  const load = vi.fn().mockRejectedValueOnce(new Error('server offline')).mockResolvedValue('ok');
  await expect(cached('a', load)).rejects.toThrow('server offline');
  expect(await cached('a', load)).toBe('ok');
  expect(load).toHaveBeenCalledTimes(2);
});

test('an old request that fails does not drop the newer reply under its key', async () => {
  const { cached, clear } = createCache();
  let fail!: (e: Error) => void;
  const old = cached('a', () => new Promise<string>((_, reject) => (fail = reject)));
  clear();
  const load = vi.fn(async () => 'new');
  await cached('a', load);
  fail(new Error('late'));
  await expect(old).rejects.toThrow('late');
  await cached('a', load);
  expect(load).toHaveBeenCalledTimes(1);
});
