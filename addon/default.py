"""Run the Plex client with the framework's VideoApp.

The page in resources/web sets the Plex media source and token header.
"""
import os

import xbmc
import xbmcaddon

from fonts import Fonts
from oriel import CommandError, command, run
from oriel.video import VideoApp


class Oriel(VideoApp):
    own_screensaver = True

    def __init__(self):
        super().__init__()
        package = os.path.join(xbmcaddon.Addon().getAddonInfo("path"), "resources", "fonts.json")
        self.fonts = Fonts(package, self.files_dir, lambda: self.events.put(("fonts",)),
                           lambda message: xbmc.log(f"Oriel: {message}", xbmc.LOGINFO))

    def state(self):
        return {**super().state(), "fonts": self.fonts.state()}

    def on_event(self, kind, args):
        if kind == "fonts":
            self.publish()
        else:
            super().on_event(kind, args)

    @command("fonts-install")
    def install_fonts(self):
        if not self.fonts.install():
            raise CommandError("the fonts are downloading or this build has none")
        self.publish()

    @command("fonts-remove")
    def remove_fonts(self):
        if not self.fonts.remove():
            raise CommandError("the fonts are downloading")
        self.publish()


run(Oriel)
