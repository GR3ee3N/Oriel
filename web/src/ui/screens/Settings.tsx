// The app's own settings. Kodi's (display, HDR, audio passthrough) stay in
// Kodi's settings.
//
// The settings are a list on the left; the focused one's choices are always
// shown on the right. Right or Select moves into the choices (their own focus
// scope); a choice, Left or Back returns to the list.

import { createMemo, createSignal, For, type JSX, onCleanup, Show } from 'solid-js';
import { activeScope, focusable, onBack, setScope } from '@oriel/web';
import { send, state } from '../../bridge';
import { PRODUCT, VERSION } from '../../plex/client';
import { QUALITIES, quality } from '../../player/quality';
import { ACCENTS, accent, prefs, setPref } from '../../prefs';
import { changeUser, chooseServer, currentServer, serverOptions, session, signOut } from '../../session';
import type { MenuOption } from '../components/Menu';
import { TopNav } from '../components/TopNav';
import './settings.css';

const HDR_WHITES = [100, 140, 203, 250, 300, 400];
const CHOICES = 'settings-choices';

interface Setting {
  label: string;
  value: () => string;
  swatch?: () => string;
  options: () => MenuOption<unknown>[];
  selected: () => unknown;
  onChoose: (value: unknown) => void;
}

const setting = <T,>(s: {
  label: string;
  value: () => string;
  swatch?: () => string;
  options: () => MenuOption<T>[];
  selected: () => T;
  onChoose: (value: T) => void;
}) => s as Setting;

const onOff = <T,>(label: string, off: [string, T], on: [string, T], get: () => T, set: (value: T) => void) =>
  setting({
    label,
    value: () => (get() === on[1] ? on[0] : off[0]),
    options: () => [
      { label: off[0], value: off[1] },
      { label: on[0], value: on[1] },
    ],
    selected: get,
    onChoose: set,
  });

const qualitySetting = (label: string, key: 'qualityLocal' | 'qualityRemote') =>
  setting({
    label,
    value: () => quality(prefs[key]).label,
    options: () => QUALITIES.map((q) => ({ label: q.label, value: q.kbps })),
    selected: () => prefs[key],
    onChoose: (kbps) => setPref(key, kbps),
  });

const SERVER = setting({
  label: 'Server',
  value: () => session.serverName ?? '',
  options: serverOptions,
  selected: () => session.serverId ?? '',
  onChoose: (id) => void chooseServer(id),
});
const AUTO_SIGN_IN = onOff('Sign in automatically', ['Off', false], ['On', true], () => prefs.autoSignIn, (on) =>
  setPref('autoSignIn', on),
);
const PLAYBACK = [
  qualitySetting('Quality at home', 'qualityLocal'),
  qualitySetting('Quality away from home', 'qualityRemote'),
  setting({
    label: 'Controls brightness in HDR',
    value: () => `${state.hdrWhite} nits`,
    options: () => HDR_WHITES.map((n) => ({ label: `${n} nits${n === 203 ? ' (standard)' : ''}`, value: n })),
    selected: () => state.hdrWhite,
    // The framework's setting, for every Oriel app on the box.
    onChoose: (nits) => send({ cmd: 'hdr-white', nits }),
  }),
  onOff('Skip intros', ['With a button', false], ['Automatically', true], () => prefs.autoSkipIntro, (on) =>
    setPref('autoSkipIntro', on),
  ),
  onOff('Skip credits', ['With Up next', false], ['Automatically', true], () => prefs.autoSkipCredits, (on) =>
    setPref('autoSkipCredits', on),
  ),
];
const ACCENT = setting({
  label: 'Accent colour',
  value: () => accent(prefs.accent).label,
  swatch: () => accent(prefs.accent).color,
  options: () => ACCENTS.map((a) => ({ label: a.label, value: a.id, swatch: a.color })),
  selected: () => prefs.accent,
  onChoose: (id) => setPref('accent', id),
});

/** Mounted while the choices have the focus: Back returns to the list. */
function BackTo(props: { leave: () => void }) {
  onBack(() => props.leave());
  return null;
}

function Avatar(props: { class: string }) {
  return (
    <Show when={session.user?.thumb} fallback={<span class={`avatar ${props.class}`}>{session.user?.title?.[0]}</span>}>
      {(src) => <img class={`avatar ${props.class}`} src={src()} alt="" />}
    </Show>
  );
}

