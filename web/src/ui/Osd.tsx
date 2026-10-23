// Hardware blending over Kodi video requires black or white for translucent
// elements; opaque colours render correctly. Keys open the full OSD. Playback
// prompts open a corner card, which an arrow key expands to the full controls.

import { createEffect, createMemo, createSignal, type JSX, on, onCleanup, onMount, Show } from 'solid-js';
import { send, state } from '../bridge';
import { focusable } from '@oriel/web';
import { badges, clean, episodeCode, hhmm } from '../plex/format';
import { imageUrl } from '../plex/images';
import { QUALITIES, quality } from '../player/quality';
import {
  acceptPrompt,
  chooseAudio,
  chooseQuality,
  chooseSubtitle,
  dismiss,
  INTRO_AFTER,
  introIn,
  NEXT_AFTER,
  nextIn,
  playback,
  playNextNow,
  prompt,
  type Prompt,
  seekTo,
  thumbs,
} from '../player/playback';
import { SUBTITLES_OFF, type Track } from '../player/tracks';
import { currentServer } from '../session';
import { Menu } from './components/Menu';
import './osd.css';

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hms = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60];
  return (hms[0] ? hms : hms.slice(1)).map((n, i) => (i ? String(n).padStart(2, '0') : n)).join(':');
}

/** Idle timeout in ms; disabled while paused, scrubbing, in a menu or showing a prompt. */
const HIDE_AFTER = 5000;

// Increase scrub steps, in seconds, while an arrow is held.
const STEPS = [10, 10, 10, 30, 30, 60, 60, 120];

