import { For, Match, Switch } from 'solid-js';
import { ScopeContext } from '../nav';
import { collectionItems, playlistItems, sectionItems } from '../plex/api';
import { type Entry, stack, top } from '../router';
import { currentServer } from '../session';
import { Home } from './screens/Home';
import { Library } from './screens/Library';
import { Movie } from './screens/Movie';
import { Search } from './screens/Search';
import { Settings } from './screens/Settings';
import { Show } from './screens/Show';
import { Titles } from './screens/Titles';
import { Watchlist } from './screens/Watchlist';
import { Playlists } from './screens/Playlists';
import { Remote } from './screens/Remote';

/** Keep stacked screens mounted in separate focus scopes so Back restores
 * their state; display only the top screen. */
export function Screens() {
  return (
    <For each={stack()}>
      {(entry) => (
        <div class="screen-layer" style={{ display: entry === top() ? 'block' : 'none' }}>
          <ScopeContext.Provider value={entry.scope}>
            <Screen entry={entry} />
          </ScopeContext.Provider>
        </div>
      )}
    </For>
  );
}

function Screen(props: { entry: Entry }) {
  const r = props.entry.route;
  return (
    <Switch>
      <Match when={r.screen === 'home'}>
        <Home />
      </Match>
      <Match when={r.screen === 'library' && r}>{(l) => <Library section={l().section} title={l().title} type={l().type} />}</Match>
      <Match when={r.screen === 'search'}>
        <Search />
      </Match>
      <Match when={r.screen === 'settings'}>
        <Settings />
      </Match>
      <Match when={r.screen === 'watchlist'}>
        <Watchlist />
      </Match>
      <Match when={r.screen === 'playlists'}>
        <Playlists />
      </Match>
      <Match when={r.screen === 'remote' && r}>{(x) => <Remote guid={x().guid} title={x().title} />}</Match>
      <Match when={r.screen === 'playlist' && r}>
        {(p) => <Titles title={p().title} key={p().ratingKey} load={(start, size) => playlistItems(currentServer(), p().ratingKey, { start, size })} />}
      </Match>
      <Match when={r.screen === 'movie' && r}>{(m) => <Movie ratingKey={m().ratingKey} />}</Match>
      <Match when={r.screen === 'show' && r}>
        {(s) => <Show ratingKey={s().ratingKey} season={s().season} episode={s().episode} />}
      </Match>
      <Match when={r.screen === 'collection' && r}>
        {(c) => (
          <Titles
            title={c().title}
            key={c().ratingKey}
            load={(start, size) => collectionItems(currentServer(), c().ratingKey, { start, size })}
          />
        )}
      </Match>
      <Match when={r.screen === 'person' && r}>
        {(p) => (
          <Titles
            title={p().title}
            key={p().filter}
            load={(start, size) =>
              sectionItems(currentServer(), p().section, { filter: p().filter, sort: 'year:desc' }, { start, size })
            }
          />
        )}
      </Match>
    </Switch>
  );
}
