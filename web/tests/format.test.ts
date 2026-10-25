import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import { ageRating, clean, duration, hubTitle, tileSubtitle, versionLabel } from '../src/plex/format';
import type { Metadata } from '../src/plex/types';

const item = (m: Partial<Metadata>): Metadata => ({ ratingKey: '1', key: '/1', type: 'movie', title: 'A', ...m });

describe('t', () => {
  it('fills placeholders and picks plural forms', () => {
    expect(t('count.seasons', { n: 1 })).toBe('1 season');
    expect(t('count.seasons', { n: 3 })).toBe('3 seasons');
    expect(t('error.server', { server: 'media-server' })).toBe("Can't reach media-server");
  });
});

describe('tileSubtitle', () => {
  it('shows remaining time on started episodes and the title otherwise', () => {
    const ep = { type: 'episode', parentIndex: 1, index: 3, title: 'Gewalt', duration: 44 * 60000 };
    expect(tileSubtitle(item({ ...ep, viewOffset: 25 * 60000 }), true)).toBe('S1 · E3 · 19 min left');
    expect(tileSubtitle(item(ep))).toBe('S1 · E3 · Gewalt');
  });

  it('shows year with remaining time or duration for movies', () => {
    expect(tileSubtitle(item({ year: 1999, duration: 98 * 60000, viewOffset: 6 * 60000 }))).toBe('1999 · 1 h 32 min left');
    expect(tileSubtitle(item({ year: 2003, duration: 108 * 60000 }))).toBe('2003 · 1 h 48 min');
  });
});

describe('duration', () => {
  it('drops zero minutes from whole hours', () => {
    expect(duration(60 * 60000)).toBe('1 h');
    expect(duration(98 * 60000)).toBe('1 h 38 min');
    expect(duration(44 * 60000)).toBe('44 min');
  });
});

describe('ageRating', () => {
  it('names the German rating system and drops other prefixes', () => {
    expect(ageRating('de/12')).toBe('FSK 12');
    expect(ageRating('PG-13')).toBe('PG-13');
    expect(ageRating(undefined)).toBe('');
  });
});

describe('hubTitle', () => {
  it('uses Oriel titles for known hubs and the server title for the rest', () => {
    expect(hubTitle({ hubIdentifier: 'home.ondeck', title: 'On Deck' })).toBe('Up Next');
    expect(hubTitle({ hubIdentifier: 'custom.collection.3.1.1', title: 'Popular on Netflix' })).toBe('Popular on Netflix');
  });
});

describe('clean', () => {
  it('drops emoji variation selectors and invisible marks', () => {
    expect(clean('Love ❤️​ ')).toBe('Love ❤');
  });
});

describe('versionLabel', () => {
  it('names resolution and dynamic range, with codec, bitrate, container and size as detail', () => {
    const media = {
      id: 1,
      videoResolution: '4k',
      videoCodec: 'hevc',
      bitrate: 44426,
      container: 'mkv',
      Part: [{ id: 1, key: '/p', size: 52_100_000_000, Stream: [{ id: 1, streamType: 1 as const, DOVIPresent: true }] }],
    };
    expect(versionLabel(media)).toEqual({ label: '4K · Dolby Vision', detail: 'HEVC · 44 Mbps · MKV · 52.1 GB' });
  });
});
