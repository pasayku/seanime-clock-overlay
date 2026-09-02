# Clock Overlay for Seanime

A small [Seanime](https://github.com/5rahim/seanime) **plugin** 
that draws a clock chip — current time, and optionally the
projected "Ends at" finish time — directly into Seanime's built-in player
(the "native" Denshi desktop player and the online-streaming web player),
styled to sit next to the player's own elapsed/duration readout.

Like the rest of the control bar, the chip fades in while you're moving the
mouse or interacting with playback, and fades out again after a few seconds
of inactivity — it doesn't just sit on screen permanently. Toggle it on/off,
switch between 12h/24h format, show/hide seconds, and show/hide "Ends at"
from a tray icon in Seanime's top bar. No external player (MPV/VLC/MPC-HC)
is touched — this only draws on top of Seanime's own player.

## How it works

Seanime plugins run in a sandboxed JS/TS runtime and expose a `$ui.register`
UI context with an API surface documented at
[seanime.gitbook.io/seanime-extensions](https://seanime.gitbook.io/seanime-extensions/plugins/introduction).

This plugin:

1. Listens for `video-loaded` / `video-can-play` events on `ctx.videoCore`
   (the API that drives Seanime's built-in player) to know when playback
   starts, and `video-terminated` / `video-ended` to know when to clean up.
2. Finds the player's own `<video>` element via `ctx.dom`, walks up to its
   parent container, and appends a small `<div>` chip into it (Seanime's
   VideoCore also mounts a hidden `<video>` used to generate seek-preview
   thumbnails, so candidates are filtered to the first one that isn't
   `display: none`).
3. Every second, updates the chip's text and fades it in/out with a CSS
   opacity transition based on recent activity — mouse movement, clicks,
   key presses, scroll, or play/pause/seek — using the same kind of
   idle timeout a player's own control bar uses to auto-hide.
4. Removes the chip and event listeners on session end.
5. Exposes four toggles (enabled, 24h format, seconds, "Ends at") through a
   tray popover, persisted with `ctx.settings` (backed by `$storage`).

See [`seanime-clock-overlay.ts`](./seanime-clock-overlay.ts) for the full
source — it's around 300 lines, with the reasoning for each design decision
in the comments.

### A note on how sturdy this is

Seanime doesn't expose a plugin API for "insert a widget into the control
bar", and its player UI is plain Tailwind utility classes with no stable
selector to hook into. This plugin works around that by anchoring to the
`<video>` element itself (about as stable a selector as HTML5 offers) and
absolutely-positioning the chip inside its parent — but the exact pixel
position (`CHIP_POSITION_CSS` in the source, currently bottom-left) is a
best-effort guess, not something confirmed against a live install. If it
overlaps something or doesn't show up in your version of Seanime, open your
browser devtools on the player and adjust `CHIP_BASE_CSS` / `VIDEO_SELECTOR`
at the top of the file.

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

## Notes / limitations

- "Ends at" is `now + (duration − currentTime)`, so if you pause partway
  through, it keeps sliding forward with the wall clock rather than
  freezing — i.e. it always answers "if I kept watching from here, when
  would I finish", the same convention most podcast/video apps use.
- The idle timeout (3s by default) is our own approximation of the
  player's hide delay, not something read directly from Seanime — mouse
  movement, clicks, key presses, scrolling, and play/pause/seek all count
  as activity and reset it.
- This targets Seanime's **built-in** player only. It intentionally does
  not hook into external players (MPV/VLC/MPC-HC), which use a separate
  API (`ctx.mpv` / `ctx.playback`).
- See "A note on how sturdy this is" above for the DOM-placement caveat.

## License

MIT — see [LICENSE](./LICENSE).
