import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { send, state } from '../bridge';
import { t } from '../i18n';
import type { FoundServer } from '../media/account';
import { focusable, focused, focusOn, onBack } from '../nav';
import { setAddress, setFoundServer } from '../session';
import { Backdrop } from './components/Backdrop';
import { Button } from './components/Controls';
import { Icon } from './components/Icon';
import { askExit } from './exit';
import './screens/library.css';
import './screens/search.css';

const KEYS = [...'abcdefghijklmnopqrstuvwxyz1234567890.:/-'];
/** Servers can start after the screen opens, so the search repeats. */
const SEARCH_EVERY = 10_000;

/** Host and port of a server's first address, for its button. */
function where(server: FoundServer): string {
  return server.addresses[0].replace(/^https?:\/\//, '');
}

/** The server's address, typed on an on-screen keyboard like Search's, or
 * one of the servers found on the box's network. */
export function Address() {
  const [text, setText] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  onBack(askExit);

  const servers = () => state.discovery?.servers ?? [];
  onMount(() => {
    send({ cmd: 'discover' });
    const timer = setInterval(() => send({ cmd: 'discover' }), SEARCH_EVERY);
    onCleanup(() => clearInterval(timer));
  });

  const attempt = async (step: () => Promise<void>) => {
    if (busy()) return;
    setBusy(true);
    setError('');
    try {
      await step();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const connect = () => text().trim() && attempt(() => setAddress(text()));

  // The first server found takes the focus until the user starts typing.
  let firstKey: HTMLElement | undefined;
  let list: HTMLDivElement | undefined;
  createEffect(
    on(
      () => servers().length > 0,
      (any) => {
        const button = list?.querySelector<HTMLElement>('.button');
        if (any && button && !text() && focused() === firstKey) focusOn(button);
      },
    ),
  );
  const type = (k: string) => {
    if (k === 'go') return void connect();
    setError('');
    setText((s) => (k === 'del' ? s.slice(0, -1) : k === 'clear' ? '' : s + k));
  };
  // A keyboard types into the address; Enter connects.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Backspace') type('del');
    else if (e.key.length === 1 && /[a-z0-9.:/-]/i.test(e.key)) type(e.key.toLowerCase());
  };
  onMount(() => document.addEventListener('keydown', onKey));
  onCleanup(() => document.removeEventListener('keydown', onKey));

  const key = (k: string, label: string, wide = false) => (
    <div
      class="key"
      classList={{ wide }}
      ref={(el) => {
        if (k === 'a') firstKey = el;
        focusable(el, { group: 'keyboard', area: 'keyboard', autofocus: k === 'a', onSelect: () => type(k) });
      }}
    >
      {label}
    </div>
  );

  return (
    <>
      <Backdrop />
      <section class="screen address">
        <header class="page-head">
          <h1>{t('address.title')}</h1>
        </header>
        <div class="keyboard">
          <div class="query">
            <Icon name="search" />
            <Show when={text()} fallback={<span class="placeholder">{t('address.placeholder')}</span>}>
              <span class="text">
                <span>{text()}</span>
              </span>
            </Show>
            <span class="caret" />
          </div>
          <div class="keys">
            <For each={KEYS}>{(k) => key(k, k)}</For>
            {key('del', t('search.delete'), true)}
            {key('clear', t('search.clear'), true)}
            {key('go', t('address.connect'), true)}
          </div>
        </div>
        <div class="search-note">
          <Show when={servers().length}>
            <div class="found" ref={list}>
              <p>{t('address.found')}</p>
              <For each={servers()}>
                {(server) => (
                  <Button icon="server" label={server.name} sub={where(server)} group="found" onSelect={() => attempt(() => setFoundServer(server))} />
                )}
              </For>
            </div>
          </Show>
          <Show when={busy()} fallback={<h2>{error() || t(servers().length ? 'address.typeHint' : 'address.hint')}</h2>}>
            <h2>{t('address.checking')}</h2>
          </Show>
        </div>
      </section>
    </>
  );
}
