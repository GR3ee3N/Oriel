import { createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { focusable } from '@oriel/web';
import { root, type Route, tab } from '../../router';
import { clean, hhmm } from '../../plex/format';
import { changeUser, chooseServer, serverOptions, session } from '../../session';
import { Menu, type MenuOption } from './Menu';
import './topnav.css';

// One clock for every top bar, ticking on the minute.
const [now, setNow] = createSignal(new Date());
let clockTimer: ReturnType<typeof setTimeout> | undefined;
let clockUsers = 0;
function tick() {
  setNow(new Date());
  clockTimer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
}

function useClock() {
  if (clockUsers++ === 0) tick();
  onCleanup(() => {
    if (--clockUsers === 0) clearTimeout(clockTimer);
  });
  return () => hhmm(now());
}

/** The bar on every tab: Home, Search, the libraries, Settings; the user
 * and the time on the right. Up from a screen always lands on the active
 * tab (the bar keeps no focus of its own), and so does the focus while a
 * new tab's content loads. With several servers or Home users, the user
 * opens the account menu: the servers and Switch user. */
export function TopNav() {
  const tabs = (): { label: string; route: Route }[] => [
    { label: 'Home', route: { screen: 'home' } },
    { label: 'Search', route: { screen: 'search' } },
    ...session.sections.map((s) => ({
      label: clean(s.title),
      route: { screen: 'library' as const, section: s.key, title: clean(s.title) },
    })),
    { label: 'Settings', route: { screen: 'settings' } },
  ];
  const active = (r: Route) => {
    const current = root().route;
    return current.screen === r.screen && (r.screen !== 'library' || (current as typeof r).section === r.section);
  };
  const clock = useClock();
  const several = () => session.servers.length > 1;
  const [menu, setMenu] = createSignal(false);
  const accountOptions = (): MenuOption<string>[] => [
    ...(several() ? serverOptions().map((o) => ({ ...o, value: `server:${o.value}` })) : []),
    ...(session.multiUser ? [{ label: 'Switch user', value: 'users' }] : []),
  ];
  const onAccount = (value: string) => {
    if (value === 'users') void changeUser();
    else void chooseServer(value.slice('server:'.length));
  };
  return (
    <nav class="topnav">
      <For each={tabs()}>
        {(t) => (
          <div
            class="tab"
            classList={{ active: active(t.route) }}
            ref={(el) => focusable(el, { group: 'topnav', entry: active(t.route), recall: false, onSelect: () => tab(t.route) })}
          >
            {t.label}
          </div>
        )}
      </For>
      <div
        class="who"
        ref={(el) =>
          (several() || session.multiUser) &&
          focusable(el, { group: 'topnav', recall: false, onSelect: () => setMenu(true) })
        }
      >
        <Show when={session.user?.thumb} fallback={<span class="avatar">{session.user?.title?.[0]}</span>}>
          {(src) => <img class="avatar" src={src()} alt="" />}
        </Show>
        <span class="who-name">
          {session.user?.title}
          <Show when={several()}>
            <small>{session.serverName}</small>
          </Show>
        </span>
      </div>
      <span class="clock">{clock()}</span>
      <Show when={menu()}>
        <Portal>
          <Menu
            title={session.user?.title ?? ''}
            options={accountOptions()}
            selected={`server:${session.serverId}`}
            onChoose={onAccount}
            onClose={() => setMenu(false)}
          />
        </Portal>
      </Show>
    </nav>
  );
}
