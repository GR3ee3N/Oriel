// Hardware blending over Kodi video requires black or white for translucent
// elements; opaque colours render correctly. Keys open the full OSD. Playback
// prompts open a corner card, which an arrow key expands to the full controls.
// Down from the controls opens a strip with the playing item's chapters and
// its play queue.

import { createEffect, createMemo, createSignal, For, type JSX, on, onCleanup, onMount, Show } from 'solid-js';
import { send, state } from '../bridge';
import { focusable, focusOn } from '../nav';
import { t } from '../i18n';
import { badges, clock, hhmm } from '../media/format';
import type { Frame } from '../media/provider';
import { provider } from '../media/servers';
import { hidden } from '../spoilers';
import { position } from '../player/queue';
import { QUALITIES, quality } from '../player/quality';
import {
  chooseAudio,
  chooseQuality,
  chooseSubtitle,
  nextEntry,
  playback,
  playNextNow,
  playQueue,
  seekTo,
  thumbs,
} from '../player/playback';
import { acceptPrompt, dismiss, INTRO_AFTER, introIn, nextIn, nextShare, nextTimed, prompt, type Prompt } from '../player/prompts';
import { SUBTITLES_OFF, type Track } from '../player/tracks';
import { trackHint } from './components/ItemActions';
import { Menu } from './components/Menu';
import { Panel } from './components/Panel';
import { CHEVRON, CHEVRONS, Icon, AUDIO, NEXT, PAUSE, PLAY, QUALITY, SKIP, SUBTITLES } from './OsdIcon';
import { entryLine, entryTitle, Strip, type StripPage, still } from './OsdStrip';
import './osd.css';

/** Idle timeout in ms; disabled while paused, scrubbing, in a menu or showing a prompt. */
const HIDE_AFTER = 5000;

// Increase scrub steps, in seconds, while an arrow is held.
const STEPS = [10, 10, 10, 30, 30, 60, 60, 120];

