import { createResource, createSignal, For, Show } from 'solid-js';
import { open } from '../../actions';
import { focusable } from '@oriel/web';
import { firstCharacters, sectionItems } from '../../plex/api';
import { currentServer } from '../../session';
import { Grid } from '../components/Grid';
import { Menu, type MenuOption } from '../components/Menu';
import { TopNav } from '../components/TopNav';
import './library.css';

const SORTS: MenuOption<string>[] = [
  { label: 'Title', value: 'titleSort' },
  { label: 'Recently added', value: 'addedAt:desc' },
  { label: 'Release date', value: 'originallyAvailableAt:desc' },
  { label: 'Rating', value: 'audienceRating:desc' },
  { label: 'Recently watched', value: 'lastViewedAt:desc' },
];

// Retain each library's sort order for this session.
const remembered = new Map<string, { sort: string; unwatched: boolean }>();

/** Browse a library grid with sorting and an unwatched filter. */
export function Library(props: { section: string; title: string }) {
  const start = remembered.get(props.section) ?? { sort: 'titleSort', unwatched: false };
  const [sort, setSort] = createSignal(start.sort);
  const [unwatched, setUnwatched] = createSignal(start.unwatched);
  const [menu, setMenu] = createSignal(false);
  const [total, setTotal] = createSignal<number>();
  const save = () => remembered.set(props.section, { sort: sort(), unwatched: unwatched() });
  // For title sorting, map each A–Z rail character to its first item index.
  const [letters] = createResource(
    () => (sort() === 'titleSort' ? ([props.section, unwatched()] as const) : null),
    async ([section, unwatchedOnly]) => {
      let at = 0;
      return (await firstCharacters(currentServer(), section, unwatchedOnly)).map((l) => {
        const start = at;
        at += l.size;
        return { key: l.key, start };
      });
    },
  );
  const [jump, setJump] = createSignal<{ index: number; n: number }>();
  let jumps = 0;

  return (
    <div class="library">
      <div class="screen-bg" />
      <TopNav />
      <header class="library-head">
        <h1>{props.title}</h1>
        <span class="count">{total() !== undefined ? `${total()} titles` : ''}</span>
        <div class="tools">
          <div class="btn small" ref={(el) => focusable(el, { group: 'tools', onSelect: () => setMenu(true) })}>
            Sort: {SORTS.find((s) => s.value === sort())?.label}
          </div>
          <div
            class="btn small"
            ref={(el) =>
              focusable(el, {
                group: 'tools',
                onSelect: () => {
                  setUnwatched(!unwatched());
                  save();
                },
              })
            }
          >
            {unwatched() ? 'Unwatched' : 'All'}
          </div>
        </div>
      </header>
      <Grid
        key={`${props.section}/${sort()}/${unwatched()}`}
        load={(start, size) => sectionItems(currentServer(), props.section, { sort: sort(), unwatched: unwatched() }, { start, size })}
        onSelect={open}
        onTotal={setTotal}
        jump={jump()}
      />
      <Show when={sort() === 'titleSort' && letters()?.length}>
        <nav class="az">
          <For each={letters()}>
            {(l) => (
              <div
                class="letter"
                ref={(el) => focusable(el, { group: 'az', recall: false, onSelect: () => setJump({ index: l.start, n: ++jumps }) })}
              >
                {l.key}
              </div>
            )}
          </For>
        </nav>
      </Show>
      <Show when={menu()}>
        <Menu
          title="Sort by"
          options={SORTS}
          selected={sort()}
          onChoose={(v) => {
            setSort(v);
            save();
          }}
          onClose={() => setMenu(false)}
        />
      </Show>
    </div>
  );
}
