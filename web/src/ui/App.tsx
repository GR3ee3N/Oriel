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
  // Arrows move in the OSD while it is up, else in the screen in front (or
  // the sign-in and user screens, which use the default scope). The OSD
  // opens on Pause each time; screens keep their place.
  createEffect(
    on(
      () => [state.mode, session.phase, top().scope] as const,
      ([mode, phase, scope]) => setScope(mode === 'osd' ? 'osd' : phase === 'ready' ? scope : 'main', mode === 'osd'),
    ),
  );
  // A page loaded during playback (the shell restarted): pick it up.
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
  // Back from playback: watch state may have changed.
  createEffect(on(() => state.mode, (mode, prev) => mode === 'browse' && prev && prev !== 'browse' && refresh()));

  // The screensaver: Kodi's delay without a key on our screens.
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
    // A key only wakes the screen.
    if (saver()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setSaver(false);
      return;
    }
    const a = action(e);
    if (!a) return;
    e.preventDefault();
    // What the add-on does with a key while the page is hidden; the
    // stand-in can't see keys.
    if (state.desktop && state.mode === 'video') {
      send(a === 'back' ? { cmd: 'stop' } : { cmd: 'osd-on' });
      return;
    }
    // The add-on sends keys during video only while the OSD is up, so one
    // arriving in 'video' was meant for an OSD that hid meanwhile (its
    // timer): an OSD key still, never Back on Home (which leaves the app).
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
      // During playback Kodi handles Play/Pause and Stop itself; the add-on
      // doesn't pass them on.
      case 'playpause':
        playFocused();
        break;
    }
  };

  onMount(() => {
    // Capturing, so a key that wakes the screensaver reaches nothing else.
    document.addEventListener('keydown', onKey, true);
    connect();
    start();
    // After the first frame is on screen.
    ready();
  });
  onCleanup(() => document.removeEventListener('keydown', onKey, true));

  // The OSD stays mounted so it keeps its focus; the mode picks what shows.
  // In 'video' mode nothing does, so the plane is transparent when the
  // add-on hides it.
  return (
    <div class="app" data-mode={state.mode}>
      <main class="browse">
        {/* Starting, connecting and errors: the splash, over everything. */}
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
