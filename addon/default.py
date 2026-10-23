"""Run the Plex client with the framework's VideoApp.

The page in resources/web sets the Plex media source and token header.
"""
from oriel import run
from oriel.video import VideoApp


class Oriel(VideoApp):
    own_screensaver = True


run(Oriel)
