// The item a detail page shows, loaded again whenever browse data changes.

import { createResource } from 'solid-js';
import { dataVersion } from '../../data';
import type { Item } from '../../media/model';
import { provider } from '../../media/servers';
import { logoReady } from '../components/Info';

/** The item with the given id and, with `logo`, its title logo once that has
 * loaded. A missing item is an error, so the page offers Try again. */
export function createItem(id: () => string, o: { logo?: boolean } = {}) {
  return createResource(
    () => [id(), dataVersion()] as const,
    async ([key]): Promise<{ item: Item; logo?: string }> => {
      const item = await provider().item(key);
      if (!item) throw new Error(`no metadata for ${key}`);
      return o.logo ? { item, logo: await logoReady(item) } : { item };
    },
  );
}
