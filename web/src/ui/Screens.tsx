import { For, Match, Switch } from 'solid-js';
import { ScopeContext } from '../nav';
import { provider } from '../media/servers';
import { type Entry, stack, top } from '../router';
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
        {(p) => <Titles title={p().title} key={p().id} load={(start, size) => provider().playlist(p().id, { start, size })} queue={{ playlist: p().id }} />}
      </Match>
      <Match when={r.screen === 'movie' && r}>{(m) => <Movie id={m().id} />}</Match>
      <Match when={r.screen === 'show' && r}>
        {(s) => <Show id={s().id} season={s().season} episode={s().episode} />}
      </Match>
      <Match when={r.screen === 'collection' && r}>
        {(c) => (
          <Titles
            title={c().title}
            key={c().id}
            load={(start, size) => provider().collection(c().id, { start, size })}
            queue={{ collection: c().id }}
          />
        )}
      </Match>
      <Match when={r.screen === 'titles' && r}>
        {(p) => (
          <Titles
            title={p().title}
            key={`${p().section}/${JSON.stringify(p().query)}`}
            load={(start, size) =>
              provider().titles(p().section, { sort: 'released', unwatched: false, filters: {}, ...p().query }, { start, size })
            }
          />
        )}
      </Match>
    </Switch>
  );
}
