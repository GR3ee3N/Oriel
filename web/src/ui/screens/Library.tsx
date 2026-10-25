// A library: Recommended (the server's hubs for it), Library (every title,
// with sort, filters and A–Z) and Collections. View, sort and filters are
// saved per profile, server and library.

import { createEffect, createMemo, createResource, createSignal, For, Match, on, Show, Switch } from 'solid-js';
import { type Direction, focusable, focusGroup, focusOn } from '../../nav';
import { open } from '../../actions';
import { t } from '../../i18n';
import { filterValues, firstCharacters, sectionCollections, sectionHubs, sectionItems } from '../../plex/api';
import { ageRating, hubTitle } from '../../plex/format';
import { libraryState, saveLibraryState } from '../../prefs';
import type { LibraryState } from '../../store';
import { currentServer, session } from '../../session';
import { Backdrop } from '../components/Backdrop';
import { Button, Chip, Message, Tab } from '../components/Controls';
import { Grid } from '../components/Grid';
import { createHero, type Hero, HeroInfo, neighbours } from '../components/hero';
import { Panel, type PanelOption } from '../components/Panel';
import { Rail } from '../components/Rail';
import { Row } from '../components/Row';
import { Shelf } from '../components/Shelf';
import { Status } from '../components/Status';
import './library.css';

const SORTS = [
  { label: t('sort.title'), value: 'titleSort' },
  { label: t('sort.added'), value: 'addedAt:desc' },
  { label: t('sort.released'), value: 'originallyAvailableAt:desc' },
  { label: t('sort.rating'), value: 'audienceRating:desc' },
  { label: t('sort.watched'), value: 'lastViewedAt:desc' },
  { label: t('sort.duration'), value: 'duration:desc' },
];

interface Field {
  id: string;
  label: string;
  /** Fixed values; otherwise loaded from the server. */
  values?: { key: string; title: string }[];
  movieOnly?: boolean;
}

const FIELDS: Field[] = [
  { id: 'genre', label: t('filter.genre') },
  { id: 'decade', label: t('filter.year') },
  { id: 'resolution', label: t('filter.resolution'), movieOnly: true },
  { id: 'hdr', label: t('filter.hdr'), values: [{ key: '1', title: t('filter.hdrOnly') }], movieOnly: true },
  { id: 'contentRating', label: t('filter.contentRating') },
];

export function Library(props: { section: string; title: string; type?: string }) {
  const type = () => props.type ?? session.sections.find((s) => s.key === props.section)?.type ?? 'movie';
  const stateKey = `${session.user?.uuid}/${session.serverId}/${props.section}`;
  const [state, setState] = createSignal(libraryState(stateKey));
  const update = (patch: Partial<LibraryState>) => {
    const next = { ...state(), ...patch };
    setState(next);
    saveLibraryState(stateKey, next);
  };
  const [collectionCount] = createResource(
    () => props.section,
    (section) => sectionCollections(currentServer(), section, { start: 0, size: 0 }).then((mc) => mc.totalSize ?? mc.size ?? 0),
  );
  const hero = createHero();
  const view = () => state().view;

  return (
    <div class="library">
      <Show when={view() === 'recommended'} fallback={<div class="screen-bg" />}>
        <Backdrop art={hero.art()} colors={hero.colors()} />
      </Show>
      <Rail />
      <Status />
      <header class="page-head">
        <h1>{props.title}</h1>
      </header>
      <div class="lib-tabs">
        <Tab label={t('library.recommended')} active={view() === 'recommended'} group="tabs" entry={view() === 'recommended'} onSelect={() => update({ view: 'recommended' })} />
        <Tab label={t('library.library')} active={view() === 'library'} group="tabs" entry={view() === 'library'} onSelect={() => update({ view: 'library' })} />
        <Show when={collectionCount()}>
          <Tab
            label={t('library.collections')}
            count={collectionCount()}
            active={view() === 'collections'}
            group="tabs"
            entry={view() === 'collections'}
            onSelect={() => update({ view: 'collections' })}
          />
        </Show>
      </div>
      <Switch>
        <Match when={view() === 'recommended'}>
          <Recommended section={props.section} hero={hero} />
        </Match>
        <Match when={view() === 'library'}>
          <Titles section={props.section} title={props.title} type={type()} state={state()} update={update} />
        </Match>
        <Match when={view() === 'collections'}>
          <Grid
            key={`collections/${props.section}`}
            load={(start, size) => sectionCollections(currentServer(), props.section, { start, size })}
            onSelect={open}
            empty={<Message icon="movie" title={t('library.noCollections', { library: props.title })} body={t('library.noCollectionsHint')} />}
            class="lib-grid"
          />
        </Match>
      </Switch>
    </div>
  );
}

