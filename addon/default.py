"""Oriel's Plex client: the framework's VideoApp. The page (resources/web)
sets the Plex server as the media source, with the token as a header."""
from oriel import run
from oriel.video import VideoApp


class Oriel(VideoApp):
    own_screensaver = True


run(Oriel)
