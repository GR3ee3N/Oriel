"""Run the app with the framework's VideoApp: Oriel for Plex, or Dormer
for Jellyfin, by the page in resources/web. Dormer's address screen lists
the Jellyfin servers that discovery.py finds on the network.

The page sets the media server as Kodi's media source, with the header that
authorises its requests.
"""
import os

import xbmc
import xbmcaddon

from discovery import Discovery
from fonts import Fonts
from oriel import CommandError, command, run
from oriel.video import VideoApp


class Oriel(VideoApp):
    own_screensaver = True

    def __init__(self):
        super().__init__()
        addon = xbmcaddon.Addon()
        name = addon.getAddonInfo("name")
        package = os.path.join(addon.getAddonInfo("path"), "resources", "fonts.json")
        self.fonts = Fonts(package, self.files_dir, lambda: self.events.put(("fonts",)),
                           lambda message: xbmc.log(f"{name}: {message}", xbmc.LOGINFO))
        self.discovery = Discovery(lambda: self.events.put(("discovery",)),
                                   lambda message: xbmc.log(f"{name}: {message}", xbmc.LOGWARNING))

    def state(self):
        return {**super().state(), "fonts": self.fonts.state(), "discovery": self.discovery.state()}

    def on_event(self, kind, args):
        if kind in ("fonts", "discovery"):
            self.publish()
        else:
            super().on_event(kind, args)

    @command("fonts-install")
    def install_fonts(self):
        if not self.fonts.install():
            raise CommandError("the fonts are downloading or this build has none")
        self.publish()

    @command("discover")
    def discover(self):
        self.discovery.start()
        self.publish()

    @command("fonts-remove")
    def remove_fonts(self):
        if not self.fonts.remove():
            raise CommandError("the fonts are downloading")
        self.publish()


run(Oriel)
