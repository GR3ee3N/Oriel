import { afterEach, expect, test, vi } from 'vitest';
import { invalidate, metadata } from '../src/plex/api';
import type { Server } from '../src/plex/client';

afterEach(() => {
  invalidate();
  vi.useRealTimers();
});

test('browse data is reused for a minute, then loaded again', async () => {
  vi.useFakeTimers();
  const get = vi.fn(async (path: string) => ({ Metadata: [{ ratingKey: path }] }));
  const server = { id: 'cache-test', get } as unknown as Server;
  await metadata(server, 'a');
  vi.advanceTimersByTime(30_000);
  await metadata(server, 'b');
  vi.advanceTimersByTime(31_000);
  // Evict a at 61 s; retain b at 31 s.
  await metadata(server, 'b');
  await metadata(server, 'a');
  await metadata(server, 'a');
  expect(get.mock.calls.map(([path]) => path)).toEqual(['/library/metadata/a', '/library/metadata/b', '/library/metadata/a']);
});

test('a failed metadata request can be retried after the server recovers', async () => {
  const get = vi.fn().mockRejectedValueOnce(new Error('server offline')).mockResolvedValue({ Metadata: [{ ratingKey: 'a' }] });
  const server = { id: 'retry-test', get } as unknown as Server;
  await expect(metadata(server, 'a')).rejects.toThrow('server offline');
  expect(await metadata(server, 'a')).toMatchObject({ ratingKey: 'a' });
  expect(get).toHaveBeenCalledTimes(2);
});
