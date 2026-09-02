/// <reference path="./types/plugin.d.ts" />
/// <reference path="./types/system.d.ts" />
/// <reference path="./types/app.d.ts" />
/// <reference path="./types/core.d.ts" />

/**
 * Clock Overlay for Seanime
 * ---------------------------------------------------------------------------
 * Draws a small clock chip -- current time, and optionally "Ends at" --
 * directly into Seanime's built-in player (the "native" Denshi desktop
 * player and the online-streaming web player), styled to sit alongside the
 * player's own elapsed/duration readout.
 *
 * Like the rest of the control bar ("taskbar"), the chip fades in while
 * you're moving the mouse / interacting with playback over the player, and
 * fades out again after a few seconds of inactivity -- it doesn't just sit
 * on screen permanently.
 *
 * This does NOT target external players (MPV/VLC/MPC-HC); it only draws on
 * top of Seanime's own built-in player (VideoCore).
 *
 * --- How the chip is placed ------------------------------------------------
 * Seanime doesn't expose a plugin API for "insert a widget into the control
 * bar", so this finds the player's own <video> element via the DOM API and
 * appends the chip as a sibling inside its parent, absolutely positioned in
 * the bottom-left corner of the player. VideoCore also mounts a small,
 * offscreen <video> element to generate seek-preview thumbnails
 * (see video-core-preview.ts upstream), so candidates are filtered down to
 * the first one that isn't `display: none` before picking a parent.
 *
 * Seanime's player is plain Tailwind utility classes with no stable
 * selector to hook into, so this is a best-effort placement rather than a
 * guaranteed one. If the chip ends up overlapping something in your version
 * of Seanime, tweak CHIP_POSITION_CSS and/or VIDEO_SELECTOR below -- open
 * your browser devtools on the player to find better values.
 */