function Recommended(props: { section: string; hero: Hero }) {
  const [hubs] = createResource(() => props.section, (section) => sectionHubs(currentServer(), section));
  // Focus stays on the tabs when this view is chosen there, so the hero
  // starts at the first row's first title.
  createEffect(
    on(
      () => hubs()?.[0]?.Metadata,
      (items) => items?.[0] && props.hero.show(items[0], neighbours(items, items[0])),
    ),
  );
  return (
    <>
      <div class="lib-hero">
        <HeroInfo hero={props.hero} />
      </div>
      <Show when={hubs.error}>
        <Message class="lib-message" icon="warning" title={t('error.server', { server: session.serverName ?? '' })} body={t('error.serverHint')} />
      </Show>
      <Shelf class="lib-shelf">
        <For each={hubs()}>
          {(hub, i) => (
            <div>
              <Row
                title={hubTitle(hub)}
                items={hub.Metadata!}
                shape={hub.type === 'episode' ? 'wide' : 'poster'}
                group={`hub-${hub.hubIdentifier}`}
                autofocus={i() === 0}
                onFocus={(item) => props.hero.show(item, neighbours(hub.Metadata!, item))}
                onSelect={open}
              />
            </div>
          )}
        </For>
      </Shelf>
    </>
  );
}

function Titles(props: { section: string; title: string; type: string; state: LibraryState; update: (p: Partial<LibraryState>) => void }) {
  const [total, setTotal] = createSignal<number>();
  const [pending, setPending] = createSignal(false);
  const [panel, setPanel] = createSignal<'sort' | 'filter' | null>(null);
  const filters = () => props.state.filters;
  const filtered = () => Object.keys(filters()).length > 0 || props.state.unwatched;
  const query = () => ({ sort: props.state.sort, unwatched: props.state.unwatched, filters: filters() });
  const gridKey = () => `${props.section}/${JSON.stringify(query())}`;

  const [all] = createResource(
    () => props.section,
    (section) => sectionItems(currentServer(), section, {}, { start: 0, size: 0 }).then((mc) => mc.totalSize ?? mc.size),
  );
  const noun = (n: number) => t(props.type === 'show' ? 'count.shows' : 'count.movies', { n });
  const count = () => {
    if (pending()) return t('library.updating');
    const n = total();
    if (n === undefined) return '';
    return filtered() && all() !== undefined ? t('count.of', { shown: n, total: noun(all()!) }) : noun(n);
  };

  // Title sort maps each A–Z character to its first item index.
  const [letters] = createResource(
    () => (props.state.sort === 'titleSort' ? ([props.section, props.state.unwatched, JSON.stringify(filters())] as const) : null),
    async ([section, unwatched]) => {
      let at = 0;
      return (await firstCharacters(currentServer(), section, unwatched, filters())).map((l) => {
        const start = at;
        at += l.size;
        return { key: l.key, start };
      });
    },
  );
  const [jump, setJump] = createSignal<{ index: number; n: number }>();
  let jumps = 0;
  const filterLabel = () => {
    const set = Object.keys(filters());
    if (!set.length) return undefined;
    return set.length === 1 ? undefined : String(set.length);
  };

  return (
    <>
      <div class="lib-toolbar">
        <Chip icon="sort" label={t('library.sort')} value={SORTS.find((s) => s.value === props.state.sort)?.label} group="tools" onSelect={() => setPanel('sort')} />
        <FilterChip filters={filters()} section={props.section} fallback={filterLabel()} onSelect={() => setPanel('filter')} />
        <Chip
          label={t('library.show')}
          value={props.state.unwatched ? t('library.unwatched') : t('library.all')}
          on={props.state.unwatched}
          group="tools"
          onSelect={() => props.update({ unwatched: !props.state.unwatched })}
        />
        <span class="lib-count">{count()}</span>
      </div>
      <Grid
        key={gridKey()}
        load={(start, size) => sectionItems(currentServer(), props.section, query(), { start, size })}
        onSelect={open}
        onTotal={setTotal}
        onPending={setPending}
        jump={jump()}
        class="lib-grid"
        empty={
          <Show
            when={filtered()}
            fallback={<Message icon="movie" title={t('library.empty', { library: props.title })} />}
          >
            <Message
              icon="filter"
              title={t('library.emptyFiltered', { library: props.title })}
            >
              <Button icon="restart" label={t('action.clearFilters')} autofocus onSelect={() => props.update({ filters: {}, unwatched: false })} />
            </Message>
          </Show>
        }
      />
      <Show when={props.state.sort === 'titleSort' && letters()?.length}>
        <Letters letters={letters()!} onJump={(index) => setJump({ index, n: ++jumps })} />
      </Show>
      <Show when={panel() === 'sort'}>
        <Panel
          title={t('library.sort')}
          options={SORTS}
          selected={props.state.sort}
          onChoose={(sort) => {
            setPanel(null);
            props.update({ sort });
          }}
          onClose={() => setPanel(null)}
        />
      </Show>
      <Show when={panel() === 'filter'}>
        <FilterPanel
          section={props.section}
          type={props.type}
          filters={filters()}
          matches={total()}
          onChange={(next) => props.update({ filters: next })}
          onClose={() => setPanel(null)}
        />
      </Show>
    </>
  );
}

