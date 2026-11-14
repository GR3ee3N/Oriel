import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import type { Profile } from '../media/account';
import { ServerError } from '../media/errors';
import { focusable, onBack } from '../nav';
import { t } from '../i18n';
import { addUser, keepUser, pickUser, session } from '../session';
import { Backdrop } from './components/Backdrop';
import { askExit } from './exit';

const PIN_LENGTH = 4;

export function Users() {
  const [asking, setAsking] = createSignal<Profile | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');

  // Back returns to the library during a profile switch, or exits at startup
  // when no library session exists.
  onBack(() => keepUser() || askExit());

  const choose = async (user: Profile, pin?: string) => {
    if (busy()) return;
    setBusy(true);
    setError('');
    try {
      await pickUser(user, pin);
    } catch (e) {
      setError(e instanceof ServerError && (e.status === 401 || e.status === 403) ? t('start.pinWrong') : t('start.pinFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Backdrop />
      <section class="screen users">
        <Show
          when={asking()}
          fallback={
            <>
              <h1>{t('start.whoWatching')}</h1>
              <div class="user-row">
                <For each={session.users}>
                  {(user, i) => (
                    <div
                      class="user"
                      ref={(el) =>
                        focusable(el, {
                          // Focus the last profile, falling back to the first.
                          autofocus: session.users.some((u) => u.id === session.lastUser)
                            ? user.id === session.lastUser
                            : i() === 0,
                          onSelect: () => (user.protected ? setAsking(user) : choose(user)),
                        })
                      }
                    >
                      <Show when={user.photo} fallback={<div class="avatar">{user.name[0]}</div>}>
                        <img class="avatar" src={user.photo} alt="" />
                      </Show>
                      <span>{user.name}</span>
                      <Show when={user.protected}>
                        <small>{t('start.pin')}</small>
                      </Show>
                    </div>
                  )}
                </For>
                <Show when={session.canAddUser}>
                  <div class="user" ref={(el) => focusable(el, { onSelect: () => void addUser() })}>
                    <div class="avatar add">+</div>
                    <span>{t('start.addUser')}</span>
                  </div>
                </Show>
              </div>
              <p class="error">{error()}</p>
            </>
          }
        >
          {(user) => (
            <PinPad
              user={user()}
              busy={busy()}
              error={error()}
              onDone={(pin) => choose(user(), pin)}
              onCancel={() => {
                setError('');
                setAsking(null);
              }}
            />
          )}
        </Show>
      </section>
    </>
  );
}

function PinPad(props: {
  user: Profile;
  busy: boolean;
  error: string;
  onDone: (pin: string) => void;
  onCancel: () => void;
}) {
  const [pin, setPin] = createSignal('');
  const [wrong, setWrong] = createSignal(false);
  // Keep rejected PIN dots visible through the shake, then clear them for retry.
  let shake: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      () => props.error,
      (error) => {
        if (!error) return;
        setWrong(true);
        clearTimeout(shake);
        shake = setTimeout(() => {
          setWrong(false);
          setPin('');
        }, 420);
      },
    ),
  );
  onCleanup(() => clearTimeout(shake));

  const press = (key: string) => {
    if (key === 'cancel') return props.onCancel();
    // Keep all four dots filled while the account service checks the PIN.
    if (props.busy || wrong()) return;
    if (key === 'del') return setPin((p) => p.slice(0, -1));
    const next = (pin() + key).slice(0, PIN_LENGTH);
    setPin(next);
    if (next.length === PIN_LENGTH) props.onDone(next);
  };
  onBack(props.onCancel);
  // Accept digit keys directly from the remote.
  const onKey = (e: KeyboardEvent) => {
    if (/^[0-9]$/.test(e.key)) press(e.key);
  };
  onMount(() => document.addEventListener('keydown', onKey));
  onCleanup(() => document.removeEventListener('keydown', onKey));

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'cancel', '0', 'del'];
  return (
    <div class="pinpad">
      <Show when={props.user.photo} fallback={<div class="avatar">{props.user.name[0]}</div>}>
        {(src) => <img class="avatar" src={src()} alt="" />}
      </Show>
      <h1>{props.user.name}</h1>
      <p class="pin-prompt">{t('start.pinPrompt')}</p>
      <div class="pin-dots" classList={{ checking: props.busy, wrong: wrong() }}>
        <For each={Array.from({ length: PIN_LENGTH })}>
          {(_, i) => <div class="pin-dot" classList={{ filled: i() < pin().length }} />}
        </For>
      </div>
      <div class="pin-keys">
        <For each={keys}>
          {(k) => (
            <div
              class="pin-key"
              classList={{ label: k === 'cancel' }}
              ref={(el) => focusable(el, { autofocus: k === '1', onSelect: () => press(k) })}
            >
              {k === 'cancel' ? t('action.cancel') : k === 'del' ? <BackspaceIcon /> : k}
            </div>
          )}
        </For>
      </div>
      <p class="error">{props.error}</p>
    </div>
  );
}

/** Draw the backspace key because Inter lacks the ⌫ glyph. */
function BackspaceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z" />
      <path d="M12 9.5l5 5M17 9.5l-5 5" stroke-linecap="round" />
    </svg>
  );
}
