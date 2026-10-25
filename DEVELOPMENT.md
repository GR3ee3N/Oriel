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

The extra fonts, colour emoji and scripts such as Chinese, Japanese, Korean,
Thai and the Indian scripts, are too large to ship with the page, so the box
downloads them when asked. `build/fonts.py` packs the Fontsource development
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
