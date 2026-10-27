# Developing Oriel

Oriel is a Kodi add-on (`script.oriel.oriel`) built on the
[Oriel framework](https://github.com/GR3ee3N/oriel-framework). Kodi plays
media from Plex through the framework's proxy. WPE WebKit, supplied by
[Oriel WebKit](https://github.com/GR3ee3N/oriel-webkit), renders the
TypeScript/Solid interface over Kodi's video. Vite builds the page.

## Layout

```
addon/          Kodi add-on
  addon.xml     metadata and version placeholders
  default.py    VideoApp subclass and entry point
  fonts.py      download of the optional extra fonts
  resources/    icon, fanart and startup mark
web/            web interface
  src/i18n/     interface text, placeholders and plural forms
  src/nav/      remote navigation: focus, focus scopes and Back handlers
  src/plex/     Plex API: sign-in, servers, libraries and images
  src/player/   playback, tracks, transcoding and episode prompts
  src/ui/       screens and components
build/          packaging, license notices, font package and version settings
  versions.env  VERSION and FRAMEWORK_VERSION
tools/          build, deployment and development scripts
```

## Setup

Use Linux or macOS with Bash, Python 3.11 or newer, rsync, ShellCheck and a
Node.js version supported by `web/package.json`. Device testing requires
root SSH access to a CoreELEC 22 box. Releases require the GitHub CLI (`gh`).

```sh
(cd web && npm ci)
export BOX=root@coreelec.local
```

`npm ci` installs `@oriel/web` from the framework release specified in
`web/package.json`. `web/.npmrc` permits this URL dependency.

Before deploying Oriel, install Oriel WebKit, Oriel display and the Oriel
framework on the box. Each repository has a `tools/deploy.sh` script. The
framework's script also installs `/storage/oriel/tools/box`, which Oriel's
deployment script requires.

## Device development

`tools/deploy.sh` builds Oriel and installs it on `$BOX`. It waits for Kodi
to register and enable the add-on, including when retrying an installation.
Exit and reopen Oriel to load the installed code.

For hot reload on the TV, run `npm run dev` in `web/`, then
`tools/dev.sh on`. Oriel will load the page from your computer's Vite
server. WebKit's remote inspector is available at `http://<box>:9226`.
Set `DEV_HOST` if the box needs a different address for your computer.
`tools/dev.sh off` restores the bundled page. Both commands take effect
when Oriel next opens.

Logs are in `/storage/.kodi/userdata/addon_data/script.oriel.oriel/`:

- `addon.log`: add-on and framework messages.
- `shell.log`: WebKit output and the page's console.

Both logs are overwritten each time Oriel opens.

Development pages log `focus: <label>` in `shell.log` after focus moves.
Installed builds omit these lines; use screenshots to check focus there.

To capture Oriel's interface, set a screenshot folder in Kodi under
**System → Logging**, then run:

```sh
ssh "$BOX" kodi-send --action=TakeScreenshot
```

The video layer appears black in screenshots. With HDR or Dolby Vision
playback, the captured interface can also differ from what the TV shows;
check the TV directly.

## Browser development

Run `tools/desktop.py` and, in a second terminal, run `npm run dev` in
`web/`. Open `http://localhost:5173/` and set the browser's device viewport
to 1920×1080. Arrows, Enter and Escape act as remote keys.

Sign-in, browsing, artwork and settings use your Plex servers. Playback
is simulated: the player state advances so you can test the OSD, pause,
seek and end of playback, but no media plays. The server logs command
names. Settings, including Plex tokens, are stored in
`.cache/desktop-store.json`. The optional fonts download from a package built
from `web/node_modules` into `.cache/desktop-files`.

## Interface code

Root pages use `ui/components/Rail.tsx` for Search, Home, Watchlist,
libraries, playlists & Settings. The rail has its own focus scope. Left at
the page's edge or Back opens it; Right returns to the page. Panels &
dialogs also have separate scopes. `src/nav/` owns focus movement & Back
handlers; `@oriel/web` supplies remote key names & the add-on connection.

`plex/playqueue.ts` creates Plex play queues & loads windows of their
entries. `player/queue.ts` joins those windows by `playQueueItemID`, so a
title can appear more than once. `player/playback.ts` controls the playing
entry, Up Next & timeline reports. The strip below the OSD controls shows
chapters for the selected media version & the play queue.

Interface text lives in `src/i18n/en.ts`. Use `t()` with named placeholders;
plural entries use `one` & `other`, selected by `n`. English is the only
interface language. Another language needs a matching table, its selection
in `i18n/index.ts`, a matching plural rule & the Plex request language.
Fonts for Plex metadata in other scripts are a separate download.

Spoiler protection is saved per Plex Home profile. `ui/spoilers.ts`
checks whether an episode is unwatched or explicitly revealed.
`episodeTitle` and `episodeText` put "[Spoilers removed]" in place of its
title, summary and chapter names, and Plex blurs its images through
`plex/images.ts`. Use these paths when adding episode information to a
screen.

## Checks and builds

```sh
tools/check.sh
tools/build.sh
```

`tools/check.sh` runs ShellCheck, Python tests, TypeScript checking and
Vitest. Run it before submitting a change. For individual test suites, use
`python3 -m unittest tests.test_package -v` or run `npm test` in `web/`.
Playback, remote input and overlays also require device testing.

`tools/build.sh` checks that `web/package.json` installs the `@oriel/web`
release specified by `FRAMEWORK_VERSION`, installs locked dependencies and
bundles the page. It stages the add-on in
`.cache/runtime/script.oriel.oriel`, fills in version placeholders, and
includes the page in `resources/web`, `LICENSE.txt` and
`THIRD-PARTY-NOTICES.txt`. `build/notices.py` collects the notices for npm
packages shipped with the page.

The optional font package adds colour emoji & text in Chinese, Japanese,
Korean, Thai & Indian scripts. The box downloads it when asked.
`build/fonts.py` packs the Fontsource development
dependencies it lists into `.cache/runtime/oriel-fonts-<hash>.zip` and writes
`resources/fonts.json`, which gives the ZIP's address in the `v<version>`
release, its size, its SHA-256 and the scripts it adds. Add a script by
adding its package to `web/package.json` and to `PACKAGES` in
`build/fonts.py`.

The build does not run tests or TypeScript checking. Both scripts work
without Git metadata.

## Versions

`build/versions.env` defines `VERSION`, Oriel's version, and
`FRAMEWORK_VERSION`, the minimum required framework version. Raise
`FRAMEWORK_VERSION` when Oriel requires a newer framework, and install the
matching `@oriel/web` release:

```sh
(cd web && npm install https://github.com/GR3ee3N/oriel-framework/releases/download/v<version>/oriel-web-<version>.tgz)
```

## Benchmarks

`tools/bench.sh` measures Oriel and its stack on `$BOX` and copies the
report into `.cache/bench/<time>`:

```sh
tools/bench.sh --label "new rail"
tools/bench.sh compare .cache/bench/<base> .cache/bench/<new>
```

To measure one thing while working on it, name its cases; `tools/bench.sh
--list` prints them:

```sh
tools/bench.sh --case row-right --case scroll --repeat 2 --warmup 0
```

With dev mode on, `--dev-page` measures the page from Vite. Vite serves
unbundled modules, so its startup times run longer than the installed
page's; compare a Vite run with another Vite run.

`tools/bench.sh compare` exits with status 3 when a measure got worse. If
the connection to the box drops, the run carries on there; `tools/bench.sh
fetch` copies its report once it's done, and `tools/bench.sh stop` ends it.

It runs the framework's stack suite, then the scenario in `tools/bench.json`:
Home's rows, a details page, the rail and the first library's rows. Oriel
must open as the Plex Home profile Test, or the run stops. A full run opens
Oriel 12 times and takes about 20 minutes. Options such as `--repeat 3` or
`--suite stack` pass through to `bench.py run`; the framework README
describes the suites and the report.

Compare reports from the same display mode. The scenario plays against the
Test profile's live library, so its Home rows change as the library does.

## Releases

Bump `VERSION`, write release notes in the `<news>` element of
`addon/addon.xml`, and commit. From a clean working tree, with `gh`
authenticated to an account that can publish releases, run:

```sh
tools/release.sh
```

The script checks and builds a snapshot of the committed source. It
packages and validates the add-on ZIP, Kodi index, artwork and checksums,
then tags `v<version>` and uploads a draft GitHub release, including the font
ZIP. The `<news>` text becomes the release notes.

Release files are in `.cache/release/files`.
`.cache/release/COMMIT` records the source commit.

## Artwork

`tools/make-art.py` generates the icon, fanart, startup `mark.png` and
`web/src/ui/mark.svg` from one shape definition. Run it after changing the
mark and commit the generated files.

Oriel display shows `mark.png` until the page draws its first frame. The
page's splash screen draws the SVG at the same position and size to keep
the mark in place during startup.
