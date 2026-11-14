import { createResource, createSignal, For, Index, onCleanup, onMount, Show } from 'solid-js';
import { t } from '../i18n';
import type { Profile } from '../media/account';
import { ServerError } from '../media/errors';
import { focusable, onBack } from '../nav';
import { passwordUsers, session, signInWithPassword } from '../session';
import { Backdrop } from './components/Backdrop';
import { Icon } from './components/Icon';
import { Mark } from './Splash';
import './screens/search.css';

/** Who the password form signs in: a listed user, or anyone by name. */
type Form = { name: string };

export function SignIn() {
  const [form, setForm] = createSignal<Form | null>(null);
  // The tile that opened the form takes the focus back when it closes.
  const [last, setLast] = createSignal<string>();
  const [error, setError] = createSignal('');

  return (
    <>
      <Backdrop />
      <Show when={form()} fallback={<Code last={last()} onUser={(name) => setForm({ name })} error={error()} setError={setError} />}>
        {(f) => (
          <Credentials
            name={f().name}
            onClose={() => {
              setLast(f().name);
              setForm(null);
            }}
          />
        )}
      </Show>
    </>
  );
}

/** The sign-in code, with the server's users below when it takes passwords. */
function Code(props: { last?: string; onUser: (name: string) => void; error: string; setError: (e: string) => void }) {
  const [users] = createResource(() => session.canUsePassword, (yes) => (yes ? passwordUsers() : []));
  const [busy, setBusy] = createSignal(false);
  // A user without a password signs in at once.
  const choose = async (user: Profile) => {
    if (!user.protected) {
      if (busy()) return;
      setBusy(true);
      props.setError('');
      try {
        await signInWithPassword(user.name, '');
      } catch (e) {
        props.setError(failure(e));
      } finally {
        setBusy(false);
      }
    } else props.onUser(user.name);
  };
  const tile = (label: string, photo: string | undefined, first: boolean, onSelect: () => void, icon?: 'user') => (
    <div class="user" ref={(el) => focusable(el, { group: 'signin-users', autofocus: first, onSelect })}>
      <Show when={photo} fallback={<div class="avatar">{icon ? <Icon name={icon} /> : label[0]}</div>}>
        <img class="avatar" src={photo} alt="" />
      </Show>
      <span>{label}</span>
    </div>
  );

  return (
    <section class="screen signin">
      <Mark size={110} />
      <h1>{session.code?.title}</h1>
      <Show when={session.code?.code !== ''}>
        <p class="lead">{session.code?.hint}</p>
        <Show when={session.code} fallback={<p class="code dim">····</p>}>
          {(code) => <p class="code">{code().code}</p>}
        </Show>
      </Show>
      <Show when={session.canUsePassword && !users.loading}>
        <Show when={session.code?.code}>
          <p class="lead">{t('start.orPassword')}</p>
        </Show>
        <div class="user-row">
          <For each={users()}>{(user, i) => tile(user.name, user.photo, props.last === undefined ? i() === 0 : user.name === props.last, () => void choose(user))}</For>
          {tile(t('start.otherUser'), undefined, props.last === undefined ? !users()?.length : !users()?.some((u) => u.name === props.last), () => props.onUser(''), 'user')}
        </div>
        <p class="error">{busy() ? t('start.signingIn') : props.error}</p>
      </Show>
    </section>
  );
}

function failure(e: unknown): string {
  return e instanceof ServerError && e.status === 401 ? t('start.passwordWrong') : t('start.passwordFailed');
}

const SMALL = [...'abcdefghijklmnopqrstuvwxyz1234567890'];
const CAPITALS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'];
const SYMBOLS = [...'!@#$%^&*()-_=+[]{};:\'",.<>/?\\|`~äöüß'];

/** User name and password on an on-screen keyboard with capitals and
 * symbols. A hardware keyboard types too, Tab switching fields; its Enter
 * selects like the remote's. */
function Credentials(props: { name: string; onClose: () => void }) {
  const [name, setName] = createSignal(props.name);
  const [password, setPassword] = createSignal('');
  const [field, setField] = createSignal<'name' | 'password'>(props.name ? 'password' : 'name');
  const [page, setPage] = createSignal<'small' | 'capitals' | 'symbols'>('small');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  onBack(props.onClose);

  const keys = () => (page() === 'symbols' ? SYMBOLS : page() === 'capitals' ? CAPITALS : SMALL);
  const edit = (change: (s: string) => string) => {
    setError('');
    if (field() === 'name') setName(change);
    else setPassword(change);
  };
  const submit = async () => {
    if (busy() || !name().trim()) return;
    setBusy(true);
    setError('');
    try {
      await signInWithPassword(name().trim(), password());
    } catch (e) {
      setError(failure(e));
      setPassword('');
      setField('password');
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Backspace') edit((s) => s.slice(0, -1));
    else if (e.key === 'Tab') setField((f) => (f === 'name' ? 'password' : 'name'));
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) edit((s) => s + e.key);
    else return;
    e.preventDefault();
  };
  onMount(() => document.addEventListener('keydown', onKey));
  onCleanup(() => document.removeEventListener('keydown', onKey));

  const input = (which: 'name' | 'password', label: string, text: () => string) => (
    <div
      class="query"
      classList={{ active: field() === which }}
      ref={(el) => focusable(el, { group: 'fields', area: 'keyboard', onFocus: () => setField(which), onSelect: () => setField(which) })}
    >
      <Icon name={which === 'name' ? 'user' : 'lock'} />
      <Show when={text()} fallback={<span class="placeholder">{label}</span>}>
        <span class="text">
          <span>{which === 'password' ? '•'.repeat(text().length) : text()}</span>
        </span>
      </Show>
      <Show when={field() === which}>
        <span class="caret" />
      </Show>
    </div>
  );
  const wide = (label: () => string, onSelect: () => void, on?: () => boolean) => (
    <div class="key wide" classList={{ on: on?.() }} ref={(el) => focusable(el, { group: 'keyboard', area: 'keyboard', onSelect })}>
      {label()}
    </div>
  );
  const toggle = (to: 'capitals' | 'symbols') => setPage((p) => (p === to ? 'small' : to));

  return (
    <section class="screen address credentials">
      <header class="page-head">
        <h1>{session.code?.title}</h1>
      </header>
      <div class="keyboard exact">
        {input('name', t('start.userName'), name)}
        {input('password', t('start.password'), password)}
        <div class="keys">
          <Index each={keys()}>
            {(k, i) => (
              <div class="key" ref={(el) => focusable(el, { group: 'keyboard', area: 'keyboard', autofocus: i === 0, onSelect: () => edit((s) => s + k()) })}>
                {k()}
              </div>
            )}
          </Index>
          {wide(() => t(page() === 'capitals' ? 'keys.small' : 'keys.capitals'), () => toggle('capitals'), () => page() === 'capitals')}
          {wide(() => t(page() === 'symbols' ? 'keys.small' : 'keys.symbols'), () => toggle('symbols'), () => page() === 'symbols')}
          {wide(() => t('search.delete'), () => edit((s) => s.slice(0, -1)))}
          {wide(() => t('search.space'), () => edit((s) => s + ' '))}
          {wide(() => t('search.clear'), () => edit(() => ''))}
          {wide(() => t('start.signInAction'), () => void submit())}
        </div>
      </div>
      <div class="search-note">
        <Show when={busy() || error()}>
          <h2>{busy() ? t('start.signingIn') : error()}</h2>
        </Show>
      </div>
    </section>
  );
}
