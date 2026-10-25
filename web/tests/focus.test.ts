import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, test } from 'vitest';
import { focusable, focused, focusGroup, focusOn, move, type Options, setScope } from '../src/nav/focus';

// Count connection checks, one per element each time a scope is scanned.
let checks = 0;
const element = () => {
  const classes = new Set<string>();
  return {
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    get isConnected() {
      checks++;
      return true;
    },
    textContent: '',
  } as unknown as HTMLElement;
};

let dispose: () => void;
afterEach(() => {
  dispose();
  setScope('main', true);
});

test('a restore queued for a scope that is no longer active leaves the focus alone', async () => {
  const background = element();
  const dialog = element();
  createRoot((cleanup) => {
    dispose = cleanup;
    focusable(background);
    focusable(dialog, { scope: 'dialog' });
    setScope('dialog');
  });
  await Promise.resolve();
  expect(focused()).toBe(dialog);
});

test('disposing a scope removes its registered elements', async () => {
  const button = element();
  createRoot((cleanup) => {
    dispose = cleanup;
    focusable(button);
  });
  await Promise.resolve();
  expect(focused()).toBe(button);
  dispose();
  await Promise.resolve();
  expect(focused()).toBeNull();
});

test('mounting many elements at once restores focus once', async () => {
  const buttons = Array.from({ length: 500 }, element);
  checks = 0;
  createRoot((cleanup) => {
    dispose = cleanup;
    for (const button of buttons) focusable(button);
  });
  await Promise.resolve();
  expect(focused()).toBe(buttons[0]);
  expect(checks).toBeLessThan(2 * buttons.length);
});

test('an autofocus element that mounts later takes focus', async () => {
  const first = element();
  const later = element();
  createRoot((cleanup) => {
    dispose = cleanup;
    focusable(first);
  });
  await Promise.resolve();
  expect(focused()).toBe(first);
  const disposeFirst = dispose;
  createRoot((cleanup) => {
    dispose = () => {
      cleanup();
      disposeFirst();
    };
    focusable(later, { autofocus: true });
  });
  await Promise.resolve();
  expect(focused()).toBe(later);
});

// An element at a fixed place on a 1920×1080 page; `at` moves it.
const box = (left: number, top: number, width: number, height: number) => {
  const el = element() as HTMLElement & { at: (left: number) => void };
  let x = left;
  el.getBoundingClientRect = () =>
    ({ left: x, right: x + width, top, bottom: top + height, width, height }) as DOMRect;
  el.at = (l) => (x = l);
  return el;
};

function page(els: [HTMLElement, Options?][]) {
  createRoot((cleanup) => {
    dispose = cleanup;
    for (const [el, options] of els) focusable(el, options);
  });
}

test('down goes to the next row, even when its elements sit far to the left', () => {
  const watchlist = box(784, 511, 222, 72);
  const audio = box(120, 603, 341, 52);
  const subtitles = box(475, 603, 216, 52);
  const below = box(864, 826, 150, 224);
  page([[watchlist], [audio], [subtitles], [below]]);
  focusOn(watchlist);
  move('down');
  expect(focused()).toBe(subtitles);
});

test('up and down keep to the column they started in', () => {
  const watchlist = box(784, 511, 222, 72);
  const subtitles = box(475, 603, 216, 52);
  const left = box(492, 826, 150, 224);
  const under = box(864, 826, 150, 224);
  page([[watchlist], [subtitles], [left], [under]]);
  focusOn(watchlist);
  move('down');
  move('down');
  expect(focused()).toBe(under);
  move('up');
  move('up');
  expect(focused()).toBe(watchlist);
});

test('a wide key returns up to the key it was reached from', () => {
  const nine = box(577, 662, 79, 64);
  const zero = box(666, 662, 78, 64);
  const clear = box(577, 736, 167, 64);
  page([[nine], [zero], [clear]]);
  focusOn(zero);
  move('down');
  expect(focused()).toBe(clear);
  move('up');
  expect(focused()).toBe(zero);
});

test('a move sideways starts a new column', () => {
  const sort = box(224, 240, 182, 52);
  const show = box(567, 240, 142, 52);
  const first = box(224, 332, 220, 405);
  const last = box(1444, 332, 220, 405);
  page([[sort, { group: 'tools' }], [show, { group: 'tools' }], [first, { group: 'grid' }], [last, { group: 'grid' }]]);
  focusOn(last);
  move('up');
  expect(focused()).toBe(show);
  move('left');
  move('down');
  expect(focused()).toBe(first);
});

test('the column resets when the focused element scrolls away', () => {
  const button = box(1400, 100, 200, 60);
  const tile = box(1400, 300, 220, 330);
  const other = box(372, 300, 220, 330);
  const next = box(120, 700, 220, 330);
  const under = box(1400, 700, 220, 330);
  page([[button], [tile], [other], [next], [under]]);
  focusOn(button);
  move('down');
  expect(focused()).toBe(tile);
  // The row scrolls the focused tile sideways.
  tile.at(372);
  other.at(120);
  move('down');
  expect(focused()).toBe(next);
});

test('up and down enter a row at its first visible tile, not the nearest column', () => {
  const above = box(1400, 100, 220, 330);
  const scrolled = box(-132, 500, 220, 330);
  const first = box(120, 500, 220, 330);
  const nearest = box(1380, 500, 220, 330);
  const row = (entry: boolean): Options => ({ group: 'row', entry });
  page([[above, { group: 'above' }], [scrolled, row(false)], [first, row(true)], [nearest, row(false)]]);
  focusOn(above);
  move('down');
  expect(focused()).toBe(first);
});

test('up and down stay in their area, left and right leave it', () => {
  const key = box(560, 292, 77, 64);
  const lowKey = box(560, 662, 77, 64);
  const movie = box(780, 240, 220, 400);
  const show = box(780, 740, 220, 400);
  const keys: Options = { area: 'keyboard' };
  page([[key, keys], [lowKey, keys], [movie], [show]]);
  focusOn(movie);
  move('down');
  expect(focused()).toBe(show);
  move('up');
  expect(focused()).toBe(movie);
  move('left');
  expect(focused()).toBe(key);
  move('down');
  expect(focused()).toBe(lowKey);
});

test('a group enters at its entry element as it changes', () => {
  const button = box(800, 100, 200, 60);
  const one = box(120, 300, 150, 52);
  const two = box(300, 300, 150, 52);
  const [active, setActive] = createSignal(2);
  const tab = (n: number): Options => ({
    group: 'seasons',
    get entry() {
      return active() === n;
    },
  });
  page([[button], [one, tab(1)], [two, tab(2)]]);
  setActive(1);
  focusOn(button);
  move('down');
  expect(focused()).toBe(one);
});

test('a strip beside a grid returns to the grid at its entry tile', () => {
  const tile = (left: number, top: number, entry: boolean): [HTMLElement, Options] => [box(left, top, 220, 330), { group: 'grid', entry }];
  const tiles = [tile(120, 300, false), tile(380, 300, false), tile(120, 690, true)];
  const letter = box(1800, 300, 44, 44);
  page([...tiles, [letter, { group: 'az', area: 'az' }]]);
  focusOn(letter);
  expect(focusGroup('grid')).toBe(true);
  expect(focused()).toBe(tiles[2][0]);
  expect(focusGroup('none')).toBe(false);
});