export function Osd() {
  const [expanded, setExpanded] = createSignal(false);
  const [target, setTarget] = createSignal<number | null>(null);
  const [thumb, setThumb] = createSignal<string>();
  const [menu, setMenu] = createSignal<'audio' | 'subtitles' | 'quality' | null>(null);
  let held = 0;
  let lastArrow = 0;

  const promptOnly = () => !!prompt() && !expanded();
  // Keep the page blank after a prompt closes until Kodi hides it, preventing
  // a flash of the full OSD.
  const goingDown = createMemo<{ last: Prompt; down: boolean }>(
    (was) => {
      const now = prompt();
      if (state.mode !== 'osd' || now) return { last: now, down: false };
      return { last: now, down: was.down || (!!was.last && !expanded()) };
    },
    { last: null, down: false },
  );
  const going = createMemo(() => goingDown().down);
  // Playback updates refresh the current and estimated end times at minute precision.
  const now = () => {
    void state.player.time;
    return hhmm(new Date());
  };
  const endsAt = () => hhmm(new Date(Date.now() + (duration() - state.player.time) * 1000));
  const duration = () => state.player.duration ?? (playback()?.item.duration ?? 0) / 1000;

  // Reset transient controls when leaving OSD mode.
  createEffect(
    on(
      () => state.mode,
      (mode) => {
        if (mode === 'osd') return;
        setExpanded(false);
        setTarget(null);
        setMenu(null);
      },
    ),
  );
  // Restart the hide timer after a key, playback resume or menu closure.
  const [keyAt, setKeyAt] = createSignal(0);
  const onKey = () => {
    if (state.mode === 'osd') setKeyAt(Date.now());
  };
  onMount(() => document.addEventListener('keydown', onKey, true));
  onCleanup(() => document.removeEventListener('keydown', onKey, true));
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    void keyAt();
    clearTimeout(hideTimer);
    const idle = state.mode === 'osd' && state.player.state === 'playing' && !menu() && target() === null && !prompt();
    if (idle) hideTimer = setTimeout(() => send({ cmd: 'osd-off' }), HIDE_AFTER);
  });
  onCleanup(() => clearTimeout(hideTimer));

  // Hide the page when its unexpanded prompt ends.
  createEffect(on(going, (down) => down && send({ cmd: 'osd-off' })));

  const scrub = (direction: string) => {
    if (direction !== 'left' && direction !== 'right') return false;
    const now = Date.now();
    held = now - lastArrow < 400 ? held + 1 : 0;
    lastArrow = now;
    const step = STEPS[Math.min(held, STEPS.length - 1)] * (direction === 'left' ? -1 : 1);
    const t = Math.min(Math.max((target() ?? state.player.time) + step, 0), Math.max(duration() - 1, 0));
    setTarget(t);
    thumbs().then((b) => {
      if (target() === t) setThumb(b?.frameAt(t));
    });
    return true;
  };
  const commitScrub = () => {
    const t = target();
    if (t === null) return;
    seekTo(t);
    setTarget(null);
  };

  const trackLabel = (tracks: Track[], id: number, none: string) => tracks.find((t) => t.id === id)?.label ?? none;
  const trackOption = (t: Track) => ({ label: t.detail ? `${t.label} · ${t.detail}` : t.label, value: t });
  const focus = (onSelect: () => void, autofocus = false) => (el: HTMLElement) =>
    focusable(el, { scope: 'osd', group: 'osd-buttons', autofocus, onSelect, onFocus: () => setTarget(null) });
  // Show action labels on focus; temporary actions can keep their labels visible.
  const action = (icon: JSX.Element, name: () => string, onSelect: () => void, opts: { named?: boolean; autofocus?: boolean } = {}) => (
    <div class="osd-action" classList={{ named: opts.named }} ref={focus(onSelect, opts.autofocus)}>
      {icon}
      <span class="name">{name()}</span>
    </div>
  );
  // Show the track category and selection; Select opens the choices.
  const track = (icon: JSX.Element, what: string, which: () => string, onSelect: () => void) => (
    <div class="osd-track" ref={focus(onSelect)}>
      {icon}
      <div>
        <small>{what}</small>
        <b>{which()}</b>
      </div>
      <Icon class="more" d={CHEVRONS} />
    </div>
  );
  const paused = () => state.player.state === 'paused';

  return (
    <section class="osd" classList={{ 'prompt-only': promptOnly() }}>
      <Show when={playback()}>
        {(p) => (
          <>
            <Show when={promptOnly()}>
              <div class="prompt">
                <Show when={prompt() === 'next' && p().next}>
                  {(next) => (
                    <div class="next-card">
                      <Show when={next().thumb}>
                        {(t) => <img src={imageUrl(currentServer(), t(), 320, 180)} alt="" />}
                      </Show>
                      <div>
                        <small>Up next</small>
                        <b>
                          {episodeCode(next())} · {clean(next().title)}
                        </b>
                        <Show when={nextIn() !== undefined}>
                          <span class="countdown">Starts in {nextIn()} s</span>
                        </Show>
                      </div>
                    </div>
                  )}
                </Show>
                <div
                  class="btn"
                  ref={(el) =>
                    focusable(el, {
                      scope: 'osd',
                      autofocus: true,
                      onSelect: acceptPrompt,
                      onArrow: () => {
                        setExpanded(true);
                        return true;
                      },
                    })
                  }
                >
                  <Show when={prompt() === 'intro' && introIn() !== undefined}>
                    <div
                      class="intro-fill"
                      style={{
                        'animation-duration': `${INTRO_AFTER}s`,
                        'animation-play-state': state.player.state === 'playing' ? 'running' : 'paused',
                      }}
                    />
                  </Show>
                  <span>{prompt() === 'intro' ? 'Skip intro' : 'Play now'}</span>
                  <Show when={prompt() === 'intro' && introIn() !== undefined}>
                    <span class="intro-secs">{introIn()}</span>
                  </Show>
                </div>
                <Show when={prompt() === 'next' && p().credits && nextIn() !== undefined}>
                  <div class="countdown-bar">
                    <div style={{ transform: `scaleX(${(nextIn() ?? 0) / NEXT_AFTER})` }} />
                  </div>
                </Show>
                <small class="hint">Back to dismiss</small>
              </div>
            </Show>
            <Show when={!promptOnly() && !going()}>
              <div class="osd-panel">
                <div class="osd-head">
                  <div class="osd-title" classList={{ hidden: target() !== null }}>
                    <b>{p().heading}</b>
                    <span>{p().subheading}</span>
                    <div class="osd-badges">
                      {badges(p().item, p().audio.find((t) => t.id === p().audioId)?.stream).map((b) => (
                        <span class="badge">{b}</span>
                      ))}
                      <Show when={p().transcoded}>
                        <span class="badge">Converted</span>
                      </Show>
                    </div>
                  </div>
                  <div class="osd-clock">
                    <b>{now()}</b>
                    <span>Ends at {endsAt()}</span>
                  </div>
                </div>
                <div class="scrubber">
                  <span class="time">{clock(target() ?? state.player.time)}</span>
                  <div
                    class="bar"
                    classList={{ scrubbing: target() !== null }}
                    ref={(el) => focusable(el, { scope: 'osd', onArrow: scrub, onSelect: commitScrub })}
                  >
                    <Show when={p().intro}>
                      {(m) => (
                        <div
                          class="marker"
                          style={{
                            left: `${(m().startTimeOffset / 1000 / duration()) * 100}%`,
                            width: `${((m().endTimeOffset - m().startTimeOffset) / 1000 / duration()) * 100}%`,
                          }}
                        />
                      )}
                    </Show>
                    <div class="fill" style={{ transform: `scaleX(${duration() ? state.player.time / duration() : 0})` }} />
                    <Show when={target() !== null}>
                      <div class="target" style={{ left: `${((target() ?? 0) / duration()) * 100}%` }}>
                        <Show when={thumb()}>{(src) => <img src={src()} alt="" />}</Show>
                        <span>{clock(target() ?? 0)}</span>
                      </div>
                    </Show>
                  </div>
                  <span class="time">-{clock(duration() - (target() ?? state.player.time))}</span>
                </div>
                <div class="buttons">
                  <div class="osd-actions">
                    {action(
                      <Icon d={paused() ? PLAY : PAUSE} fill />,
                      () => (paused() ? 'Play' : 'Pause'),
                      () => send({ cmd: 'set-paused', paused: !paused() }),
                      { autofocus: true },
                    )}
                    <Show when={prompt() === 'intro'}>
                      {action(<Icon d={SKIP} fill />, () => 'Skip intro', acceptPrompt, { named: true })}
                    </Show>
                    <Show when={p().next}>{action(<Icon d={NEXT} fill />, () => 'Next episode', () => playNextNow())}</Show>
                  </div>
                  <div class="osd-tracks">
                    <Show when={p().audio.length > 1}>
                      {track(<Icon d={AUDIO} />, 'Audio', () => trackLabel(p().audio, p().audioId, '—'), () => setMenu('audio'))}
                    </Show>
                    <Show when={p().subtitles.length > 0}>
                      {track(<Icon d={SUBTITLES} />, 'Subtitles', () => trackLabel(p().subtitles, p().subtitleId, 'Off'), () => setMenu('subtitles'))}
                    </Show>
                    {track(<Icon d={QUALITY} />, 'Quality', () => quality(p().quality).label, () => setMenu('quality'))}
                  </div>
                </div>
              </div>
            </Show>
            <Show when={menu() === 'audio'}>
              <Menu
                title="Audio"
                options={p().audio.map(trackOption)}
                selected={p().audio.find((t) => t.id === p().audioId)}
                onChoose={chooseAudio}
                onClose={() => setMenu(null)}
              />
            </Show>
            <Show when={menu() === 'quality'}>
              <Menu
                title="Quality"
                options={QUALITIES.map((q) => ({ label: q.label, value: q.kbps }))}
                selected={p().quality}
                onChoose={chooseQuality}
                onClose={() => setMenu(null)}
              />
            </Show>
            <Show when={menu() === 'subtitles'}>
              <Menu
                title="Subtitles"
                options={[SUBTITLES_OFF, ...p().subtitles].map(trackOption)}
                selected={[SUBTITLES_OFF, ...p().subtitles].find((t) => t.id === p().subtitleId)}
                onChoose={chooseSubtitle}
                onClose={() => setMenu(null)}
              />
            </Show>
          </>
        )}
      </Show>
    </section>
  );
}

