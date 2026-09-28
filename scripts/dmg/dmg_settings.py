# dmgbuild settings for the Notch apple installer window.
# Values come in via `-D key=value` from scripts/build_dmg.sh.
import os

app = defines["app"]            # path to "Notch apple.app"
background = defines["background"]

format = "UDZO"
filesystem = "HFS+"
files = [app]
symlinks = {"Applications": "/Applications"}
hide_extensions = ["Notch apple.app"]

# 660 x 420 window, no toolbar / sidebar / status bar: just the drag target.
# Height = 420 pt background + title bar + (if the user shows it) the path bar.
window_rect = ((200, 120), (660, 472))
default_view = "icon-view"
show_toolbar = False
show_sidebar = False
show_status_bar = False
show_tab_view = False
show_pathbar = False
icon_size = 128
text_size = 13
arrange_by = None

# Positions match the frosted tiles in dmg-background.tiff (centre points).
icon_locations = {
    "Notch apple.app": (180, 200),
    "Applications": (480, 200),
}
