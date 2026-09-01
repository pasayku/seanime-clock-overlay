# Clock Overlay for Seanime

A small [Seanime](https://github.com/5rahim/seanime) **plugin** (not a
standalone app) that shows a real-time clock overlaid on Seanime's built-in
player — the "native" Denshi desktop player and the online-streaming web
player — while a video is playing.

It refreshes once a second and can be toggled on/off, switched between
12h/24h format, and configured to show/hide seconds, all from a tray icon
in Seanime's top bar. No external player (MPV/VLC/MPC-HC) is touched — this
only draws on top of Seanime's own player via its `videoCore` API.

<p align="center"><i>tray icon → Enabled / 24-hour format / Show seconds</i></p>

## How it works

Seanime plugins run in a sandboxed JS/TS runtime and expose a `$ui.register`
UI context with an API surface documented at
[seanime.gitbook.io/seanime-extensions](https://seanime.gitbook.io/seanime-extensions/plugins/introduction).

This plugin:

1. Listens for `video-loaded` / `video-can-play` events on `ctx.videoCore`
   (the API that drives Seanime's built-in player) to know when playback
   starts.
2. Starts a `ctx.setInterval` loop that calls
   `ctx.videoCore.showMessage(text, durationMs)` once a second — this is
   the same on-screen-display Seanime itself uses for things like "Skipped
   intro" messages — with a duration slightly longer than the refresh
   interval so it doesn't flicker.
3. Stops the loop on `video-terminated` / `video-ended`, or automatically
   if the player disconnects.
4. Exposes three toggles (enabled, 24h format, seconds) through a tray
   popover, persisted with `ctx.settings` (backed by `$storage`).

See [`seanime-clock-overlay.ts`](./seanime-clock-overlay.ts) for the full
source — it's under 150 lines.

## Install (as a user)

1. In Seanime, go to **Settings → Extensions** and add an external plugin
   by URL, pointing it at this repo's manifest:
   ```
   https://raw.githubusercontent.com/pasayku/seanime-clock-overlay/main/seanime-clock-overlay.json
   ```
   (If your Seanime version's UI for this differs, check the
   [extensions docs](https://seanime.gitbook.io/seanime-extensions/plugins/write-test-share)
   for how to add a plugin from a URL.)
2. Grant the requested permissions when prompted:
   - `playback` — needed to call `videoCore` and draw the clock on the
     player.
   - `storage` — needed to remember your toggle choices across restarts.
3. Click the clock tray icon to configure it.

## Develop locally

1. Clone this repo.
2. (Optional, for editor autocomplete only) run:
   ```bash
   ./scripts/get-types.sh
   ```
   This downloads Seanime's `plugin.d.ts` / `app.d.ts` / `system.d.ts` /
   `core.d.ts` into `types/`, referenced by the triple-slash comments at
   the top of `seanime-clock-overlay.ts`. They're not needed at runtime.
3. Copy `seanime-clock-overlay.json` into the `extensions` folder inside
   your [Seanime data directory](https://seanime.rahim.app/docs/config#data-directory),
   and edit it locally so it points at your checkout and reloads instantly:
   ```jsonc
   {
     // ...
     "payloadURI": "/absolute/path/to/seanime-clock-overlay.ts",
     "isDevelopment": true
   }
   ```
4. Launch Seanime (the web-app build is the most convenient for testing),
   play something, and open the tray icon. With `isDevelopment: true` you
   can reload the plugin after edits without restarting Seanime.

## Publish your own copy

1. Push this repo to your own GitHub account.
2. In `seanime-clock-overlay.json`, replace `pasayku` (and
   `pasayku`) in `manifestURI`, `payloadURI`, `website`, and `author` with
   your own, and remove any `isDevelopment` field you added for local
   testing.
3. Share the raw `manifestURI` link — that's the URL people add in
   **Settings → Extensions**.

## Notes / limitations

- The clock is drawn using the player's on-screen-display, the same
  mechanism Seanime uses for transient messages. It refreshes every
  second rather than being a truly continuous element, since that's what
  the `videoCore` API exposes — in practice this is indistinguishable
  from continuous at a 1-second refresh rate.
- This targets Seanime's **built-in** player only. It intentionally does
  not hook into external players (MPV/VLC/MPC-HC), which use a separate
  API (`ctx.mpv` / `ctx.playback`).

## License

MIT — see [LICENSE](./LICENSE).
