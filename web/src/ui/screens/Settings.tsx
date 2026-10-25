// App settings only; display mode, HDR and audio passthrough are configured
// in Kodi. Focus on a category shows its settings; Right enters them and
// Left returns. A setting opens a panel of choices.

import { createSignal, For, type JSX, Show } from 'solid-js';
import { focusable, focusOn } from '../../nav';
import { send, state } from '../../bridge';
import { t } from '../../i18n';
import { PRODUCT, VERSION } from '../../plex/client';
import { QUALITIES, quality } from '../../player/quality';
import { ACCENTS, accent, hidesUnwatched, prefs, setHidesUnwatched, setPref } from '../../prefs';
import { changeUser, chooseServer, currentServer, serverOptions, session, signOut } from '../../session';
import { Dialog } from '../components/Dialog';
import { Panel, type PanelOption } from '../components/Panel';
import { Rail } from '../components/Rail';
import { Status } from '../components/Status';
import './library.css';
import './settings.css';

interface Choice<T> {
  label: string;
  hint?: string;
  value: () => string;
  swatch?: () => string;
  options: () => PanelOption<T>[];
  selected: () => T;
  onChoose: (value: T) => void;
}

interface Action {
  label: string;
  hint?: string;
  value?: () => string;
  onSelect?: () => void;
}

type Setting = ({ kind: 'choice' } & Choice<unknown>) | ({ kind: 'action' } & Action);

const choice = <T,>(c: Choice<T>): Setting => ({ kind: 'choice', ...(c as Choice<unknown>) });
const action = (a: Action): Setting => ({ kind: 'action', ...a });

const onOff = (label: string, hint: string, get: () => boolean, set: (on: boolean) => void, names = [t('settings.off'), t('settings.on')]) =>
  choice({
    label,
    hint,
    value: () => (get() ? names[1] : names[0]),
    options: () => [
      { label: names[0], value: false },
      { label: names[1], value: true },
    ],
    selected: get,
    onChoose: set,
  });

const qualitySetting = (label: string, key: 'qualityLocal' | 'qualityRemote') =>
  choice({
    label,
    hint: t('settings.qualityHint'),
    value: () => quality(prefs[key]).label,
    options: () => QUALITIES.map((q) => ({ label: q.label, value: q.kbps })),
    selected: () => prefs[key],
    onChoose: (kbps) => setPref(key, kbps),
  });

