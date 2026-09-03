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
 * player's own elapsed/duration readout. Fades in with player activity
 * (mouse movement, play/pause, seeking) and fades out again after a few
 * seconds idle, mirroring the player's own control-bar auto-hide.
 *
 * This does NOT target external players (MPV/VLC/MPC-HC) or Seanime
 * Denshi's separate libmpv-based MpvCore player (a different rendering
 * path with no DOM <video> element to attach to) -- only VideoCore, the
 * HTML5-based built-in player.
 *
 * --- Debugging -------------------------------------------------------------
 * The tray popover (click the clock icon) always shows a live status line,
 * and every step also logs to the browser devtools console prefixed with
 * "[clock-overlay]". If you don't see the tray icon at all, the plugin
 * failed to load entirely (permissions, manifest, or a runtime error) --
 * check the console for a "[clock-overlay]" line or an uncaught exception
 * near plugin load time.
 *
 * --- How the chip is placed -------------------------------------------------
 * Seanime doesn't expose a plugin API for "insert a widget into the control
 * bar", so this finds the player's own <video> element via the DOM API and
 * appends the chip as a sibling inside its parent, absolutely positioned in
 * the bottom-left corner of the player (VideoCore also mounts a small,
 * offscreen <video> for seek-preview thumbnails, so candidates are
 * filtered down to the first one that isn't `display: none`). If that
 * lookup fails for any reason, the chip automatically falls back to
 * `ctx.videoCore.showMessage()` -- the same on-screen-display Seanime uses
 * for messages like "Skipped intro" -- so you still get a working clock
 * even if the DOM placement doesn't pan out on your setup.
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
        // Duration (ms) for each fallback OSD message -- kept a bit longer
        // than REFRESH_MS so it doesn't flicker between refreshes.
        const OSD_DURATION_MS = REFRESH_MS + 400
        // How long (ms) of no activity before the chip fades out -- mirrors
        // a typical player's own control-bar auto-hide delay.
        const IDLE_HIDE_MS = 3000
        // DOM events that count as "activity" and bring the chip back.
        const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel"]
        // Selector used to find the player's <video> element. "video" is
        // deliberately broad (Seanime exposes no stable class name here).
        const VIDEO_SELECTOR = "video"
        // Marker id so we can find our own chip again later if needed.
        const CHIP_ID = "seanime-clock-overlay-chip"
        // Inline CSS for the chip. Adjust the position if it overlaps
        // something in your version of Seanime.
        const CHIP_BASE_CSS = "position:absolute;left:16px;bottom:72px;"
            + "z-index:40;padding:5px 10px;border-radius:6px;"
            + "background:rgba(0,0,0,0.65);color:#fff;"
            + "font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;"
            + "letter-spacing:0.02em;line-height:1.3;pointer-events:none;"
            + "white-space:nowrap;opacity:0;transition:opacity 200ms ease;"

        function log(...args: any[]) {
            console.log("[clock-overlay]", ...args)
        }

        // ---------------------------------------------------------------
        // State (drives the tray UI)
        // ---------------------------------------------------------------
        const sessionActive = ctx.state(false) // a video is loaded
        const visible = ctx.state(false) // chip/overlay is currently shown
        const statusMessage = ctx.state("Waiting for playback…")

        let cancelInterval: (() => void) | null = null
        let lastActivityAt = 0
        let activityUnsubscribers: Array<() => void> = []
        let chipEl: $ui.DOMElement | null = null
        let chipMountFailed = false // true once we give up on DOM placement for this session

        // -- Formatting -------------------------------------------------------

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

        function buildChipParts(): { time: string, endsAt: string | null } {
            const now = new Date()
            const time = formatTime(now, settings.get("showSeconds", true))
            let endsAt: string | null = null
            if (settings.get("showEndsAt", true)) {
                const remaining = getRemainingSeconds()
                if (remaining !== null) {
                    endsAt = formatTime(new Date(now.getTime() + remaining * 1000), false)
                }
            }
            return { time, endsAt }
        }

        // Two-tone markup for the DOM chip: clock at full brightness,
        // "Ends at" dimmer, like a secondary label next to a primary one.
        function buildChipHtml(): string {
            const parts = buildChipParts()
            let html = `<span>${parts.time}</span>`
            if (parts.endsAt) {
                html += `<span style="opacity:0.65;margin-left:8px;font-weight:400;">`
                    + `Ends at ${parts.endsAt}</span>`
            }
            return html
        }

        // Plain-text equivalent for the OSD fallback (showMessage takes text).
        function buildChipText(): string {
            const parts = buildChipParts()
            return parts.endsAt ? `${parts.time}  ·  Ends at ${parts.endsAt}` : parts.time
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
                const unsub = activityUnsubscribers.pop()
                if (unsub) unsub()
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
            log("looking for a <video> element…")
            return ctx.dom.query(VIDEO_SELECTOR)
                .then((videos) => {
                    log("found", videos.length, "<video> element(s)")
                    return firstVisibleVideo(videos, 0)
                })
                .then((video) => {
                    if (!video) {
                        log("no visible <video> element -- falling back to the OSD overlay")
                        chipMountFailed = true
                        return null
                    }
                    return video.getParent()
                })
                .then((container) => {
                    if (!container) {
                        if (!chipMountFailed) log("found the video but not its parent container -- falling back to the OSD overlay")
                        chipMountFailed = true
                        return
                    }
                    return ctx.dom.createElement("div").then((el) => {
                        el.setAttribute("id", CHIP_ID)
                        el.setCssText(CHIP_BASE_CSS)
                        el.setInnerHTML(buildChipHtml())
                        container.append(el)
                        chipEl = el
                        attachActivityTracking(container)
                        log("chip mounted")
                    })
                })
                .catch((err: any) => {
                    log("error mounting chip, falling back to the OSD overlay:", err)
                    chipMountFailed = true
                })
        }

        // -- Overlay loop -----------------------------------------------------

        function tick() {
            if (!settings.get("enabled", true)) {
                statusMessage.set("Disabled")
                return
            }
            if (!ctx.videoCore.getCurrentClientId()) {
                endSession()
                return
            }

            const idle = isIdle()

            if (chipEl) {
                chipEl.setInnerHTML(buildChipHtml())
                chipEl.setStyle("opacity", idle ? "0" : "1")
                visible.set(!idle)
                statusMessage.set(idle ? "Hidden — move the mouse to bring it back" : "Showing on the player")
            } else if (chipMountFailed) {
                if (!idle) ctx.videoCore.showMessage(buildChipText(), OSD_DURATION_MS)
                visible.set(!idle)
                statusMessage.set(idle
                    ? "Hidden — move the mouse to bring it back"
                    : "Showing via fallback overlay (see console)")
            } else {
                statusMessage.set("Looking for the player…")
            }
        }

        function beginSession() {
            if (cancelInterval) return
            if (!settings.get("enabled", true)) return

            log("session starting")
            chipMountFailed = false
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
            chipMountFailed = false
            sessionActive.set(false)
            visible.set(false)
            statusMessage.set("Waiting for playback…")
        }

        // ---------------------------------------------------------------
        // Tray UI -- set up FIRST, before anything that could throw, so the
        // icon (and its status line) always appears even if the videoCore
        // hookup below fails for some reason.
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
            return tray.stack([
                tray.text("Clock Overlay", { style: { fontWeight: "600" } }),
                tray.text(statusMessage.get(), { style: { opacity: "0.7", fontSize: "12px" } }),
                tray.switch("Enabled", { fieldRef: enabledRef }),
                tray.switch("24-hour format", { fieldRef: use24HourRef }),
                tray.switch("Show seconds", { fieldRef: showSecondsRef }),
                tray.switch("Show \"Ends at\"", { fieldRef: showEndsAtRef }),
            ])
        })

        // ---------------------------------------------------------------
        // Hook into the built-in player (VideoCore)
        // ---------------------------------------------------------------
        try {
            // Covers the case where a video is already loaded when the
            // plugin (re)loads -- e.g. after a hot-reload during dev.
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

            log("videoCore hooks registered")
        } catch (err) {
            log("failed to hook into videoCore:", err)
            statusMessage.set("Error: " + String(err))
        }
    })
}
