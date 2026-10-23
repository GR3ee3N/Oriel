import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { PlexError } from '../plex/client';
import type { HomeUser } from '../plex/types';
import { focusable, onBack } from '@oriel/web';
import { keepUser, pickUser, session } from '../session';
import { Backdrop } from './components/Backdrop';
import { askExit } from './exit';

const PIN_LENGTH = 4;

export function Users() {
  const [asking, setAsking] = createSignal<HomeUser | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');

  // Back returns to the library during a profile switch, or exits at startup
  // when no library session exists.
  onBack(() => keepUser() || askExit());

  const choose = async (user: HomeUser, pin?: string) => {
    if (busy()) return;
    setBusy(true);
    setError('');
    try {
      await pickUser(user, pin);
    } catch (e) {
      setError(e instanceof PlexError && (e.status === 401 || e.status === 403) ? 'Wrong PIN' : String(e));
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
              <h1>Who's watching?</h1>
              <div class="user-row">
                <For each={session.users}>
                  {(user, i) => (
                    <div
                      class="user"
                      ref={(el) =>
                        focusable(el, {
                          // Focus the last profile, falling back to the first.
                          autofocus: session.users.some((u) => u.uuid === session.lastUser)
                            ? user.uuid === session.lastUser
                            : i() === 0,
                          onSelect: () => (user.protected ? setAsking(user) : choose(user)),
                        })
                      }
                    >
                      <Show when={user.thumb} fallback={<div class="avatar">{user.title[0]}</div>}>
                        <img class="avatar" src={user.thumb} alt="" />
                      </Show>
                      <span>{user.title}</span>
                      <Show when={user.protected}>
                        <small>PIN</small>
                      </Show>
                    </div>
                  )}
                </For>
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
  user: HomeUser;
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
    // Keep all four dots filled while plex.tv checks the PIN.
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
      <Show when={props.user.thumb} fallback={<div class="avatar">{props.user.title[0]}</div>}>
        {(src) => <img class="avatar" src={src()} alt="" />}
      </Show>
      <h1>{props.user.title}</h1>
      <p class="pin-prompt">Enter your PIN</p>
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
              {k === 'cancel' ? 'Cancel' : k === 'del' ? <BackspaceIcon /> : k}
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
