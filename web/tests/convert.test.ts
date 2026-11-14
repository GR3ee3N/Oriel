// Fixtures are Plex Media Server replies, trimmed to the fields convert.ts reads.
import { describe, expect, it } from 'vitest';
import { item, library, row } from '../src/plex/convert';
import type { Directory, Hub, Metadata } from '../src/plex/types';
import episodeFixture from './fixtures/plex/episode.json';
import hubFixture from './fixtures/plex/hub.json';
import movieFixture from './fixtures/plex/movie.json';
import seasonFixture from './fixtures/plex/season.json';
import showFixture from './fixtures/plex/show.json';

describe('item: episode', () => {
  const e = item(episodeFixture as Metadata);

  it('carries identity, show and season', () => {
    expect(e.id).toBe('24798');
    expect(e.kind).toBe('episode');
    expect(e.title).toBe('Willkommen in den Gassen');
    expect(e.show).toEqual({ id: '24796', title: 'Arcane' });
    expect(e.season).toEqual({ id: '24797', title: 'Season 1', number: 1 });
    expect(e.number).toBe(1);
  });

  it('splits the age rating into country and value', () => {
    expect(e.ageRating).toEqual({ country: 'de', value: '16' });
  });

  it('maps episode artwork to the show and season fields', () => {
    expect(e.art.image).toBe('/library/metadata/24798/thumb/1779936151');
    expect(e.art.backdrop).toBe('/library/metadata/24796/art/1793848889');
    expect(e.art.showImage).toBe('/library/metadata/24796/thumb/1793848889');
    expect(e.art.showBackdrop).toBe('/library/metadata/24796/art/1793848889');
    expect(e.art.seasonImage).toBe('/library/metadata/24797/thumb/1728116522');
    expect(e.art.logo).toBe('/library/metadata/24796/clearLogo/1793848889');
    expect(e.art.colors).toEqual({ topLeft: '152e4d', topRight: '62371d', bottomRight: '54499b', bottomLeft: '735926' });
  });

  it('reads intro and final credits markers', () => {
    expect(e.markers).toEqual([
      { kind: 'credits', start: 2384669, end: 2607410, final: true },
      { kind: 'intro', start: 200927, end: 265888, final: false },
    ]);
  });

  it('keeps the chapter title, times and version', () => {
    expect(e.chapters).toEqual([{ title: 'Credits', start: 2382000, end: 2607410, image: '/library/media/41761/chapterImages/1', version: '41761' }]);
  });

  it('converts an empty extras list to an empty array', () => {
    expect(e.extras).toEqual([]);
  });

  it('reads the Dolby Vision video track', () => {
    expect(e.versions?.[0].video).toEqual({ codec: 'hevc', range: 'DV', dvProfile: 8, dvCompat: 1 });
  });

  it('names audio tracks by language and marks the selected one', () => {
    expect(e.versions?.[0].audio).toEqual([
      { id: 279029, index: 1, language: 'de', name: 'Deutsch', format: 'EAC3 5.1', title: 'E-AC3 5.1 @ 640 kbps', codec: 'eac3', channels: '5.1', atmos: false, dtsx: false, selected: false },
      { id: 279030, index: 2, language: 'en', name: 'English', format: 'EAC3 5.1', title: 'E-AC3 5.1 @ 640 kbps', codec: 'eac3', channels: '5.1', atmos: false, dtsx: false, selected: true },
    ]);
  });

  it('separates embedded PGS subtitles from sidecar SRT files', () => {
    const subs = e.versions?.[0].subtitles ?? [];
    const pgs = subs.filter((s) => s.codec === 'pgs');
    expect(pgs).toHaveLength(3);
    expect(pgs[0]).toEqual({ id: 279031, index: 3, language: 'de', name: 'Deutsch Forced', title: 'Forced PGS', codec: 'pgs', forced: true, hearingImpaired: false, selected: false });
    expect(subs.find((s) => s.id === 279033)?.selected).toBe(true);
  });

  it('marks seek previews available from the part index flag', () => {
    expect(e.versions?.[0].thumbs).toBe(true);
  });

  it('keeps the part that plays the version', () => {
    expect(e.versions?.[0].file).toEqual({ id: expect.stringMatching(/^\d+$/), path: expect.stringMatching(/^\/library\/parts\/\d+\//) });
  });

  it('names cast with their role and photo', () => {
    expect(e.cast?.[0]).toEqual({ id: '59659', name: 'Hailee Steinfeld', role: 'Vi (voice)', photo: 'https://metadata-static.plex.tv/e/people/e5c1c85874ab52b9941e478215df857e.jpg' });
  });
});

describe('item: movie', () => {
  const m = item(movieFixture as Metadata);

  it('treats a Dolby Vision track with an HDR10+ layer as Dolby Vision', () => {
    expect(m.versions?.[0].video?.range).toBe('DV');
  });

  it('keeps an age rating with no country as the bare value', () => {
    expect(m.ageRating).toEqual({ value: 'R' });
  });

  it('has no episode or season fields', () => {
    expect(m.show).toBeUndefined();
    expect(m.season).toBeUndefined();
  });

  it('converts the trailer extra and keeps its own versions', () => {
    expect(m.extras).toHaveLength(1);
    expect(m.extras?.[0].kind).toBe('clip');
    expect(m.extras?.[0].versions).toHaveLength(3);
  });

  it('drops an empty clearLogo list to a missing logo', () => {
    expect(m.art.logo).toBeUndefined();
  });

  it('names Japanese audio by its own language, not a generic title', () => {
    const jp = m.versions?.[0].audio?.find((a) => a.language === 'ja');
    expect(jp?.name).toBe('日本語');
  });
});

describe('item: show', () => {
  const s = item(showFixture as Metadata);

  it('counts seasons separately from episodes watched', () => {
    expect(s.count).toBe(2);
    expect(s.episodes).toEqual({ total: 18, watched: 6 });
  });

  it("converts OnDeck's single object into one next item", () => {
    expect(s.next?.id).toBe('29079');
    expect(s.next?.kind).toBe('episode');
    expect(s.next?.position).toBe(148000);
  });
});

describe('item: season', () => {
  const s = item(seasonFixture as Metadata);

  it('carries the show title and the season number', () => {
    expect(s.show).toEqual({ id: '24796', title: 'Arcane' });
    expect(s.number).toBe(1);
  });

  it("leaves the show's year out when the reply has none", () => {
    expect(s.showYear).toBeUndefined();
  });
});

describe('row', () => {
  it('keeps the hub identifier as the row id for translated titles', () => {
    const r = row(hubFixture as unknown as Hub);
    expect(r.id).toBe('home.continue');
    expect(r.items).toHaveLength(1);
  });

  it('leaves out the id of a person Plex gives none for', () => {
    const r = row(hubFixture as unknown as Hub);
    expect(r.items[0].directors).toEqual(['Christopher Chulack']);
    expect(r.items[0].cast?.[0]).toEqual({ name: 'Luke Grimes' });
  });

  it('reads a summary stream with no per-track detail from the media audio codec', () => {
    const r = row(hubFixture as unknown as Hub);
    expect(r.items[0].versions?.[0].sound).toEqual({ codec: 'eac3', channels: '5.1', atmos: false, dtsx: false });
    expect(r.items[0].versions?.[0].audio).toBeUndefined();
  });
});

describe('library', () => {
  it('keeps movie and show libraries and drops other kinds', () => {
    expect(library({ key: '1', type: 'movie', title: 'Movies' } as Directory)).toEqual({ id: '1', title: 'Movies', kind: 'movie' });
    expect(library({ key: '2', type: 'artist', title: 'Music' } as Directory)).toBeUndefined();
  });
});
