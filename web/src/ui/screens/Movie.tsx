import { createResource, For, Show } from 'solid-js';
import { open, openPerson, play } from '../../actions';
import { dataVersion } from '../../data';
import { focusable } from '@oriel/web';
import { metadata, related } from '../../plex/api';
import { badges, clean, remaining } from '../../plex/format';
import { currentServer } from '../../session';
import { Backdrop } from '../components/Backdrop';
import { Info, logoReady, metaFor } from '../components/Info';
import { People } from '../components/People';
import { Row } from '../components/Row';
import { Shelf } from '../components/Shelf';
import { WatchedButton } from '../components/WatchedButton';
import './details.css';

/** A movie: its art, logo, facts and summary, Resume/Play and watched;
 * below, the cast and more like it. */
export function Movie(props: { ratingKey: string }) {
  const [meta] = createResource(
    () => [props.ratingKey, dataVersion()] as const,
    async ([key]) => {
      const m = await metadata(currentServer(), key);
      return m && { item: m, logo: await logoReady(m) };
    },
  );
  const [more] = createResource(() => props.ratingKey, (key) => related(currentServer(), key));

  return (
    <div class="details">
      <Backdrop art={meta()?.item.art} colors={meta()?.item.UltraBlurColors} delay={0} />
      <Show when={meta.error}>
        <p class="error details-error">Could not load this title: {String(meta.error)}</p>
      </Show>
      <Show when={meta()}>
        {(m) => (
          <>
            <div class="details-info">
              <Info
                item={m().item}
                logo={m().logo}
                meta={metaFor(m().item)}
                badges={badges(m().item)}
                summary={m().item.tagline ? `${m().item.tagline}  ${m().item.summary ?? ''}` : m().item.summary}
              >
                <p class="genres">
                  {[
                    ...(m().item.Genre ?? []).slice(0, 3).map((g) => g.tag),
                    ...(m().item.Director ?? []).slice(0, 1).map((d) => `Directed by ${d.tag}`),
                  ].join('   ·   ')}
                </p>
                <div class="actions">
                  <div
                    class="btn"
                    ref={(el) => focusable(el, { group: 'actions', autofocus: true, onSelect: () => play(m().item) })}
                  >
                    ▶ {m().item.viewOffset ? 'Resume' : 'Play'}
                    <Show when={remaining(m().item)}>
                      <span class="sub">{remaining(m().item)}</span>
                    </Show>
                  </div>
                  <Show when={m().item.viewOffset}>
                    <div class="btn" ref={(el) => focusable(el, { group: 'actions', onSelect: () => play(m().item, true) })}>
                      From the start
                    </div>
                  </Show>
                  <WatchedButton item={m().item} />
                </div>
              </Info>
            </div>
            <Shelf>
              <Show when={m().item.Role?.length}>
                <div>
                  <People
                    title="Cast"
                    people={m().item.Role!.slice(0, 20)}
                    group="cast"
                    onSelect={(p) => openPerson(m().item, p)}
                  />
                </div>
              </Show>
              <For each={more()?.slice(0, 3)}>
                {(hub) => (
                  <div>
                    <Row title={clean(hub.title)} items={hub.Metadata!} group={`related-${hub.hubIdentifier}`} onSelect={open} />
                  </div>
                )}
              </For>
            </Shelf>
          </>
        )}
      </Show>
    </div>
  );
}
