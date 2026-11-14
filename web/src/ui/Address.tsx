import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { t } from '../i18n';
import { focusable, onBack } from '../nav';
import { setAddress } from '../session';
import { Backdrop } from './components/Backdrop';
import { Icon } from './components/Icon';
import { askExit } from './exit';
import './screens/library.css';
import './screens/search.css';

const KEYS = [...'abcdefghijklmnopqrstuvwxyz1234567890.:/-'];

/** The server's address, typed on an on-screen keyboard like Search's. */
export function Address() {
  const [text, setText] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  onBack(askExit);

  const connect = async () => {
    if (busy() || !text().trim()) return;
    setBusy(true);
    setError('');
    try {
      await setAddress(text());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
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
    <div class="key" classList={{ wide }} ref={(el) => focusable(el, { group: 'keyboard', area: 'keyboard', autofocus: k === 'a', onSelect: () => type(k) })}>
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
          <Show when={busy()} fallback={<h2>{error() || t('address.hint')}</h2>}>
            <h2>{t('address.checking')}</h2>
          </Show>
        </div>
      </section>
    </>
  );
}
