/// <reference path="./types/plugin.d.ts" />
/// <reference path="./types/system.d.ts" />
/// <reference path="./types/app.d.ts" />
/// <reference path="./types/core.d.ts" />

/**
 * Clock Overlay for Seanime
 * ---------------------------------------------------------------------------
 * Shows a real-time (wall clock) overlay on top of Seanime's built-in
 * player -- the "native" Denshi desktop player and the online-streaming web
 * player -- using the VideoCore on-screen-display, refreshed every second
 * while a video is loaded.
 *
 * This does NOT target external players (MPV/VLC/MPC-HC); it only draws on
 * top of Seanime's own built-in player, which is what VideoCore controls.
 *
 * Toggle it on/off, switch between 12h/24h format, and show/hide seconds
 * from the tray icon (top bar).
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
        })

        // How often (ms) the OSD text is refreshed.
        const REFRESH_MS = 1000
        // How long (ms) each OSD message stays visible. Kept a bit longer
        // than the refresh interval so the overlay doesn't flicker/blank
        // out between refreshes.
        const MESSAGE_DURATION_MS = REFRESH_MS + 400

        // ---------------------------------------------------------------
        // State (drives the tray UI)
        // ---------------------------------------------------------------
        const running = ctx.state(false)

        let cancelInterval: (() => void) | null = null

        function formatClock(): string {
            const now = new Date()
            let hours = now.getHours()
            const minutes = now.getMinutes().toString().padStart(2, "0")
            const seconds = now.getSeconds().toString().padStart(2, "0")

            let suffix = ""
            if (!settings.get("use24Hour", false)) {
                suffix = hours >= 12 ? " PM" : " AM"
                hours = hours % 12
                if (hours === 0) hours = 12
            }

            const hh = hours.toString().padStart(2, "0")
            const time = settings.get("showSeconds", true)
                ? `${hh}:${minutes}:${seconds}`
                : `${hh}:${minutes}`

            return `${time}${suffix}`
        }

        function tick() {
            if (!settings.get("enabled", true)) return

            // Safety net: if the player disconnected without firing a
            // "video-terminated"/"video-ended" event, stop cleanly instead
            // of calling into a dead client every second.
            if (!ctx.videoCore.getCurrentClientId()) {
                stopClock()
                return
            }

            ctx.videoCore.showMessage(formatClock(), MESSAGE_DURATION_MS)
        }

        function startClock() {
            if (cancelInterval) return
            if (!settings.get("enabled", true)) return

            tick() // show immediately instead of waiting a full second
            cancelInterval = ctx.setInterval(tick, REFRESH_MS)
            running.set(true)
        }

        function stopClock() {
            if (cancelInterval) {
                cancelInterval()
                cancelInterval = null
            }
            running.set(false)
        }

        // ---------------------------------------------------------------
        // Hook into the built-in player (VideoCore)
        // ---------------------------------------------------------------

        // Covers the case where a video is already loaded when the plugin
        // (re)loads -- e.g. after a hot-reload during development.
        if (ctx.videoCore.getPlaybackStatus()) {
            startClock()
        }

        ctx.videoCore.addEventListener("video-loaded", () => {
            startClock()
        })
        ctx.videoCore.addEventListener("video-can-play", () => {
            startClock()
        })
        ctx.videoCore.addEventListener("video-terminated", () => {
            stopClock()
        })
        ctx.videoCore.addEventListener("video-ended", () => {
            stopClock()
        })

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

        enabledRef.onValueChange((value) => {
            settings.set("enabled", value)
            if (value) {
                startClock()
            } else {
                stopClock()
            }
        })
        use24HourRef.onValueChange((value) => {
            settings.set("use24Hour", value)
        })
        showSecondsRef.onValueChange((value) => {
            settings.set("showSeconds", value)
        })

        tray.render(() => {
            return tray.stack([
                tray.text("Clock Overlay", { style: { fontWeight: "600" } }),
                tray.text(
                    running.get() ? "Showing on the player" : "Waiting for playback…",
                    { style: { opacity: "0.7", fontSize: "12px" } },
                ),
                tray.switch("Enabled", { fieldRef: enabledRef }),
                tray.switch("24-hour format", { fieldRef: use24HourRef }),
                tray.switch("Show seconds", { fieldRef: showSecondsRef }),
            ])
        })
    })
}
