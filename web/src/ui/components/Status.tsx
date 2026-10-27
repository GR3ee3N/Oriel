import { createSignal, onCleanup } from 'solid-js';
import { type Direction, focusOn } from '../../nav';
import { t } from '../../i18n';
import { hhmm } from '../../plex/format';
import { goHome } from '../../router';
import { Button } from './Controls';
import './rail.css';

// Share one minute-aligned clock across mounted pages.
const [now, setNow] = createSignal(new Date());
let clockTimer: ReturnType<typeof setTimeout> | undefined;
let clockUsers = 0;
function tick() {
  setNow(new Date());
  clockTimer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
}

export function useClock() {
  if (clockUsers++ === 0) tick();
  onCleanup(() => {
    if (--clockUsers === 0) clearTimeout(clockTimer);
  });
  return () => hhmm(now());
}

/** Clock at the top right of browse and detail pages. */
export function Status() {
  const clock = useClock();
  return (
    <div class="status">
      <b>{clock()}</b>
    </div>
  );
}

/** Home button beside the clock at the top right of detail pages. Down returns to the
 * page's main button, or its first item on collection and cast pages,
 * rather than the nearest thing below the corner. */
export function DetailHead() {
  let box!: HTMLDivElement;
  const down = (d: Direction) => {
    if (d !== 'down') return false;
    const page = box.parentElement;
    const target = page?.querySelector<HTMLElement>('.details-info .actions .button, .detail-actions .button, .grid .tile');
    if (target) focusOn(target);
    return true;
  };
  return (
    <div class="detail-head" ref={box}>
      <Button class="small" icon="home" label={t('action.home')} group="head" onSelect={goHome} onArrow={down} />
      <Status />
    </div>
  );
}
