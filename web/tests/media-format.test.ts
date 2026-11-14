import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import type { Item, Version } from '../src/media/model';
import { ageRating, airDate, badges, clean, duration, hubTitle, isWatched, seasonName, tileSubtitle, versionLabel } from '../src/media/format';

const item = (m: Partial<Item>): Item => ({ id: '1', kind: 'movie', title: 'A', art: {}, ...m });

describe('t', () => {
  it('fills placeholders and picks plural forms', () => {
    expect(t('count.seasons', { n: 1 })).toBe('1 season');
    expect(t('count.seasons', { n: 3 })).toBe('3 seasons');
    expect(t('error.server', { server: 'media-server' })).toBe("Can't reach media-server");
  });
});

describe('tileSubtitle', () => {
  it('shows remaining time on started episodes and the title otherwise', () => {
    const ep = { kind: 'episode' as const, season: { id: '1', number: 1 }, number: 3, title: 'Gewalt', duration: 44 * 60000 };
    expect(tileSubtitle(item({ ...ep, position: 25 * 60000 }), true)).toBe('S1 · E3 · 19 min left');
    expect(tileSubtitle(item(ep))).toBe('S1 · E3 · Gewalt');
  });

  it('shows year with remaining time or duration for movies', () => {
    expect(tileSubtitle(item({ year: 1999, duration: 98 * 60000, position: 6 * 60000 }))).toBe('1999 · 1 h 32 min left');
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
    expect(ageRating({ country: 'de', value: '12' })).toBe('FSK 12');
    expect(ageRating({ value: 'PG-13' })).toBe('PG-13');
    expect(ageRating(undefined)).toBe('');
  });
});

describe('hubTitle', () => {
  it('uses Oriel titles for known rows and the server title for the rest', () => {
    expect(hubTitle({ id: 'home.ondeck', title: 'On Deck' })).toBe('Up Next');
    expect(hubTitle({ id: 'custom.collection.3.1.1', title: 'Popular on Netflix' })).toBe('Popular on Netflix');
  });
});

describe('clean', () => {
  it('drops emoji variation selectors and invisible marks', () => {
    expect(clean('Love ❤️​ ')).toBe('Love ❤');
  });
});

describe('versionLabel', () => {
  it('names resolution and dynamic range, with codec, bitrate, container and size as detail', () => {
    const version: Version = {
      id: '1',
      resolution: '4k',
      videoCodec: 'hevc',
      bitrate: 44426,
      container: 'mkv',
      size: 52_100_000_000,
      thumbs: false,
      video: { range: 'DV' },
    };
    expect(versionLabel(version)).toEqual({ label: '4K · Dolby Vision', detail: 'HEVC · 44 Mbps · MKV · 52.1 GB' });
  });

  it('names the Dolby Vision profile, with the sub-profile for 8 and 10', () => {
    const dv = (dvProfile: number, dvCompat: number): Item =>
      item({ versions: [{ id: '1', resolution: '4k', thumbs: false, video: { range: 'DV', dvProfile, dvCompat } }] });
    expect(badges(dv(5, 0))).toEqual(['4K', 'Dolby Vision P5']);
    expect(badges(dv(7, 6))).toEqual(['4K', 'Dolby Vision P7']);
    expect(badges(dv(8, 1))).toEqual(['4K', 'Dolby Vision P8.1']);
    expect(badges(dv(8, 6))).toEqual(['4K', 'Dolby Vision P8.6']);
    expect(badges(dv(10, 1))).toEqual(['4K', 'Dolby Vision P10.1']);
  });

  it('names audio by codec and channels, with Atmos & DTS:X named apart from the codec', () => {
    const v = (audio: NonNullable<Version['audio']>[number]): Item => item({ versions: [{ id: '1', thumbs: false, audio: [audio] }] });
    expect(badges(v({ id: 1, codec: 'truehd', channels: '7.1', atmos: true, dtsx: false, selected: true }))).toEqual(['TrueHD Atmos 7.1']);
    expect(badges(v({ id: 1, codec: 'dca', channels: '5.1', atmos: false, dtsx: true, selected: true }))).toEqual(['DTS:X 5.1']);
    expect(badges(v({ id: 1, codec: 'eac3', channels: '5.1', atmos: false, dtsx: false, selected: true }))).toEqual(['DD+ 5.1']);
  });

  it('falls back to the version summary when no track list came with the reply', () => {
    const v = item({ versions: [{ id: '1', resolution: '1080', thumbs: false, sound: { codec: 'aac', channels: '2.0', atmos: false, dtsx: false } }] });
    expect(badges(v)).toEqual(['HD', 'AAC 2.0']);
  });
});

describe('isWatched', () => {
  it('marks a played movie, but not a played playlist', () => {
    expect(isWatched(item({ plays: 1 }))).toBe(true);
    expect(isWatched(item({ kind: 'playlist', plays: 1 }))).toBe(false);
  });
});

describe('airDate', () => {
  it('writes the day, short month and year', () => {
    expect(airDate('2021-11-06')).toBe('6 Nov 2021');
    expect(airDate('2024-12-31T00:00:00Z')).toBe('31 Dec 2024');
  });
  it('leaves out a missing or malformed date', () => {
    expect(airDate(undefined)).toBe('');
    expect(airDate('2021-13-01')).toBe('');
    expect(airDate('soon')).toBe('');
  });
});

describe('seasonName', () => {
  it('calls season 0 Specials', () => {
    expect(seasonName(item({ kind: 'season', number: 0, title: 'Season 0' }))).toBe('Specials');
    expect(seasonName(item({ kind: 'season', number: 2, title: 'Season 2' }))).toBe('Season 2');
  });
});
