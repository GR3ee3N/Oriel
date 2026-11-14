// Helpers the server adapters share when they convert replies into the
// model in model.ts.

/** Remove keys whose value is undefined, so the model holds only what the
 * server said. */
export function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) if (value[key] === undefined) delete value[key];
  return value;
}

const LAYOUTS: Record<number, string> = { 1: '1.0', 2: '2.0', 6: '5.1', 7: '6.1', 8: '7.1' };

/** The layout for a channel count, such as '5.1' for 6; other counts read
 * "<n> ch". Undefined when there are none. */
export function channelLayout(channels: number | undefined): string | undefined {
  if (!channels) return undefined;
  return LAYOUTS[channels] ?? `${channels} ch`;
}
