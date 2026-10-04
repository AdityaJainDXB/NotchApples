# Notch apple plugins

Plugins are small scripts, in any language, that put your own information in the notch. They live in `~/Library/Application Support/Notch apple/Plugins`. Open the folder from the **Plugins** tab.

## The basics (free)

- **File name sets how often it runs:** `weather.10m.sh`, `cpu.5s.py`, `news.1h.rb` (s, m, h or d). The default is 5 minutes.
- **First line of output** is the card's headline. **Other lines** are the body.
- **Clickable lines:**
  - `text | href=https://…` opens a link.
  - `text | run=command` runs a shell command.
- **Runtime:** scripts run with a normal `PATH` (Homebrew included) and `NOTCH_APPLE=1` set. They're stopped after 10 seconds.

```zsh
#!/bin/zsh
echo "Uptime $(uptime | sed 's/.*up \([^,]*\),.*/\1/')"
echo "Disk: $(df -h /System/Volumes/Data | awk 'NR==2 {print $4}') free"
echo "Activity Monitor | run=open -a 'Activity Monitor'"
```

## SDK (Ultimate)

**Live activity beside the closed notch.** Print a line starting with `activity:`. It uses the same keys as the [Live Activities API](../README.md#live-activities-api):

```
activity: title=Build text=42% symbol=hammer.fill progress=0.42 color=34C759
```

- Quote values that contain spaces: `title="Nightly build"`.
- The activity stays for twice the plugin's interval unless the next run replaces it.
- Print `activity: end=true` to remove it.

**Home widgets.** In the **Home** tab, choose **Edit → Add widget → Plugins**. Each widget shows the plugin's headline and first lines, in small, medium or large.

**Background.** Plugins keep running while the tab is closed, so widgets and activities stay up to date. Turn this off with `defaults write com.notchapple.app plugins.background -bool false`.

## Gallery (Ultimate)

**Plugins → Gallery** lists community plugins from this repository's [plugins/](../plugins) folder. Each entry has **View source**; read it before installing.

**To share a plugin:**
1. Open a pull request that adds the script to `plugins/`.
2. Add an entry to `plugins/index.json` with `name`, `description`, `author` and `file`.

**Rules for gallery plugins:**
- Plain-text scripts only.
- No downloading and running other code.
- No sending your data anywhere without saying so in the description.
