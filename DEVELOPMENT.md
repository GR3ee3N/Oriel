# Developing Oriel

Oriel is a Kodi add-on (`script.oriel.oriel`) built on the
[Oriel framework](https://github.com/GR3ee3N/oriel-framework). Kodi plays Plex
media through the framework's proxy. WPE WebKit renders the TypeScript/Solid
interface over Kodi's video; Vite builds the page. WebKit comes from
[Oriel WebKit](https://github.com/GR3ee3N/oriel-webkit).

## Layout

```
addon/          the Kodi add-on
  addon.xml     metadata; tools/build.sh fills in the versions
  default.py    the app: the framework's VideoApp
  resources/    icon, fanart and mark.png (the start window's mark)
web/            the page
  src/plex/     the Plex API: sign-in, servers, library, images
  src/player/   playback: tracks, transcodes, timeline, Skip intro, Up next
  src/ui/       screens and components
build/          what the build uses
  versions.env  VERSION and FRAMEWORK_VERSION
tools/          the commands below
```

## Setup

You need Linux or macOS with Bash, Python 3.11 or newer, rsync, ShellCheck
and a Node.js version allowed by `web/package.json`.
Working on a box needs a CoreELEC 22 box you can reach as root over
SSH; releasing needs the GitHub CLI (`gh`).

```sh
(cd web && npm ci)
export BOX=root@coreelec.local
```

`npm ci` installs `@oriel/web` from the framework's GitHub release given in
`web/package.json`; `web/.npmrc` allows that URL dependency.

The box needs Oriel WebKit and the Oriel framework first. Deploy them from
checkouts of those repositories (`tools/deploy.sh` in each). The
framework's deploy also installs its box tools in `/storage/oriel/tools/box`,
which `tools/deploy.sh` here uses.

## Working on the box

- `tools/deploy.sh` builds Oriel and installs it on `$BOX`, waiting for Kodi
  to register and enable it, including on retries. A running Oriel keeps its
  old code until it is opened again.
- `tools/dev.sh on` makes Oriel on the box load the page from Vite's dev
  server on your computer, with hot reload on the TV, and turns on WebKit's
  remote inspector at `http://<box>:9226`. Run `npm run dev` in `web/`
  first. `tools/dev.sh off` goes back to the built page. Both take effect
  the next time Oriel opens. `DEV_HOST` overrides the address the box
  connects to.

The logs are in `/storage/.kodi/userdata/addon_data/script.oriel.oriel/`
on the box: `addon.log` for the add-on and the framework, `shell.log` for
WebKit with the page's console. They start over each time Oriel opens.
The framework's `fbgrab.py` saves what Oriel shows as a PNG:

```sh
ssh "$BOX" python3 /storage/oriel/tools/box/fbgrab.py /dev/fb1 > oriel.png
```

## Working without a box

`tools/desktop.py` stands in for the add-on's API on your computer, so the
page runs in a desktop browser. Run it, and `npm run dev` in `web/` in a
second terminal, then open `http://localhost:5173/` at 1920×1080 (the
browser's device mode).
Arrows, Enter and Escape are the remote. Signing in, browsing, art and
settings work against your Plex servers; nothing plays, and commands meant
for Kodi are only printed. The settings, tokens included, are kept in
`.cache/desktop-store.json`.

## Building

```sh
tools/check.sh            # shell checks, Python tests, TypeScript and Vitest
tools/build.sh            # the add-on in .cache/runtime/script.oriel.oriel
```

The build checks that `web/package.json` installs `FRAMEWORK_VERSION`'s
`@oriel/web`, installs locked dependencies, bundles the page, and copies
`addon/` with the versions filled in, the page in `resources/web`,
`LICENSE.txt` and `THIRD-PARTY-NOTICES.txt`. `build/notices.py` writes the
notices for the npm packages the page ships. Building does not run tests or
typechecking; run `tools/check.sh` before submitting a change. Both commands
work without Git metadata.

For individual tests, run `python3 -m unittest tests.test_package -v` or
`cd web && npm test`.
Playback, remote input and overlays still need device QA.

## Versions

`build/versions.env` holds `VERSION`, Oriel's version, and
`FRAMEWORK_VERSION`, the oldest framework release Oriel works with. Raise
the framework version only when Oriel needs something newer, and install
that release's `@oriel/web` with it:

```sh
(cd web && npm install https://github.com/GR3ee3N/oriel-framework/releases/download/v<version>/oriel-web-<version>.tgz)
```

## Releasing

Bump `VERSION`, set the news in `addon/addon.xml`, and commit. Then, from a
clean working tree, with `gh` signed in to an account that can publish
releases:

```sh
tools/release.sh
```

It checks and builds a snapshot of the committed source, packages and
validates the zip, Kodi index, art and checksums, then tags `v<version>` and
uploads a draft GitHub release with the news as the release notes.
The files are in `.cache/release/files`; `.cache/release/COMMIT` records their
source.

## Art

`tools/make-art.py` draws the icon, the fanart, `mark.png` and the page's
`web/src/ui/mark.svg` from one definition of the mark. Run it after changing
the mark. The framework shows `mark.png` in its start
window until the page's first frame, and the splash draws the SVG at the
same place, so the start looks like one picture.