export function Osd() {
  const [expanded, setExpanded] = createSignal(false);
  const [target, setTarget] = createSignal<number | null>(null);
  const [thumb, setThumb] = createSignal<Frame>();
  const [menu, setMenu] = createSignal<'audio' | 'subtitles' | 'quality' | null>(null);
  const [strip, setStrip] = createSignal<StripPage | null>(null);
  // The button Down opened the strip from, where focus returns.
  let stripFrom: HTMLElement | undefined;
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
        setStrip(null);
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
    const idle = state.mode === 'osd' && state.player.state === 'playing' && !menu() && !strip() && target() === null && !prompt();
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
    // Seek previews would show unwatched scenes.
    if (hidden(playback()?.item)) {
      setThumb(undefined);
      return true;
    }
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
  // The same list as on the detail pages: language, then format and kind.
  const trackOption = <T extends Track>(t: T) => ({ label: t.label, value: t, detail: t.detail || undefined });
  const pages = (): StripPage[] => {
    const p = playback();
    return [...(p?.chapters.length ? ['chapters' as const] : []), ...((playQueue()?.total ?? 0) > 1 ? ['queue' as const] : [])];
  };
  const openStrip = (from: HTMLElement) => {
    const first = pages()[0];
    if (!first) return false;
    stripFrom = from;
    setStrip(first);
    return true;
  };
  // Focus goes back before the strip's cards leave, so it doesn't fall to
  // the first control.
  const closeStrip = () => {
    if (stripFrom?.isConnected) focusOn(stripFrom);
    setStrip(null);
  };
  const focus = (onSelect: () => void, autofocus = false) => (el: HTMLElement) =>
    focusable(el, {
      scope: 'osd',
      group: 'osd-buttons',
      autofocus,
      onSelect,
      onFocus: () => setTarget(null),
      onArrow: (d) => d === 'down' && openStrip(el),
    });
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
                <Show when={prompt() === 'next' && nextEntry()}>
                  {(next) => {
                    const at = () => {
                      const q = playQueue();
                      const n = q && position(q, next().entry);
                      return n ? t('player.upNextAt', { n, total: q!.total }) : t('player.upNext');
                    };
                    return (
                      <div class="next-card">
                        <Show when={still(next().item)} fallback={<div class="next-blank" />}>
                          {(path) => <img src={provider().image(path(), 320, 180, { blur: hidden(next().item) })} alt="" />}
                        </Show>
                        <div>
                          <small>{at()}</small>
                          <b>{entryTitle(next().item)}</b>
                          <span class="next-sub">{entryLine(next().item)}</span>
                          <Show when={nextIn() !== undefined}>
                            <span class="countdown">{t('player.startsIn', { n: nextIn()! })}</span>
                          </Show>
                        </div>
                      </div>
                    );
                  }}
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
                  <span>{prompt() === 'intro' ? t('player.skipIntro') : t('player.playNow')}</span>
                  <Show when={prompt() === 'intro' && introIn() !== undefined}>
                    <span class="intro-secs">{introIn()}</span>
                  </Show>
                </div>
                <Show when={prompt() === 'next' && nextShare() !== undefined}>
                  <div class="countdown-bar" classList={{ timed: nextTimed() }}>
                    <div style={{ transform: `scaleX(${nextShare()})` }} />
                  </div>
                </Show>
                <small class="hint">{t('player.dismiss')}</small>
              </div>
            </Show>
            <Show when={!promptOnly() && !going()}>
              <div class="osd-panel" classList={{ tall: !!strip() }}>
                <div class="osd-head">
                  <div class="osd-title" classList={{ hidden: target() !== null }}>
                    <b>{p().heading}</b>
                    <span>{p().item.kind === 'episode' ? entryLine(p().item) : p().subheading}</span>
                    <div class="osd-badges">
                      {badges(p().item, p().audio.find((t) => t.id === p().audioId)?.stream).map((b) => (
                        <span class="badge">{b}</span>
                      ))}
                      <Show when={p().transcoded}>
                        <span class="badge">{t('player.converted')}</span>
                      </Show>
                    </div>
                  </div>
                  <div class="osd-clock" classList={{ hidden: target() !== null }}>
                    <b>{now()}</b>
                    <span>{t('player.endsAt', { time: endsAt() })}</span>
                  </div>
                </div>
                <div class="scrubber">
                  <span class="time">{clock(target() ?? state.player.time)}</span>
                  <div
                    class="bar"
                    classList={{ scrubbing: target() !== null }}
                    ref={(el) => focusable(el, { scope: 'osd', onArrow: scrub, onSelect: commitScrub })}
                  >
                    {/* The intro and every credits marker, as lighter stretches of the bar. */}
                    <For each={[...(p().intro ? [p().intro!] : []), ...p().allCredits]}>
                      {(m) => (
                        <div
                          class="marker"
                          style={{
                            left: `${(m.start / 1000 / duration()) * 100}%`,
                            width: `${((m.end - m.start) / 1000 / duration()) * 100}%`,
                          }}
                        />
                      )}
                    </For>
                    <div class="fill" style={{ transform: `scaleX(${duration() ? state.player.time / duration() : 0})` }} />
                    <Show when={target() !== null}>
                      <div class="target" style={{ left: `${((target() ?? 0) / duration()) * 100}%` }}>
                        <Show when={thumb()}>{(f) => <Preview frame={f()} />}</Show>
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
                      () => (paused() ? t('player.play') : t('player.pause')),
                      () => send({ cmd: 'set-paused', paused: !paused() }),
                      { autofocus: true },
                    )}
                    <Show when={prompt() === 'intro'}>
                      {action(<Icon d={SKIP} fill />, () => t('player.skipIntro'), acceptPrompt, { named: true })}
                    </Show>
                    <Show when={nextEntry()}>{action(<Icon d={NEXT} fill />, () => t('player.next'), () => playNextNow())}</Show>
                  </div>
                  <div class="osd-tracks">
                    <Show when={p().audio.length > 1}>
                      {track(<Icon d={AUDIO} />, t('player.audio'), () => trackLabel(p().audio, p().audioId, '—'), () => setMenu('audio'))}
                    </Show>
                    <Show when={p().subtitles.length > 0}>
                      {track(<Icon d={SUBTITLES} />, t('player.subtitles'), () => trackLabel(p().subtitles, p().subtitleId, t('settings.off')), () => setMenu('subtitles'))}
                    </Show>
                    {track(<Icon d={QUALITY} />, t('player.quality'), () => quality(p().quality).label, () => setMenu('quality'))}
                  </div>
                </div>
                <Show when={strip()} keyed>
                  {(page) => <Strip page={page} pages={pages()} onPage={setStrip} onClose={closeStrip} />}
                </Show>
                {/* Down opens the strip; the chevron hints at it without another button. */}
                <Show when={!strip() && pages().length}>
                  <Icon d={CHEVRON} class="strip-hint" />
                </Show>
              </div>
            </Show>
            <Show when={menu() === 'audio'}>
              <Panel
                title={t('player.audio')}
                hint={trackHint()}
                options={p().audio.map(trackOption)}
                selected={p().audio.find((t) => t.id === p().audioId)}
                onChoose={(track) => {
                  chooseAudio(track);
                  setMenu(null);
                }}
                onClose={() => setMenu(null)}
              />
            </Show>
            <Show when={menu() === 'quality'}>
              <Menu
                title={t('player.quality')}
                options={QUALITIES.map((q) => ({ label: q.label, value: q.kbps }))}
                selected={p().quality}
                onChoose={chooseQuality}
                onClose={() => setMenu(null)}
              />
            </Show>
            <Show when={menu() === 'subtitles'}>
              <Panel
                title={t('player.subtitles')}
                hint={trackHint()}
                options={[SUBTITLES_OFF, ...p().subtitles].map(trackOption)}
                selected={[SUBTITLES_OFF, ...p().subtitles].find((t) => t.id === p().subtitleId)}
                onChoose={(track) => {
                  chooseSubtitle(track);
                  setMenu(null);
                }}
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

/** A scrub preview. A tile of a sheet shows through a window the size of one
 * tile; offsets in percent of the window move the sheet by whole tiles. */
function Preview(props: { frame: Frame }) {
  return (
    <Show when={props.frame.tile} fallback={<img src={props.frame.url} alt="" />}>
      {(tile) => (
        <div class="sheet" style={{ 'aspect-ratio': `${tile().width} / ${tile().height}` }}>
          <img
            src={props.frame.url}
            alt=""
            style={{ width: `${tile().columns * 100}%`, left: `${-tile().column * 100}%`, top: `${-tile().row * 100}%` }}
          />
        </div>
      )}
    </Show>
  );
}
