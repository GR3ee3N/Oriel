// Fixtures are replies for the Jellyfin Test user, trimmed to the fields
// convert.ts reads, without file paths.
import { describe, expect, it } from 'vitest';
import { corners } from '../src/jellyfin/blurhash';
import { ageRating, item } from '../src/jellyfin/convert';
import type { BaseItem } from '../src/jellyfin/types';
import episodeFixture from './fixtures/jellyfin/episode.json';
import movieFixture from './fixtures/jellyfin/movie.json';
import seasonsFixture from './fixtures/jellyfin/seasons.json';
import showFixture from './fixtures/jellyfin/show.json';

const movie = item(movieFixture as BaseItem, 'lib');
const episode = item(episodeFixture as BaseItem);
const show = item(showFixture as BaseItem);
const season = item(seasonsFixture.Items[0] as unknown as BaseItem);

describe('a movie', () => {
  it('keeps its details, rating and people', () => {
    expect(movie).toMatchObject({ kind: 'movie', title: '2 Fast 2 Furious', year: 2003, audienceRating: 6.5, ageRating: { country: 'de', value: '16' }, library: 'lib', plays: 0 });
    expect(movie.duration).toBe(6_454_865);
    expect(movie.released).toMatch(/^2003-06-0[45]$/);
    expect(movie.cast?.[0]).toMatchObject({ name: 'Paul Walker', role: "Brian O'Conner", photo: expect.stringMatching(/^[0-9a-f]+\/Primary\/[0-9a-f]+$/) });
    expect(movie.directors?.length).toBe(1);
  });

  it('reads Dolby Vision, the resolution and the file to play', () => {
    const v = movie.versions![0];
    expect(v).toMatchObject({ container: 'mkv', resolution: '4k', videoCodec: 'hevc', bitrate: 35198, thumbs: false });
    expect(v.video).toEqual({ codec: 'hevc', range: 'DV', dvProfile: 8, dvCompat: 1 });
    expect(v.file?.path).toBe(`/Videos/${movie.id}/stream?static=true&mediaSourceId=${v.id}`);
  });

  it('names DTS:X and DTS-HD MA, and selects the default tracks', () => {
    const v = movie.versions![0];
    expect(v.audio?.[0]).toEqual({ id: 1, index: 1, codec: 'dts', channels: '7.1', atmos: false, dtsx: true, dtsHd: 'ma', language: 'de', title: 'DTS:X MA 7.1', format: 'DTS 7.1', selected: true });
    expect(v.subtitles?.map((s) => [s.codec, s.forced, s.selected])).toEqual([
      ['srt', true, true],
      ['pgs', true, false],
      ['pgs', false, false],
      ['pgs', false, false],
    ]);
    expect(v.subtitles?.[3].hearingImpaired).toBe(true);
  });

  it('serves a subtitle file by its own format', () => {
    const j = structuredClone(movieFixture) as BaseItem;
    j.MediaSources![0].MediaStreams!.push({ Index: 9, Type: 'Subtitle', Codec: 'ass', Language: 'ger', IsExternal: true } as never);
    const file = item(j).versions![0].subtitles!.at(-1);
    expect(file).toMatchObject({ language: 'de', codec: 'ass', file: `/Videos/${j.Id}/${j.MediaSources![0].Id}/Subtitles/9/0/Stream.ass` });
  });

  it('takes its backdrop colours from the backdrop’s BlurHash', () => {
    expect(movie.art.colors).toEqual({ topLeft: expect.stringMatching(/^[0-9a-f]{6}$/), topRight: expect.any(String), bottomRight: expect.any(String), bottomLeft: expect.any(String) });
    expect(movie.art.logo).toMatch(/\/Logo\//);
  });
});

describe('a show', () => {
  it('counts its seasons and episodes', () => {
    expect(show).toMatchObject({ kind: 'show', title: 'Arcane', count: 2, episodes: { total: 18, watched: 0 }, ageRating: { value: 'TV-14' } });
    expect(season).toMatchObject({ kind: 'season', number: 1, show: { id: show.id, title: 'Arcane' }, episodes: { total: 9, watched: 0 } });
  });

  it('gives an episode its show, season and their images', () => {
    expect(episode).toMatchObject({ kind: 'episode', number: 1, show: { id: show.id, title: 'Arcane' }, season: { number: 1, title: 'Staffel 1' } });
    expect(episode.art.showImage).toBe(show.art.image);
    expect(episode.art.showBackdrop).toBe(show.art.backdrop);
    expect(episode.art.backdrop).toBe(show.art.backdrop);
    expect(episode.art.seasonImage).toBe(season.art.image);
    expect(episode.art.colors).toEqual(show.art.colors);
    expect(episode.chapters).toEqual([{ title: 'Credits', start: 2_382_000 }]);
  });
});

it('reads German age ratings and keeps the rest', () => {
  expect(ageRating('FSK-12')).toEqual({ country: 'de', value: '12' });
  expect(ageRating('DE-6')).toEqual({ country: 'de', value: '6' });
  expect(ageRating('PG-13')).toEqual({ value: 'PG-13' });
  expect(ageRating(undefined)).toBeUndefined();
});

it('finds the same corner colours as a full BlurHash decode', () => {
  const hash = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj';
  // The reference decoder from blurha.sh, at the corner pixels of a 64×64 image.
  const D = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
  const b83 = (s: string) => [...s].reduce((v, c) => v * 83 + D.indexOf(c), 0);
  const lin = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  const s = b83(hash[0]);
  const nx = (s % 9) + 1;
  const ny = Math.floor(s / 9) + 1;
  const max = (b83(hash[1]) + 1) / 166;
  const dc = b83(hash.slice(2, 6));
  const comps = [[lin(dc >> 16), lin((dc >> 8) & 255), lin(dc & 255)]];
  for (let i = 1; i < nx * ny; i++) {
    const v = b83(hash.slice(4 + i * 2, 6 + i * 2));
    comps.push([Math.floor(v / 361), Math.floor(v / 19) % 19, v % 19].map((q) => Math.sign(q - 9) * ((q - 9) / 9) ** 2 * max));
  }
  const pixel = (x: number, y: number) =>
    [0, 1, 2].map((k) => {
      let sum = 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) sum += comps[i + j * nx][k] * Math.cos((Math.PI * x * i) / 63) * Math.cos((Math.PI * y * j) / 63);
      const c = Math.min(1, Math.max(0, sum));
      return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
    });
  const hex = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const got = corners(hash)!;
  for (const [name, x, y] of [['topLeft', 0, 0], ['topRight', 63, 0], ['bottomRight', 63, 63], ['bottomLeft', 0, 63]] as const) {
    hex(got[name]).forEach((v, k) => expect(Math.abs(v - pixel(x, y)[k])).toBeLessThanOrEqual(1));
  }
});
