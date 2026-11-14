<div align="center">

<img src="apps/oriel/resources/icon.png" alt="Oriel" width="128">
<img src="apps/dormer/resources/icon.png" alt="Dormer" width="128">

# Oriel & Dormer

**Plex & Jellyfin clients for CoreELEC 22 on Amlogic devices.**

</div>

Two Kodi add-ons build from this repository: **Oriel** for Plex and
**Dormer** for Jellyfin 10.10 or later. They share one interface and
player. Each signs in on its own, so a box can have both installed.

Dormer has no Watchlist, and its libraries have no Collections tab or HDR
filter. Jellyfin's box sets span the whole server; Search finds them.

## Status

> [!WARNING]
> **Experimental software.** CoreELEC or Kodi updates can break it.

No support is provided. Neither app is affiliated with or endorsed by Plex
or the Jellyfin project.

## Hardware

Requires an Amlogic device with a Mali GPU running CoreELEC 22
(Kodi 22, 64-bit). Tested on:

- Ugoos AM9 Pro (S905X5M, Mali-G310)
- Ugoos AM6B+ (S922X, Mali-G52)

Other devices and CoreELEC versions have not been tested.

## Installation

1. In Kodi, enable **Settings → System → Add-ons → Unknown sources**.
2. Go to **Settings → File manager → Add source**, enter
   `https://gr3ee3n.github.io/oriel-repository/` and name it **Oriel**.
3. Go to **Add-ons → Install from zip file → Oriel** and select
   `repository.oriel.zip`.
4. Go to **Add-ons → Install from repository → Oriel repository → Video add-ons**,
   select **Oriel** or **Dormer**, then **Install**. Kodi also installs
   their dependencies.
5. Open the app from your video add-ons and wait for setup to finish.

Oriel signs in through **plex.tv/link**: open it on your phone or computer
and enter the code shown on the TV.

Dormer asks for your server's address, then shows a Quick Connect code.
Enter it under **Quick Connect** in your Jellyfin user settings; the code
signs in the user who enters it. The server's administrator has to switch
Quick Connect on in the dashboard's general settings.

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup, builds and device testing.
