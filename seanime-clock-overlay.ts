/// <reference path="./types/plugin.d.ts" />
/// <reference path="./types/system.d.ts" />
/// <reference path="./types/app.d.ts" />
/// <reference path="./types/core.d.ts" />

/**
 * Clock Overlay for Seanime (with Ends At & OSD refinement)
 */

function init() {
    $ui.register((ctx) => {
        const settings = ctx.settings.define("clock-overlay", {
            enabled: true,
            use24Hour: false,
            showSeconds: true,
            showEndsAt: true, // New setting for finish time
        })

        const REFRESH_MS = 1000
        const MESSAGE_DURATION_MS = REFRESH_MS + 400

        const running = ctx.state(false)
        let cancelInterval: (() => void) | null = null

        function formatTime(date: Date, includeSeconds: boolean, use24h: boolean): string {
            let hours = date.getHours()
            const minutes = date.getMinutes().toString().padStart(2, "0")
            const seconds = date.getSeconds().toString().padStart(2, "0")

            let suffix = ""
            if (!use24h) {
                suffix = hours >= 12 ? " PM" : " AM"
                hours = hours % 12
                if (hours === 0) hours = 12
            }

            const hh = hours.toString().padStart(2, "0")
            const time = includeSeconds ? `${hh}:${minutes}:${seconds}` : `${hh}:${minutes}`
            return `${time}${suffix}`
        }

        function formatClock(): string {
            const now = new Date()
            const use24h = settings.get("use24Hour", false)
            const showSecs = settings.get("showSeconds", true)
            const showEnd = settings.get("showEndsAt", true)

            const currentTimeStr = formatTime(now, showSecs, use24h)

            if (!showEnd) {
                return currentTimeStr
            }

            // Attempt to calculate finish time if videoCore exposes duration/currentTime
            try {
                // Assuming standard video player getters if available in core types
                const duration = (ctx.videoCore as any).getDuration?.() || 0
                const currentTime = (ctx.videoCore as any).getCurrentTime?.() || 0
                const remainingSecs = Math.max(0, duration - currentTime)

                if (remainingSecs > 0) {
                    const endDate = new Date(now.getTime() + remainingSecs * 1000)
                    const endTimeStr = formatTime(endDate, false, use24h)
                    return `${currentTimeStr} (Ends at ${endTimeStr})`
                }
            } catch (e) {
                // Fallback if methods aren't present
            }

            return currentTimeStr
        }

        function tick() {
            if (!settings.get("enabled", true)) return

            if (!ctx.videoCore.getCurrentClientId()) {
                stopClock()
                return
            }

            ctx.videoCore.showMessage(formatClock(), MESSAGE_DURATION_MS)
        }

        function startClock() {
            if (cancelInterval) return
            if (!settings.get("enabled", true)) return

            tick()
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

        if (ctx.videoCore.getPlaybackStatus()) {
            startClock()
        }

        ctx.videoCore.addEventListener("video-loaded", () => startClock())
        ctx.videoCore.addEventListener("video-can-play", () => startClock())
        ctx.videoCore.addEventListener("video-terminated", () => stopClock())
        ctx.videoCore.addEventListener("video-ended", () => stopClock())

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
            value ? startClock() : stopClock()
        })
        use24HourRef.onValueChange((value) => settings.set("use24Hour", value))
        showSecondsRef.onValueChange((value) => settings.set("showSeconds", value))
        showEndsAtRef.onValueChange((value) => settings.set("showEndsAt", value))

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
                tray.switch("Show finish time", { fieldRef: showEndsAtRef }),
            ])
        })
    })
}