export function Settings() {
  const [category, setCategory] = createSignal(0);
  const [open, setOpen] = createSignal<Setting>();
  const [leaving, setLeaving] = createSignal(false);

  const categories = (): { label: string; settings: Setting[] }[] => [
    {
      label: t('settings.playback'),
      settings: [
        qualitySetting(t('settings.qualityLocal'), 'qualityLocal'),
        qualitySetting(t('settings.qualityRemote'), 'qualityRemote'),
        onOff(t('settings.skipIntros'), '', () => prefs.autoSkipIntro, (on) => setPref('autoSkipIntro', on), [t('settings.manually'), t('settings.automatically')]),
        onOff(t('settings.skipCredits'), '', () => prefs.autoSkipCredits, (on) => setPref('autoSkipCredits', on), [t('settings.withUpNext'), t('settings.automatically')]),
      ],
    },
    {
      label: t('settings.appearance'),
      settings: [
        choice({
          label: t('settings.accent'),
          value: () => accent(prefs.accent).label,
          swatch: () => accent(prefs.accent).color,
          options: () => ACCENTS.map((a) => ({ label: a.label, value: a.id, swatch: a.color })),
          selected: () => prefs.accent,
          onChoose: (id) => setPref('accent', id),
        }),
        onOff(t('settings.spoilers'), t('settings.spoilersHint'), () => hidesUnwatched(session.user?.uuid), (on) => session.user && setHidesUnwatched(session.user.uuid, on)),
        onOff(t('settings.motion'), t('settings.motionHint'), () => prefs.reduceMotion, (on) => setPref('reduceMotion', on)),
      ],
    },
    {
      label: t('settings.account'),
      settings: [
        action({ label: t('settings.profile'), value: () => session.user?.title ?? '', onSelect: session.multiUser ? () => void changeUser() : undefined }),
        ...(session.servers.length > 1
          ? [
              choice({
                label: t('settings.server'),
                value: () => session.serverName ?? '',
                options: serverOptions,
                selected: () => session.serverId ?? '',
                onChoose: (id) => void chooseServer(id),
              }),
            ]
          : []),
        ...(session.multiUser
          ? [onOff(t('settings.autoSignIn'), t('settings.autoSignInHint'), () => prefs.autoSignIn, (on) => setPref('autoSignIn', on))]
          : []),
        action({ label: t('action.signOut'), onSelect: () => setLeaving(true) }),
      ],
    },
    {
      label: t('settings.about'),
      settings: [
        action({ label: t('settings.version'), value: () => `${PRODUCT} ${VERSION}` }),
        action({ label: t('settings.server'), hint: currentServer().uri, value: () => session.serverName ?? '' }),
        // Shared framework setting: changing it reloads the page and affects all Oriel apps.
        choice({
          label: t('settings.rendering'),
          hint: t('settings.renderingHint'),
          value: () => (state.cpuRendering ? 'CPU' : 'GPU'),
          options: () => [
            { label: 'GPU', value: false },
            { label: 'CPU', value: true },
          ],
          selected: () => state.cpuRendering,
          onChoose: (on) => send({ cmd: 'cpu-rendering', on }),
        }),
      ],
    },
  ];

  // Left from any setting returns to its category, which can sit higher
  // than a long list's lower rows.
  const categoryEls: HTMLElement[] = [];
  const select = (s: Setting) => {
    if (s.kind === 'choice') setOpen(() => s);
    else s.onSelect?.();
  };

  const Row = (props: { setting: Setting; first: boolean }): JSX.Element => (
    <div
      class="setting"
      ref={(el) =>
        focusable(el, {
          group: 'settings',
          entry: props.first,
          onSelect: () => select(props.setting),
          onArrow: (d) => d === 'left' && (focusOn(categoryEls[category()]), true),
        })
      }
    >
      <span class="setting-label">
        {props.setting.label}
        <Show when={props.setting.hint}>
          <small>{props.setting.hint}</small>
        </Show>
      </span>
      <b>
        <Show when={props.setting.kind === 'choice' && props.setting.swatch}>
          {(swatch) => <i class="swatch" style={{ background: swatch()() }} />}
        </Show>
        {props.setting.value?.()}
      </b>
    </div>
  );

  return (
    <div class="settings">
      <div class="screen-bg" />
      <Rail />
      <Status />
      <header class="page-head">
        <h1>{t('nav.settings')}</h1>
      </header>
      <div class="settings-categories">
        <For each={categories()}>
          {(c, i) => (
            <div
              class="setting-category"
              classList={{ current: i() === category() }}
              ref={(el) => {
                categoryEls[i()] = el;
                focusable(el, { group: 'categories', autofocus: i() === 0, onFocus: () => setCategory(i()) });
              }}
            >
              {c.label}
            </div>
          )}
        </For>
      </div>
      <div class="settings-list">
        <Show when={categories()[category()]} keyed>
          {(c) => <For each={c.settings}>{(s, i) => <Row setting={s} first={i() === 0} />}</For>}
        </Show>
      </div>
      <Show when={open()} keyed>
        {(s) =>
          s.kind === 'choice' && (
            <Panel
              title={s.label}
              hint={s.hint}
              options={s.options()}
              selected={s.selected()}
              onChoose={(v) => {
                setOpen(undefined);
                s.onChoose(v);
              }}
              onClose={() => setOpen(undefined)}
            />
          )
        }
      </Show>
      <Show when={leaving()}>
        <Dialog
          title={t('action.signOut')}
          choices={[
            { label: t('action.cancel'), onSelect: () => setLeaving(false) },
            { label: t('action.signOut'), onSelect: () => void signOut() },
          ]}
          onCancel={() => setLeaving(false)}
        />
      </Show>
    </div>
  );
}