function init() {
    $ui.register((ctx) => {
        // ---------------------------------------------------------------
        // Settings
        // Mirrored in $store automatically, and persisted in $storage
        // across restarts because this plugin requests the "storage"
        // permission.
        // ---------------------------------------------------------------
        const settings = ctx.settings.define("clock-overlay", {
            enabled: true,
            use24Hour: false,
            showSeconds: true,
            showEndsAt: true,
        })

        // How often (ms) the chip's text is refreshed while visible.
        const REFRESH_MS = 1000
        // How long (ms) of no activity (mouse movement, play/pause, seeking)
        // before the chip fades out -- mirrors a typical player's own
        // control-bar auto-hide delay.
        const IDLE_HIDE_MS = 3000
        // DOM events that count as "activity" and bring the chip back.
        const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel"]
        // Selector used to find the player's <video> element. "video" is
        // deliberately broad (Seanime exposes no stable class name here);
        // see the note above about filtering out hidden/offscreen ones.
        const VIDEO_SELECTOR = "video"
        // Marker id so we can find our own chip again (e.g. after Seanime
        // re-renders the player and wipes out manually-injected nodes).
        const CHIP_ID = "seanime-clock-overlay-chip"
        // Inline CSS for the chip itself. Adjust the position if it
        // overlaps something in your version of Seanime -- see the header
        // comment above.
        const CHIP_BASE_CSS = "position:absolute;left:16px;bottom:72px;"
            + "z-index:40;padding:5px 10px;border-radius:6px;"
            + "background:rgba(0,0,0,0.65);color:#fff;"
            + "font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;"
            + "letter-spacing:0.02em;line-height:1.3;pointer-events:none;"
            + "white-space:nowrap;opacity:0;transition:opacity 200ms ease;"

        // ---------------------------------------------------------------
        // State (drives the tray UI)
        // ---------------------------------------------------------------
        const sessionActive = ctx.state(false) // a video is loaded
        const visible = ctx.state(false) // chip is currently faded in

        let cancelInterval: (() => void) | null = null
        let lastActivityAt = 0
        let activityUnsubscribers: Array<() => void> = []
        let chipEl: $ui.DOMElement | null = null
        let playerContainerEl: $ui.DOMElement | null = null

        // -- Formatting -----------------------------------------------------

        function formatTime(date: Date, withSeconds: boolean): string {
            let hours = date.getHours()
            const minutes = date.getMinutes().toString().padStart(2, "0")
            const secs = date.getSeconds().toString().padStart(2, "0")

            let suffix = ""
            if (!settings.get("use24Hour", false)) {
                suffix = hours >= 12 ? " PM" : " AM"
                hours = hours % 12
                if (hours === 0) hours = 12
            }

            const hh = hours.toString().padStart(2, "0")
            const time = withSeconds ? `${hh}:${minutes}:${secs}` : `${hh}:${minutes}`
            return `${time}${suffix}`
        }

        // Seconds left in the current video, or null if unknown (nothing
        // loaded yet, or duration not reported -- e.g. some live streams).
        function getRemainingSeconds(): number | null {
            const status = ctx.videoCore.getPlaybackStatus()
            if (!status || !status.duration) return null
            const remaining = status.duration - status.currentTime
            return remaining > 0 ? remaining : 0
        }

        // Small two-tone markup: the clock at full brightness, the
        // "Ends at" projection dimmer, similar to how a secondary label
        // usually sits next to a primary readout.
        function buildChipHtml(): string {
            const now = new Date()
            let html = `<span>${formatTime(now, settings.get("showSeconds", true))}</span>`

            if (settings.get("showEndsAt", true)) {
                const remaining = getRemainingSeconds()
                if (remaining !== null) {
                    const endsAt = new Date(now.getTime() + remaining * 1000)
                    html += `<span style="opacity:0.65;margin-left:8px;font-weight:400;">`
                        + `Ends at ${formatTime(endsAt, false)}</span>`
                }
            }

            return html
        }

        // -- Activity / idle tracking ----------------------------------------

        function markActivity() {
            lastActivityAt = Date.now()
        }

        function isIdle(): boolean {
            return Date.now() - lastActivityAt > IDLE_HIDE_MS
        }

        function attachActivityTracking(target: $ui.DOMElement) {
            if (activityUnsubscribers.length > 0) return
            for (const eventName of ACTIVITY_EVENTS) {
                activityUnsubscribers.push(target.addEventListener(eventName, markActivity))
            }
        }

        function detachActivityTracking() {
            while (activityUnsubscribers.length) {
                activityUnsubscribers.pop()?.()
            }
        }

        // -- Locating and mounting the chip ----------------------------------

        // Recursively walks candidate <video> elements and returns the
        // first one that's actually rendered (skips the offscreen preview
        // video VideoCore uses for seek thumbnails).
        function firstVisibleVideo(elements: $ui.DOMElement[], index: number): Promise<$ui.DOMElement | null> {
            if (index >= elements.length) return Promise.resolve(null)
            return elements[index].getComputedStyle("display").then((display) => {
                if (display !== "none") return elements[index]
                return firstVisibleVideo(elements, index + 1)
            })
        }

        function mountChip(): Promise<void> {
            return ctx.dom.query(VIDEO_SELECTOR)
                .then((videos) => firstVisibleVideo(videos, 0))
                .then((video) => (video ? video.getParent() : null))
                .then((container) => {
                    if (!container) return
                    playerContainerEl = container
                    return ctx.dom.createElement("div").then((el) => {
                        el.setAttribute("id", CHIP_ID)
                        el.setCssText(CHIP_BASE_CSS)
                        el.setInnerHTML(buildChipHtml())
                        container.append(el)
                        chipEl = el
                        attachActivityTracking(container)
                    })
                })
                .catch(() => {
                    // If the player's DOM shape ever changes and this
                    // lookup fails, fail quietly rather than spamming
                    // errors every second -- the chip just won't appear.
                })
        }

        // -- Overlay loop -----------------------------------------------------

        function tick() {
            if (!settings.get("enabled", true)) return
            if (!ctx.videoCore.getCurrentClientId()) {
                endSession()
                return
            }
            if (!chipEl) return // still mounting

            const idle = isIdle()
            chipEl.setInnerHTML(buildChipHtml())
            chipEl.setStyle("opacity", idle ? "0" : "1")
            visible.set(!idle)
        }

        function beginSession() {
            if (cancelInterval) return
            if (!settings.get("enabled", true)) return

            markActivity() // treat session start as activity, like controls do on load
            mountChip().then(tick)
            cancelInterval = ctx.setInterval(tick, REFRESH_MS)
            sessionActive.set(true)
        }

        function endSession() {
            if (cancelInterval) {
                cancelInterval()
                cancelInterval = null
            }
            detachActivityTracking()
            if (chipEl) {
                chipEl.remove()
                chipEl = null
            }
            playerContainerEl = null
            sessionActive.set(false)
            visible.set(false)
        }

        // ---------------------------------------------------------------
        // Hook into the built-in player (VideoCore)
        // ---------------------------------------------------------------

        // Covers the case where a video is already loaded when the plugin
        // (re)loads -- e.g. after a hot-reload during development.
        if (ctx.videoCore.getPlaybackStatus()) {
            beginSession()
        }

        ctx.videoCore.addEventListener("video-loaded", () => beginSession())
        ctx.videoCore.addEventListener("video-can-play", () => beginSession())
        ctx.videoCore.addEventListener("video-terminated", () => endSession())
        ctx.videoCore.addEventListener("video-ended", () => endSession())

        // Treat play/pause/seek as activity too, so keyboard-driven
        // interactions (not just mouse movement) bring the chip back.
        ctx.videoCore.addEventListener("video-paused", () => markActivity())
        ctx.videoCore.addEventListener("video-resumed", () => markActivity())
        ctx.videoCore.addEventListener("video-seeked", () => markActivity())

        // ---------------------------------------------------------------
        // Tray UI
        // ---------------------------------------------------------------
        const tray = ctx.newTray({
            tooltipText: "Clock Overlay",
            iconUrl: "https://api.iconify.design/mdi:clock-outline.svg?color=%23ffffff",
            withContent: true,
        })

        const enabledRef = ctx.fieldRef<boolean>(settings.get("enabled", true))
        const use24HourRef = ctx.fieldRef<boolean>(settings.get("use24Hour", false))
        const showSecondsRef = ctx.fieldRef<boolean>(settings.get("showSeconds", true))
        const showEndsAtRef = ctx.fieldRef<boolean>(settings.get("showEndsAt", true))

        enabledRef.onValueChange((value) => {
            settings.set("enabled", value)
            if (value) {
                if (ctx.videoCore.getPlaybackStatus()) beginSession()
            } else {
                endSession()
            }
        })
        use24HourRef.onValueChange((value) => settings.set("use24Hour", value))
        showSecondsRef.onValueChange((value) => settings.set("showSeconds", value))
        showEndsAtRef.onValueChange((value) => settings.set("showEndsAt", value))

        tray.render(() => {
            const status = !sessionActive.get()
                ? "Waiting for playback…"
                : visible.get()
                    ? "Showing on the player"
                    : "Hidden — move the mouse to bring it back"

            return tray.stack([
                tray.text("Clock Overlay", { style: { fontWeight: "600" } }),
                tray.text(status, { style: { opacity: "0.7", fontSize: "12px" } }),
                tray.switch("Enabled", { fieldRef: enabledRef }),
                tray.switch("24-hour format", { fieldRef: use24HourRef }),
                tray.switch("Show seconds", { fieldRef: showSecondsRef }),
                tray.switch("Show \"Ends at\"", { fieldRef: showEndsAtRef }),
            ])
        })
    })
}