export function Settings() {
  // The focused row: the account, or a setting.
  const [shown, setShown] = createSignal<Setting | 'account'>('account');
  const [inside, setInside] = createSignal(false);
  let previous = activeScope();

  const enter = () => {
    previous = activeScope();
    setInside(true);
    setScope(CHOICES, true);
  };
  const leave = () => {
    setInside(false);
    setScope(previous);
  };
  onCleanup(() => {
    if (inside()) setScope(previous);
  });

  const row = (target: Setting | 'account', el: HTMLElement, autofocus = false) =>
    focusable(el, {
      autofocus,
      onFocus: () => setShown(() => target),
      onSelect: enter,
      onArrow: (d) => d === 'right' && (enter(), true),
    });

  const Row = (props: { setting: Setting }): JSX.Element => (
    <div class="setting" classList={{ on: inside() && shown() === props.setting }} ref={(el) => row(props.setting, el)}>
      <span>{props.setting.label}</span>
      <b>
        <Show when={props.setting.swatch}>{(swatch) => <i class="swatch" style={{ background: swatch()() }} />}</Show>
        {props.setting.value()}
      </b>
    </div>
  );

  // New options whenever the row or its value changes, so that the focus
  // lands on the selected one.
  const choices = createMemo(() => {
    const s = shown();
    if (s === 'account') return [];
    const selected = s.selected();
    return s.options().map((o) => ({ ...o, selected: o.value === selected }));
  });
  const choose = (value: unknown) => {
    const s = shown();
    leave();
    if (s !== 'account') s.onChoose(value);
  };

  return (
    <div class="settings">
      <div class="screen-bg" />
      <TopNav />
      <div class="settings-list">
        <h1>Settings</h1>
        <h2>Account</h2>
        <div
          class="setting account"
          classList={{ on: inside() && shown() === 'account' }}
          ref={(el) => row('account', el, true)}
        >
          <span>
            <Avatar class="small" />
            {session.user?.title}
          </span>
        </div>
        <Show when={session.servers.length > 1}>
          <Row setting={SERVER} />
        </Show>
        <Show when={session.multiUser}>
          <Row setting={AUTO_SIGN_IN} />
        </Show>
        <h2>Playback</h2>
        <For each={PLAYBACK}>{(s) => <Row setting={s} />}</For>
        <h2>Appearance</h2>
        <Row setting={ACCENT} />
        <p class="settings-version">
          {PRODUCT} {VERSION}
        </p>
      </div>
      <div class="settings-choices" classList={{ inside: inside() }}>
        <Show
          when={shown() !== 'account' && (shown() as Setting)}
          fallback={
            <div class="settings-account">
              <Avatar class="large" />
              <h3>{session.user?.title}</h3>
              <p>{session.serverName}</p>
              <p class="dim">{currentServer().uri}</p>
              <div class="row-buttons">
                <div
                  class="btn"
                  ref={(el) =>
                    focusable(el, {
                      scope: CHOICES,
                      onSelect: () => changeUser(),
                      onArrow: (d) => d === 'left' && (leave(), true),
                    })
                  }
                >
                  Switch user
                </div>
                <div class="btn" ref={(el) => focusable(el, { scope: CHOICES, onSelect: () => signOut() })}>
                  Sign out
                </div>
              </div>
            </div>
          }
        >
          {(s) => (
            <>
              <h3>{s().label}</h3>
              <For each={choices()}>
                {(o) => (
                  <div
                    class="option"
                    classList={{ selected: o.selected }}
                    ref={(el) =>
                      focusable(el, {
                        scope: CHOICES,
                        autofocus: o.selected,
                        onFocus: () => el.scrollIntoView({ block: 'nearest' }),
                        onSelect: () => choose(o.value),
                        onArrow: (d) => d === 'left' && (leave(), true),
                      })
                    }
                  >
                    <Show when={o.swatch}>
                      <span class="swatch" style={{ background: o.swatch }} />
                    </Show>
                    {o.label}
                  </div>
                )}
              </For>
            </>
          )}
        </Show>
      </div>
      <Show when={inside()}>
        <BackTo leave={leave} />
      </Show>
    </div>
  );
}
