// The app's own settings. Kodi's (display, HDR, audio passthrough) stay in
// Kodi's settings.

import { createSignal, type JSX, Show } from 'solid-js';
import { focusable } from '@oriel/web';
import { send, state } from '../../bridge';
import { PRODUCT, VERSION } from '../../plex/client';
import { QUALITIES, quality } from '../../player/quality';
import { ACCENTS, accent, prefs, setPref } from '../../prefs';
import { changeUser, chooseServer, currentServer, serverOptions, session, signOut } from '../../session';
import { Menu, type MenuOption } from '../components/Menu';
import { TopNav } from '../components/TopNav';
import './settings.css';

const HDR_WHITES = [100, 140, 203, 250, 300, 400];

interface Choice {
  title: string;
  options: MenuOption<unknown>[];
  selected: unknown;
  onChoose: (value: unknown) => void;
}

export function Settings() {
  const [choice, setChoice] = createSignal<Choice | null>(null);

  const choose = <T,>(title: string, options: MenuOption<T>[], selected: T, onChoose: (value: T) => void) =>
    setChoice({ title, options, selected, onChoose: onChoose as (value: unknown) => void });

  const Row = (props: { label: string; value: string; onSelect: () => void }): JSX.Element => (
    <div class="setting" ref={(el) => focusable(el, { onSelect: props.onSelect })}>
      <span>{props.label}</span>
      <b>{props.value}</b>
    </div>
  );

  const qualityRow = (label: string, key: 'qualityLocal' | 'qualityRemote') => (
    <Row
      label={label}
      value={quality(prefs[key]).label}
      onSelect={() =>
        choose(
          label,
          QUALITIES.map((q) => ({ label: q.label, value: q.kbps })),
          prefs[key],
          (v) => setPref(key, v),
        )
      }
    />
  );

  return (
    <div class="settings">
      <div class="screen-bg" />
      <TopNav />
      <div class="settings-body">
        <h1>Settings</h1>
        <section class="settings-account">
          <h2>Account</h2>
          <p>
            Watching as <b>{session.user?.title}</b> on <b>{session.serverName}</b>{' '}
            <span class="dim">via {currentServer().uri}</span>
          </p>
          <div class="row-buttons">
            <div class="btn" ref={(el) => focusable(el, { autofocus: true, onSelect: () => changeUser() })}>
              Switch user
            </div>
            <div class="btn" ref={(el) => focusable(el, { onSelect: () => signOut() })}>
              Sign out
            </div>
          </div>
          <Show when={session.servers.length > 1}>
            <Row
              label="Server"
              value={session.serverName ?? ''}
              onSelect={() => choose('Server', serverOptions(), session.serverId ?? '', (id) => void chooseServer(id))}
            />
          </Show>
          <Show when={session.multiUser}>
            <Row
              label="Sign in automatically"
              value={prefs.autoSignIn ? 'On' : 'Off'}
              onSelect={() =>
                choose(
                  'Sign in automatically',
                  [
                    { label: 'Off', value: false },
                    { label: 'On', value: true },
                  ],
                  prefs.autoSignIn,
                  (v) => setPref('autoSignIn', v),
                )
              }
            />
            <p class="dim note">
              Off: the app asks who is watching every time it opens. On: it opens as the last user, without asking for
              a PIN.
            </p>
          </Show>
        </section>
        <section class="settings-playback">
          <h2>Playback</h2>
          {qualityRow('Quality at home', 'qualityLocal')}
          {qualityRow('Quality away from home', 'qualityRemote')}
          <Row
            label="Controls brightness in HDR"
            value={`${state.hdrWhite} nits`}
            onSelect={() =>
              choose(
                'Controls brightness in HDR',
                HDR_WHITES.map((n) => ({ label: `${n} nits${n === 203 ? ' (standard)' : ''}`, value: n })),
                state.hdrWhite,
                // The framework's setting, for every Oriel app on the box.
                (v) => send({ cmd: 'hdr-white', nits: v }),
              )
            }
          />
          <p class="dim note">
            A file over the quality, or in a video format this box can’t decode, is converted by your Plex server.
            Original plays every other file as it is.
          </p>
          <Row
            label="Skip intros"
            value={prefs.autoSkipIntro ? 'Automatically' : 'With a button'}
            onSelect={() =>
              choose(
                'Skip intros',
                [
                  { label: 'With a button', value: false },
                  { label: 'Automatically', value: true },
                ],
                prefs.autoSkipIntro,
                (v) => setPref('autoSkipIntro', v),
              )
            }
          />
          <Row
            label="Skip credits"
            value={prefs.autoSkipCredits ? 'Automatically' : 'With Up next'}
            onSelect={() =>
              choose(
                'Skip credits',
                [
                  { label: 'With Up next', value: false },
                  { label: 'Automatically', value: true },
                ],
                prefs.autoSkipCredits,
                (v) => setPref('autoSkipCredits', v),
              )
            }
          />
          <p class="dim note">
            Automatically: intros are skipped as they start. At the closing credits the next episode plays right away,
            and a movie or a last episode ends; a scene after the credits still plays.
          </p>
        </section>
        <section class="settings-appearance">
          <h2>Appearance</h2>
          <Row
            label="Accent colour"
            value={accent(prefs.accent).label}
            onSelect={() =>
              choose(
                'Accent colour',
                ACCENTS.map((a) => ({ label: a.label, value: a.id, swatch: a.color })),
                prefs.accent,
                (v) => setPref('accent', v),
              )
            }
          />
        </section>
        <section class="settings-about">
          <h2>About</h2>
          <p class="dim">
            {PRODUCT} {VERSION}. Display, HDR and audio settings (passthrough, refresh rate, Dolby Vision) are Kodi’s
            own, in Kodi’s settings.
          </p>
        </section>
      </div>
      <Show when={choice()}>
        {(c) => (
          <Menu
            title={c().title}
            options={c().options}
            selected={c().selected}
            onChoose={c().onChoose}
            onClose={() => setChoice(null)}
          />
        )}
      </Show>
    </div>
  );
}
