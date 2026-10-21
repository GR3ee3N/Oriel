<div align="center">

<img src="addon/resources/icon.png" alt="Oriel" width="128">

# Oriel

**A Plex client for CoreELEC 22 on Amlogic.**

</div>

## Status

> [!WARNING]
> **Oriel is highly experimental.** It is a personal project, tested on only
> a few boxes, and it relies on CoreELEC and Kodi internals that are outside its control.
> Any update to those can break it, and it could stop working at any time.
> Use it at your own risk.

No support is provided.

## Requirements

- An Amlogic box with a Mali GPU running **CoreELEC 22** (Kodi 22, 64-bit).
  Tested on a Ugoos AM9 Pro (S905X5M) and an AM6B+ (S922X).

## Installation

1. In Kodi, turn on Settings → System → Add-ons → **Unknown sources**.
2. Settings → File manager → **Add source**: enter
   `https://gr3ee3n.github.io/oriel-repository/` and name it **Oriel**.
3. Add-ons → **Install from zip file** → Oriel →
   `repository.oriel.zip`.
4. Add-ons → **Install from repository** → Oriel repository → Video add-ons →
   **Oriel** → Install. Kodi fetches what Oriel needs with it.
5. Open **Oriel** from your video add-ons. The first start takes a few
   seconds to unpack; then sign in with the code it shows.

See [DEVELOPMENT.md](DEVELOPMENT.md) for working on Oriel.
