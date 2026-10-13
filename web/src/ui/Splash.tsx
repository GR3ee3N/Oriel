// The start: the app's mark over its colour field, what is happening, and
// a progress bar, from the very first frame (osd1 is turned on with it)
// until Home is complete; then it fades into Home. Errors get the same
// screen with Try again.

import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js';
import { homeReady } from '../boot';
import { focusable } from '@oriel/web';
import { root } from '../router';
import { chooseServer, retry, serverOptions, session } from '../session';
import { Backdrop } from './components/Backdrop';
import { Menu } from './components/Menu';
// Inlined rather than loaded: the mark has to be in the page's first frame,
// where Kodi's start window drew mark.png.
import markSvg from './mark.svg?raw';
import './splash.css';

/** Oriel's mark (tools/make-art.py): an arched window with its cross bars
 * and a sill. */
export function Mark(props: { size: number }) {
  return (
    <span
      class="mark"
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
      aria-hidden="true"
      innerHTML={markSvg}
    />
  );
}

// Home that never gets ready (no art, a slow server) is shown after this.
const WAIT_FOR_HOME = 5000;

export function Splash() {
  const [timedOut, setTimedOut] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      () => session.phase,
      (phase) => {
        clearTimeout(timer);
        setTimedOut(false);
        if (phase === 'ready') timer = setTimeout(() => setTimedOut(true), WAIT_FOR_HOME);
      },
    ),
  );
  onCleanup(() => clearTimeout(timer));

  const wanted = () => {
    const phase = session.phase;
    if (phase === 'loading' || phase === 'connecting' || phase === 'error') return true;
    return phase === 'ready' && root().route.screen === 'home' && !homeReady() && !timedOut();
  };
  // Stays mounted while it fades out.
  const [mounted, setMounted] = createSignal(wanted());
  const [leaving, setLeaving] = createSignal(false);
  let fade: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(wanted, (want) => {
      clearTimeout(fade);
      if (want) {
        setLeaving(false);
        setMounted(true);
      } else if (mounted()) {
        setLeaving(true);
        fade = setTimeout(() => setMounted(false), 500);
      }
    }),
  );
  onCleanup(() => clearTimeout(fade));

  const status = () => {
    switch (session.phase) {
      case 'connecting':
        return session.connectingTo ? `Connecting to ${session.connectingTo}` : 'Connecting to your server';
      case 'ready':
        return 'Loading your library';
      default:
        return 'Starting';
    }
  };

  const [choosing, setChoosing] = createSignal(false);

  return (
    <Show when={mounted()}>
      <div class="splash" classList={{ leaving: leaving() }}>
        <Backdrop />
        <div class="splash-body">
          <Mark size={168} />
          <h1 class="wordmark">Oriel</h1>
          <Show
            when={session.phase === 'error'}
            fallback={
              <>
                <Show when={session.user && session.phase !== 'loading'}>
                  <div class="welcome">
                    {/* The initial until the picture is in, under it. */}
                    <span class="avatar">
                      {session.user?.title?.[0]}
                      <Show when={session.user?.thumb}>{(src) => <img src={src()} alt="" />}</Show>
                    </span>
                    <span>Welcome back, {session.user?.title}</span>
                  </div>
                </Show>
                <p class="splash-status">{status()}</p>
                <div class="splash-bar">
                  <div />
                </div>
              </>
            }
          >
            <h2>Something went wrong</h2>
            <p class="splash-error">{session.error}</p>
            <div class="splash-buttons">
              <div class="btn" ref={(el) => focusable(el, { autofocus: true, onSelect: () => void retry() })}>
                Try again
              </div>
              <Show when={session.servers.length > 1}>
                <div class="btn" ref={(el) => focusable(el, { onSelect: () => setChoosing(true) })}>
                  Choose a server
                </div>
              </Show>
            </div>
          </Show>
        </div>
        <Show when={choosing()}>
          <Menu
            title="Server"
            options={serverOptions()}
            selected={session.serverId}
            onChoose={(id) => void chooseServer(id)}
            onClose={() => setChoosing(false)}
          />
        </Show>
      </div>
    </Show>
  );
}