/** Hide the OSD and dismiss any prompt, including Up next autoplay. */
export function osdBack(): void {
  if (prompt()) dismiss();
  send({ cmd: 'osd-off' });
}

const PLAY = 'M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z';
const PAUSE = 'M7 4h2.5a1.2 1.2 0 0 1 1.2 1.2v13.6a1.2 1.2 0 0 1-1.2 1.2H7a1.2 1.2 0 0 1-1.2-1.2V5.2A1.2 1.2 0 0 1 7 4zm7.5 0H17a1.2 1.2 0 0 1 1.2 1.2v13.6A1.2 1.2 0 0 1 17 20h-2.5a1.2 1.2 0 0 1-1.2-1.2V5.2A1.2 1.2 0 0 1 14.5 4z';
const NEXT = 'M5 5.5v13a1 1 0 0 0 1.53.85L16 13.2V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.8L6.53 4.65A1 1 0 0 0 5 5.5z';
const SKIP = 'M3 6.2v11.6a.8.8 0 0 0 1.25.66L12 13.1v4.7a.8.8 0 0 0 1.25.66l8.2-5.8a.8.8 0 0 0 0-1.32l-8.2-5.8A.8.8 0 0 0 12 6.2v4.7L4.25 5.54A.8.8 0 0 0 3 6.2z';
const AUDIO = 'M2.5 10v4M6.5 6.5v11M10.5 3.5v17M14.5 8v8M18.5 5.5v13M22 10v4';
const SUBTITLES = 'M4.5 5h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 15h4M14 15h3M7 11h2M12 11h5';
const QUALITY = 'M12 14.5l4-4.5M3.4 19a10 10 0 1 1 17.2 0';
const CHEVRONS = 'm7 9 5-5 5 5M7 15l5 5 5-5';

/** Render a 24×24 icon, filled for playback actions or outlined for settings. */
function Icon(props: { d: string; fill?: boolean; class?: string }) {
  return (
    <svg
      class={props.class}
      viewBox="0 0 24 24"
      fill={props.fill ? 'currentColor' : 'none'}
      stroke={props.fill ? 'none' : 'currentColor'}
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={props.d} />
    </svg>
  );
}