/** Filter chip naming the one set filter's value, or how many are set. */
function FilterChip(props: { filters: Record<string, string>; section: string; fallback?: string; onSelect: () => void }) {
  const only = () => {
    const entries = Object.entries(props.filters);
    return entries.length === 1 ? entries[0] : undefined;
  };
  const [title] = createResource(only, ([field, key]) => valueTitle(props.section, field, key));
  return (
    <Chip
      icon="filter"
      label={t('library.filter')}
      value={only() ? (title() ?? '') : props.fallback}
      on={Object.keys(props.filters).length > 0}
      group="tools"
      onSelect={props.onSelect}
    />
  );
}

async function valueTitle(section: string, field: string, key: string): Promise<string> {
  const fixed = FIELDS.find((f) => f.id === field)?.values?.find((v) => v.key === key);
  if (fixed) return fixed.title;
  const values = await filterValues(currentServer(), section, field).catch(() => []);
  const title = values.find((v) => v.key === key)?.title ?? key;
  return field === 'contentRating' ? ageRating(title) : title;
}

/** Filter fields with their current values; choosing a field lists its values. */
function FilterPanel(props: {
  section: string;
  type: string;
  filters: Record<string, string>;
  matches?: number;
  onChange: (filters: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [field, setField] = createSignal<Field>();
  const fields = () => FIELDS.filter((f) => !f.movieOnly || props.type === 'movie');
  const [titles] = createResource(
    () => JSON.stringify(props.filters),
    async () => Object.fromEntries(await Promise.all(Object.entries(props.filters).map(async ([f, k]) => [f, await valueTitle(props.section, f, k)]))),
  );
  const [values] = createResource(field, (f) =>
    f.values ? Promise.resolve(f.values) : filterValues(currentServer(), props.section, f.id).catch(() => []),
  );
  const root = createMemo((): PanelOption<string>[] => [
    ...(Object.keys(props.filters).length ? [{ label: t('action.clearFilters'), value: '', icon: 'restart' as const }] : []),
    ...fields().map((f) => ({ label: f.label, value: f.id, current: titles()?.[f.id] ?? t('filter.any') })),
  ]);
  const hint = () => (props.matches !== undefined ? t('filter.match', { n: props.matches }) : undefined);
  // One panel steps between the field list and a field's values, so closing
  // it returns focus to the Filter chip. The field list focuses the field
  // just edited.
  const [edited, setEdited] = createSignal<string>();
  const options = (): PanelOption<string>[] => {
    const f = field();
    if (!f) return root();
    return [
      { label: f.id === 'genre' ? t('filter.anyGenre') : t('filter.any'), value: '' },
      ...(values() ?? []).map((v) => ({ label: f.id === 'contentRating' ? ageRating(v.title) : v.title, value: v.key })),
    ];
  };
  return (
    <Panel
      title={field()?.label ?? t('library.filter')}
      hint={hint()}
      options={options()}
      selected={field() ? (props.filters[field()!.id] ?? '') : undefined}
      focus={edited()}
      onChoose={(key) => {
        const f = field();
        if (!f) {
          if (!key) return props.onChange({});
          setEdited(key);
          return setField(FIELDS.find((x) => x.id === key));
        }
        const next = { ...props.filters };
        if (key) next[f.id] = key;
        else delete next[f.id];
        props.onChange(next);
        setField(undefined);
      }}
      onClose={() => (field() ? setField(undefined) : props.onClose())}
    />
  );
}

/** A–Z strip beside the grid; scrolls to keep the focused character in view. */
function Letters(props: { letters: { key: string; start: number }[]; onJump: (index: number) => void }) {
  const STEP = 44;
  const VISIBLE = 15;
  const [at, setAt] = createSignal(0);
  let box!: HTMLDivElement;
  // Up and Down stay in the strip; Left returns to the poster focused last.
  const step = (i: number, d: Direction) => {
    if (d === 'left') return focusGroup('grid');
    if (d === 'up' || d === 'down') {
      const next = box.children[d === 'up' ? i - 1 : i + 1] as HTMLElement | undefined;
      if (next) focusOn(next);
    }
    return true;
  };
  const offset = () => Math.max(0, Math.min(at() - Math.floor(VISIBLE / 2), props.letters.length - VISIBLE)) * STEP;
  return (
    <nav class="az">
      <div class="az-inner" ref={box} style={{ transform: `translateY(${-offset()}px)` }}>
        <For each={props.letters}>
          {(l, i) => (
            <div
              class="letter"
              ref={(el) =>
                focusable(el, {
                  group: 'az',
                  area: 'az',
                  onFocus: () => setAt(i()),
                  onArrow: (d) => step(i(), d),
                  onSelect: () => props.onJump(l.start),
                })
              }
            >
              {l.key}
            </div>
          )}
        </For>
      </div>
    </nav>
  );
}
