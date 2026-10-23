import { createEffect, createSignal, Match, on, onCleanup, onMount, Show, Switch } from 'solid-js';
import { connect, ready, send, state } from '../bridge';
import { refresh } from '../data';
import { action, back, move, playFocused, select, setScope } from '@oriel/web';
import { pop, root, tab, top } from '../router';
import { session, start } from '../session';
import { adoptPlayback, playback } from '../player/playback';
import { Osd, osdBack } from './Osd';
import { Screens } from './Screens';
import { Screensaver } from './Screensaver';
import { SignIn } from './SignIn';
import { Splash } from './Splash';
import { Users } from './Users';
import { noticeMessage } from '../notice';
import { Confirm } from './components/Confirm';
import { answerExit, askExit, exitAsked } from './exit';

export function App() {
  // Route focus to the OSD, active screen or default sign-in/profile scope.
  // Reset OSD focus to Play/Pause on entry; preserve each screen's focus.
  createEffect(
    on(
      () => [state.mode, session.phase, top().scope] as const,
      ([mode, phase, scope]) => setScope(mode === 'osd' ? 'osd' : phase === 'ready' ? scope : 'main', mode === 'osd'),
    ),
  );
  // Restore the active playback after a shell restart reloads the page.
  createEffect(
    on(
      () => [session.phase, state.player.session] as const,
      ([phase]) => {
        const { meta, session: id, state: now } = state.player;
        if (phase !== 'ready' || now === 'idle' || !meta || !id || playback()) return;
        adoptPlayback(meta, id).catch((e) => console.error(`adopt: ${e}`));
      },
    ),
  );
  // Reload progress and watched state when returning from playback.
  createEffect(on(() => state.mode, (mode, prev) => mode === 'browse' && prev && prev !== 'browse' && refresh()));

  // Use Kodi's configured idle delay for the browsing screensaver.
  const [saver, setSaver] = createSignal(false);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(idleTimer);
    const minutes = state.screensaver;
    if (minutes && state.mode === 'browse' && session.phase === 'ready') {
      idleTimer = setTimeout(() => setSaver(true), minutes * 60_000);
    }
  };
  createEffect(
    on(
      () => [state.mode, state.screensaver, session.phase] as const,
      ([mode]) => {
        if (mode !== 'browse') setSaver(false);
        arm();
      },
    ),
  );
  onCleanup(() => clearTimeout(idleTimer));

  const onKey = (e: KeyboardEvent) => {
    arm();
    // Consume the wake key so it does not also activate a control.
    if (saver()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setSaver(false);
      return;
    }
    const a = action(e);
    if (!a) return;
    e.preventDefault();
    // Simulate the add-on's hidden-page key handling in browser development.
    if (state.desktop && state.mode === 'video') {
      send(a === 'back' ? { cmd: 'stop' } : { cmd: 'osd-on' });
      return;
    }
    // Keys arriving after the OSD hides still belong to playback. Treating
    // a delayed Back as browsing input could exit the app from Home.
    const osd = state.mode !== 'browse';
    switch (a) {
      case 'left':
      case 'right':
      case 'up':
      case 'down':
        move(a);
        break;
      case 'select':
        select();
        break;
      case 'back':
        if (back()) break;
        else if (osd) osdBack();
        else if (session.phase === 'ready' && pop()) break;
        else if (session.phase === 'ready' && root().route.screen !== 'home') tab({ screen: 'home' });
        else askExit();
        break;
      // Kodi handles Play/Pause and Stop during playback; forwarded Play keys
      // activate the focused item while browsing.
      case 'playpause':
        playFocused();
        break;
    }
  };

  onMount(() => {
    // Capture keys before other handlers so screensaver wake input is consumed.
    document.addEventListener('keydown', onKey, true);
    connect();
    start();
    // Notify the add-on once the initial page has rendered.
    ready();
  });
  onCleanup(() => document.removeEventListener('keydown', onKey, true));

  // Keep the OSD mounted to preserve focus. CSS hides all page content in
  // video mode, leaving the page transparent when the add-on hides it.
  return (
    <div class="app" data-mode={state.mode}>
      <main class="browse">
        {/* The splash covers startup, connection attempts and errors. */}
        <Switch>
          <Match when={session.phase === 'signin'}>
            <SignIn />
          </Match>
          <Match when={session.phase === 'users'}>
            <Users />
          </Match>
          <Match when={session.phase === 'ready'}>
            <Screens />
          </Match>
        </Switch>
      </main>
      <Osd />
      <Show when={state.mode === 'browse'}>
        <Splash />
      </Show>
      <Show when={noticeMessage()}>{(m) => <div class="notice">{m()}</div>}</Show>
      <Show when={exitAsked() && state.mode === 'browse'}>
        <Confirm title="Exit Oriel?" yes="Exit" no="Cancel" onYes={() => answerExit(true)} onNo={() => answerExit(false)} />
      </Show>
      <Show when={saver()}>
        <Screensaver />
      </Show>
    </div>
  );
}
