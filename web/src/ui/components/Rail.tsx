// Navigation rail on root pages: icons at the left edge that expand into a
// labelled drawer while one has focus. The rail has its own focus scope, so
// arrows on the page never land in it; Left at the page's edge or Back
// opens it on the active destination. Up and Down stay inside, Right
// returns to the page's last focus, and Select opens a destination. Back in
// the rail goes Home, or asks to exit on Home.

import { createSignal, For, onCleanup, Show } from 'solid-js';
import { activeScope, focusOn, focusable, onBack, setScope, useScope } from '../../nav';
import { t } from '../../i18n';
import { clean } from '../../plex/format';
import { goHome, root, type Route, tab, top } from '../../router';
import { changeUser, chooseServer, serverOptions, session } from '../../session';
import { askExit } from '../exit';
import { Avatar } from './Avatar';
import { Icon, type IconName, libraryIcon } from './Icon';
import { Panel } from './Panel';
import './rail.css';

interface Destination {
  id: string;
  label: string;
  icon: IconName;
  route: Route;
}

let opener: (() => boolean) | undefined;

/** Move focus to the active destination of the rail on the top page.
 * Returns false on pages without one, such as details. */
export function openRail(): boolean {
  return opener?.() ?? false;
}

function sameRoot(a: Route, b: Route): boolean {
  if (a.screen !== b.screen) return false;
  return a.screen !== 'library' || (b.screen === 'library' && a.section === b.section);
}

export function Rail() {
  const destinations = (): Destination[] => [
    { id: 'search', label: t('nav.search'), icon: 'search', route: { screen: 'search' } },
    { id: 'home', label: t('nav.home'), icon: 'home', route: { screen: 'home' } },
    { id: 'watchlist', label: t('nav.watchlist'), icon: 'watchlist', route: { screen: 'watchlist' } },
    ...session.sections.map((s) => ({
      id: `library-${s.key}`,
      label: clean(s.title),
      icon: libraryIcon(s.type),
      route: { screen: 'library' as const, section: s.key, title: clean(s.title), type: s.type },
    })),
    ...(session.playlists ? [{ id: 'playlists', label: t('nav.playlists'), icon: 'playlist' as const, route: { screen: 'playlists' as const } }] : []),
  ];
  const settings: Destination = { id: 'settings', label: t('nav.settings'), icon: 'settings', route: { screen: 'settings' } };
  const active = (d: Destination) => sameRoot(root().route, d.route);

  let box!: HTMLElement;
  const page = useScope();
  const scope = `${page}-rail`;
  const open = () => activeScope() === scope;
  const [menu, setMenu] = createSignal(false);

  const leave = () => setScope(page);
  // Fresh entry focuses the active destination, marked autofocus below.
  // The root page stays mounted under detail pages; its rail opens only on
  // top, and not from a panel or dialog over the page.
  const enter = () => {
    if (top().scope !== page || activeScope() !== page) return false;
    setScope(scope, true);
    return true;
  };
  opener = enter;
  onCleanup(() => {
    if (opener === enter) opener = undefined;
  });

  const step = (el: HTMLElement, d: 'up' | 'down' | 'left' | 'right') => {
    if (d === 'right') {
      leave();
      return true;
    }
    if (d === 'left') return true;
    const live = [...box.querySelectorAll<HTMLElement>('.rail-item')];
    const i = live.indexOf(el);
    const next = live[d === 'up' ? i - 1 : i + 1];
    if (next) focusOn(next);
    return true;
  };

  // A root page keeps its route while mounted, so `autofocus` stays correct.
  const register = (el: HTMLElement, onSelect: () => void, active = false) =>
    focusable(el, { scope, autofocus: active, onSelect, onArrow: (d) => step(el, d) });

  const go = (d: Destination) => {
    if (active(d)) return leave();
    if (d.route.screen === 'home') goHome();
    else tab(d.route);
  };

  const accountOptions = () => [
    ...(session.multiUser ? [{ label: t('nav.switchUser'), value: 'users', icon: 'user' as const }] : []),
    ...(session.servers.length > 1
      ? serverOptions().map((o) => ({ label: o.label, value: `server:${o.value}`, icon: 'server' as const }))
      : []),
  ];
  const onAccount = (value: string) => {
    setMenu(false);
    if (value === 'users') void changeUser();
    else void chooseServer(value.slice('server:'.length));
  };

  const Item = (props: { d: Destination }) => (
    <div class="rail-item" classList={{ active: active(props.d) }} ref={(el) => register(el, () => go(props.d), active(props.d))}>
      <Icon name={props.d.icon} />
      <span class="rail-label">{props.d.label}</span>
    </div>
  );

  return (
    <>
      <Show when={open()}>
        <div class="rail-dim" />
        <BackFromRail />
      </Show>
      <nav class="rail" classList={{ open: open() }} ref={box}>
        <div
          class="rail-item rail-profile"
          ref={(el) => register(el, () => accountOptions().length && setMenu(true))}
        >
          <Avatar user={session.user} />
          <span class="rail-label">
            <b>{session.user?.title}</b>
            <small>{session.serverName}</small>
          </span>
        </div>
        <div class="rail-list">
          <For each={destinations()}>{(d) => <Item d={d} />}</For>
        </div>
        <div class="rail-foot">
          <Item d={settings} />
        </div>
      </nav>
      <Show when={menu()}>
          <Panel
            title={session.user?.title ?? ''}
            hint={session.serverName}
            options={accountOptions()}
            selected={`server:${session.serverId}`}
            onChoose={onAccount}
            onClose={() => setMenu(false)}
          />
      </Show>
    </>
  );
}

/** Back in the rail: Home from other destinations, exit confirmation on Home. */
function BackFromRail() {
  onBack(() => (root().route.screen === 'home' ? askExit() : goHome()));
  return null;
}
