<p align="center">
  <img src="https://raw.githubusercontent.com/AdityaJainDXB/NotchApples/main/docs/icon.png" width="96" alt="Notch apple icon">
</p>

<h1 align="center">Notch apple — website</h1>

<p align="center">
  The official website for <a href="https://github.com/AdityaJainDXB/NotchApples"><b>Notch apple</b></a>, the free-to-start, source-available app that turns your MacBook notch into a productivity hub.
</p>

<p align="center">
  <a href="https://virajsinghchadha.github.io/notchapples-site/"><b>🌐 Live site</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/AdityaJainDXB/NotchApples"><b>App repository</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/AdityaJainDXB/NotchApples/releases/latest"><b>Download</b></a>
</p>

---

## What's on the site

- **A live notch demo.** A MacBook mockup with a notch you can click (or open with ⌘E). It tours every module: Today, AI, Windows (the snap zones really move the demo windows), Clipboard, Focus, Tools, Mirror, World Clock, Shelf, Search, Messenger and more. The notch header has a GitHub link and the colour-coded Settings / Relaunch / Quit menu.
- **Features.** A grid of every module and add-on, with **New** and **Add-on** tags.
- **Screenshots.** A filterable gallery (Notch / Settings) of real app screenshots, taken with sample data. Click any one to enlarge it.
- **What's new.** Highlights from each release, with a working mock of the built-in update prompt.
- **Privacy, install and FAQ.** Homebrew and DMG install steps, and answers to common questions.

## How it's built

It's one self-contained `index.html`: plain HTML, CSS and a little JavaScript. There's no framework, no build step and no tracking. The only outside requests are the Geist fonts from Google Fonts, Phosphor icons from jsDelivr the QR code script and the screenshots.

The screenshots and the app icon are loaded straight from the main repo's [`docs/screenshots`](https://github.com/AdityaJainDXB/NotchApples/tree/main/docs/screenshots) folder, so when the app's README screenshots are updated, the website's gallery updates with them.

```
index.html   the whole site
README.md    this file
```

## Run it locally

```bash
git clone https://github.com/VirajSinghChadha/notchapples-site.git
cd notchapples-site
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` directly also works.

## Deploying

The site is hosted on **GitHub Pages** from the `main` branch. Every push to `main` goes live within a minute or two.

The site is served at https://virajsinghchadha.github.io/notchapples-site/ (the notch.cc.cd custom domain was removed because some networks block it as Dynamic DNS).

## Updating the site for a new release

1. Add the release to the top of the `REL` list near the bottom of `index.html` (version, date, title, bullet points, and optionally a screenshot name). The newest release with a screenshot is shown large; the rest are listed beside it.
2. If a module was added, add an item to the features list (a `<div class="fi" data-c="day|work|net|pro">` inside `#fx`, with a [Phosphor icon](https://phosphoricons.com)) and a tab to the demo notch (a `<div class="view" data-t="Name" data-i="emoji">` inside `.views`; the tab button is created automatically).
3. For a new screenshot, add it to `docs/screenshots` in the **app repo** first, then add a line to the `shots` list near the bottom of `index.html`.
4. Check it locally (above), including at phone width, then push to `main`.

## Credits

Built by [@AdityaJainDXB](https://github.com/AdityaJainDXB) and [@VirajSinghChadha](https://github.com/VirajSinghChadha). Notch apple is source-available under the Notch apple Source-Available License; see the [app repository](https://github.com/AdityaJainDXB/NotchApples) for the source code, releases and licence.
