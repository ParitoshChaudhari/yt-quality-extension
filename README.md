# YouTube Quality Selector

A small, safe Chrome/Edge/Brave extension (Manifest V3) that automatically sets
YouTube video quality — either to the **highest quality available** for every
video, or to a **default quality you pick** (e.g. 1080p), with automatic
fallback to the closest lower quality when your chosen one isn't offered.

## Features

- **Auto max quality** — always play at the best resolution the video has.
- **Custom default quality** — pick 144p up to 4K; applied automatically to
  every video you open.
- **Smart fallback** — if a video doesn't offer your chosen quality (e.g. no
  1440p available), it automatically steps down to the next best available
  quality instead of silently doing nothing.
- **Works with YouTube's single-page navigation** — re-applies automatically
  when you click to a new video without a full page reload.
- **Live status in the popup** — see the current quality and every quality
  available for the video you're watching.
- **One-click "Apply now"** — instantly force the current video to your
  chosen quality without waiting.
- **Enable/disable switch** — turn the whole thing off any time.
- **No data collection** — no analytics, no network requests, no tracking.
  Everything runs locally; the only thing stored is your quality preference
  (via `chrome.storage.sync`, so it follows you across signed-in browsers).
- **Minimal permissions** — only `storage` and access to `youtube.com`.

## Install (unpacked / developer mode)

1. Unzip this folder somewhere permanent (don't delete it after installing).
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this folder.
5. Open YouTube — the extension icon will appear in your toolbar.

## How to use

1. Click the extension icon.
2. Toggle **Enable auto quality** on.
3. Pick a **Default quality** — either "Highest available" or a specific
   resolution.
4. That's it — every video you open will automatically switch to that
   quality. Use **Apply to current video now** to force it immediately on
   the video you're currently watching.

## How it works (technical overview)

- `content.js` runs in an isolated content-script world and injects
  `inject.js` into the actual YouTube page so it can reach YouTube's
  player object (`#movie_player`), which isn't accessible from isolated
  content scripts.
- `inject.js` reads `player.getAvailableQualityLevels()` and calls
  `player.setPlaybackQuality()` / `setPlaybackQualityRange()` to apply your
  chosen quality, re-checking a few times after each video load since
  YouTube can briefly reset quality right after playback starts.
- Settings are stored with `chrome.storage.sync` and pushed to the page via
  `window.postMessage` — no cookies, page content, or personal data are
  ever read or transmitted anywhere.

## Files

```
manifest.json    Extension configuration (Manifest V3)
content.js       Bridges the extension and the YouTube page
inject.js        Talks to YouTube's player API (runs in the page)
popup.html/.css/.js   The toolbar popup UI
icons/           Extension icons
```
