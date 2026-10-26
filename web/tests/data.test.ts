import { createResource, createRoot, createSignal } from 'solid-js';
import { expect, test } from 'vitest';
import { loaded } from '../src/data';

const settle = () => new Promise((resolve) => setTimeout(resolve));

test('a resource keeps its value through a failed reload and has none after a failed first load', async () => {
  const [version, setVersion] = createSignal(0);
  const results = [Promise.reject(new Error('offline')), Promise.resolve('a'), Promise.reject(new Error('offline'))];
  for (const r of results) r.catch(() => undefined);
  const { r, value } = createRoot(() => {
    const [r] = createResource(version, (v) => results[v]);
    return { r, value: loaded(r) };
  });
  await settle();
  expect(r.error).toBeDefined();
  expect(value()).toBeUndefined();
  setVersion(1);
  await settle();
  expect(value()).toBe('a');
  setVersion(2);
  await settle();
  expect(r.error).toBeDefined();
  expect(value()).toBe('a');
});
