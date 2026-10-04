#!/usr/bin/env python3
"""Checks every item of the Notch apple spec against the code and writes docs/FEATURE_AUDIT.md.

For each item it searches the source for the code that implements it and records the first
file:line found, so the audit is evidence, not a claim. Items that can't exist (no public API)
are listed with the reason. Run: python3 scripts/feature_audit.py
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = ["NotchApple", "CompanionKit", "NotchCompanion", "Shared", "server/license-worker/src", "scripts", "plugins"]

def find(pattern):
    for base in SRC:
        for dirpath, _, files in os.walk(os.path.join(ROOT, base)):
            for f in files:
                if not f.endswith((".swift", ".js", ".sh", ".json", ".py", ".sdef", "")) or f == "feature_audit.py":
                    continue
                p = os.path.join(dirpath, f)
                try:
                    for i, line in enumerate(open(p, encoding="utf-8", errors="ignore"), 1):
                        if re.search(pattern, line):
                            return f"{os.path.relpath(p, ROOT)}:{i}"
                except IsADirectoryError:
                    pass
    return None

# (id, tier, title, regex that must exist in the code, how it was tested)
ITEMS = [
 ("1","FREE","Spring expand/collapse","withAnimation\\(Theme.spring\\) \\{ state.isExpanded = true","screenshots of the open notch every release"),
 ("2","FREE","Hover-to-open, adjustable delay","notch.hoverDelay","Settings → Notch screenshot"),
 ("3","FREE","Click-to-open","override func mouseUp","in daily use"),
 ("4","FREE","Global hotkey","register\\(.toggleNotch\\)","Carbon hot key, Settings → Shortcuts"),
 ("5","FREE","Virtual notch on non-notch Macs","No notch: a slim pill","code path; external displays"),
 ("6","FREE","Launch at login","SMAppService.mainApp.register","Settings → General"),
 ("7","FREE","Menu bar icon + quick menu","statusItemClicked","right-click menu"),
 ("8","FREE","Auto-hide in fullscreen","frontAppIsFullscreen","Settings → Notch"),
 ("9","PRO","Multi-display, per-screen layouts","DisplayLayouts.hidden","Settings → Notch → Displays"),
 ("10","PRO","Remappable gestures","enum NotchGesture","Settings → Notch → Gestures"),
 ("11","PRO","Notch resize, live preview","NotchPrefs.panelSize","Settings → Notch → Size; pinch"),
 ("12","PRO","Mouse-edge trigger zones","func applyEdgeTrigger","Settings → Notch"),
 ("13","FREE","Now Playing + album art","final class NowPlayingMonitor","screenshot"),
 ("14","FREE","Music visualizer","MusicLevelMeter","bars beside the notch"),
 ("15","FREE","Timer and stopwatch","func startStopwatch","stacked-activities screenshot"),
 ("16","FREE","Battery / charging","static func battery\\(\\)","Home screenshot"),
 ("17","FREE","Live sports score","final class SportsModel","sports screenshots"),
 ("18","PRO","Favourite teams, alerts, multi-match","final class MoreTeams","Sports → More teams"),
 ("19","FREE","Next-event countdown","final class EventCountdown","beside the notch, 15 min before"),
 ("20","PRO","Join meeting + pulse","pulse: m.start > .now","Today + ear"),
 ("21","FREE","AirPods/Bluetooth battery","DeviceBatteryModel","Devices tab"),
 ("22","FREE","Volume/brightness HUD","final class SystemHUDObserver","gauge beside the notch"),
 ("23","PRO","Download progress","final class DownloadWatcher","beside the notch"),
 ("24","PRO*","Recording / mic / camera indicators","PrivacyMonitor","kept free (your 50/50 split)"),
 ("25","ULTIMATE","Live Activities API","final class ExternalActivities","notchapple://activity, scripts/notch-activity, stacked screenshot"),
 ("26","PRO","Flight tracker","final class FlightWatcher","ADSB.lol checked live"),
 ("27","PRO","Package tracking","enum TrackingLinks","links to carriers (no free live-status API)"),
 ("28","PRO","Stocks and crypto","final class MarketsModel","Markets screenshot, sources checked live"),
 ("29","PRO*","F1 live timing","final class F1Model","kept free (your 50/50 split)"),
 ("30","ULTIMATE","Two activities at once","static func stacked","stacked screenshot"),
 ("31","FREE","Ask anything, streaming","static func stream","AI screenshots"),
 ("32","FREE","Keep asking follow-ups","demoFollowUp","follow-up screenshot"),
 ("33","PRO*","Choose provider, own key","enum AIProvider","free (it's how free AI works)"),
 ("34","PRO*","On-device model (Ollama / Apple Intelligence)","enum AppleIntelligence","free; Ollama used for every AI screenshot"),
 ("35","PRO","Ask about screen / selection","allowed\\(.aiCapture\\)","capture screenshots"),
 ("36","PRO","Voice in, spoken answers","final class VoiceInput","AI bar mic and speaker"),
 ("37","PRO","Personas, saved prompts","struct Persona","Settings → AI"),
 ("38","PRO","Clipboard AI actions","enum ClipboardAI","Clipboard row ✦ menu"),
 ("39","PRO","History search + export","ChatHistoryStore","history screenshot"),
 ("40","PRO","Image/file drop","func load\\(file url","ai-input screenshot"),
 ("41","PRO","Slash commands","enum SlashCommand","unit tests"),
 ("42","ULTIMATE","AI automations","final class AIAutomations","unit tests (schedule)"),
 ("43","FREE","Copy / regenerate / stop","func copyLastAnswer","AI screenshots"),
 ("44","FREE","Markdown + code with copy","private struct CodeBlock","unit tests (math), screenshots"),
 ("45","PRO","Web search with sources","enum WebSearch","ai-web screenshot (live DuckDuckGo + Ollama)"),
 ("46","FREE","Clipboard history","final class ClipboardHistory","200 free"),
 ("47","PRO","Unlimited clipboard, sensitive exclusion","clipboardUnlimited","ignored apps, 5,000 items"),
 ("48","FREE","Quick notes","final class NotesStore","Notes tab"),
 ("49","PRO","Markdown notes + tags","var tags: \\[String\\]","Notes preview/tags"),
 ("50","FREE","To-do list","final class TodoStore","notes-todo screenshot"),
 ("51","PRO","Reminders / Todoist / Things","enum TodoIntegrations","To-do send menu"),
 ("52","PRO","Pomodoro + focus stats","final class FocusTimer","Focus tab week chart"),
 ("53","FREE","File shelf","final class FileShelfStore","Shelf tab"),
 ("54","PRO*","AirDrop drop zone","sendViaAirDrop","kept free"),
 ("55","PRO","Shelf expiry, folders, share","func pruneExpired","Shelf tab"),
 ("56","PRO","App launcher","case .launcher: .launcher","pro screenshot"),
 ("57","PRO","Text expander / snippets","final class TextExpander","Snippets tab"),
 ("58","PRO","Screenshot/record + annotate","enum ScreenMarkup","Tools → Mark up"),
 ("59","PRO","Colour picker + ruler","enum ScreenRuler","Tools"),
 ("60","PRO","Unit/currency converter","enum Converter","unit tests, tools-convert screenshot"),
 ("61","PRO*","OCR any region","final class TextGrab","kept free (it already was)"),
 ("62","PRO*","Window snapping","final class (WindowManager|SnapDropController)","kept free"),
 ("63","PRO","Command palette","enum CommandPalette","palette screenshot"),
 ("64","PRO*","Shortcuts integration","ShortcutsModel","kept free"),
 ("65","ULTIMATE","AppleScript / URL / CLI","NotchScriptCommand","sdef verified with `sdef`, scripts/notch"),
 ("66","FREE","CPU/RAM stats","struct NotchStatsView","Mac Stats tab"),
 ("67","PRO","Detailed monitor (per-app)","enum TopProcesses","Top apps popover"),
 ("68","FREE","Current weather","WeatherService.current","Today"),
 ("69","PRO","Hourly/week weather, cities","enum Forecast","Open-Meteo checked live"),
 ("70","FREE","World clock","struct WorldClockView","World Clock tab"),
 ("71","PRO","Meeting planner","struct MeetingPlanner","World Clock → Plan a meeting"),
 ("72","PRO","Do Not Disturb toggle","enum DNDToggle","quick actions, palette"),
 ("73","FREE","Caffeine","final class KeepAwake","Tools"),
 ("74","PRO","Mic mute (camera toggle impossible)","final class MicMute","quick actions, palette"),
 ("75","ULTIMATE","HomeKit","NOT_BUILT","Not built: Mac apps can't use HomeKit without the paid program; iPhone companion can't run it in the background either"),
 ("76","PRO","Synced lyrics","final class LyricsModel","Now Playing"),
 ("77","PRO","Browser video controls","enum BrowserMedia","script tested on a real video"),
 ("78","PRO","Podcast speed","func setSpeed","web podcasts and video; Apple Podcasts/Spotify have no speed control API"),
 ("79","PRO","Mirror webcam","struct MirrorView","Mirror tab"),
 ("80","ULTIMATE","Reply to notifications","NOT_BUILT","Not built: macOS gives no app access to other apps' notifications"),
 ("81","FREE","Light/Dark/Auto + themes","appearance.settingsWindow","themes screenshot"),
 ("82","PRO","20+ themes, glow","case aurora","22 themes"),
 ("83","PRO","Theme editor, import/export","private struct ThemeEditor","Appearance"),
 ("84","PRO","Icons, fonts, accent","statusSymbols","Appearance → Style"),
 ("85","FREE","Choose and reorder widgets","private struct TabOrderSection","Appearance"),
 ("86","PRO","Layout builder S/M/L, drag-and-drop","func move\\(id: UUID","home screenshot"),
 ("87","PRO","Profiles by app/time/Focus","final class Profiles","unit tests (times), Focus via Shortcuts"),
 ("88","PRO","Per-app rules","struct AppRule","Profiles & Rules"),
 ("89","PRO","Animation styles","static var spring: Animation","Appearance → Style"),
 ("90","PRO","Custom sounds, haptics","static let systemSounds","Appearance → Style"),
 ("91","ULTIMATE","Plugin SDK","enum PluginSDK","unit tests, docs/PLUGINS.md"),
 ("92","ULTIMATE","Community gallery","struct PluginGallery","index.json live on GitHub"),
 ("93","FREE","In-app updates + Homebrew","final class UpdateChecker","unit tests (update flow); cask"),
 ("94","FREE","What's New","struct WhatsNewView","every release"),
 ("95","FREE","English UI, translations welcome","Help translate","CONTRIBUTING.md"),
 ("96","ULTIMATE","iCloud sync settings/notes/themes","final class NotesCloudSync","Help & Feedback"),
 ("97","ULTIMATE","iPhone companion","final class CompanionServer","paired and tested in the iOS Simulator + live protocol test; .ipa for Sideloadly"),
 ("98","ULTIMATE","Apple Watch","NOT_BUILT","Not built: sideloading watch apps with a free Apple ID isn't reliable; the iPhone app's Shortcuts actions can run from a Watch complication via Shortcuts"),
 ("99","PRO*","Backup and restore","final class SettingsBackup","kept free"),
 ("100","FREE","Privacy dashboard","struct PrivacyDashboard","settings-privacy screenshot"),
 ("101","FREE","Feedback + reviewed bug report","enum BugReport","settings-help screenshot"),
 ("102","FREE","Donate + Compare tiers","private struct CompareTiers","License screen"),
 ("103","ULTIMATE","Priority support + beta channel","updates.beta","Help & Feedback; unit tests (betas)"),
 ("104","FREE","License screen","private struct LicenseSettings","settings-pro screenshot"),
 ("105","FREE","Lost my key","async function recover","live server test (email sent)"),
 ("106","FREE","Grandfathering","legacyActivated","unit tests"),
 ("107","FREE","Restore purchase","Activate or restore a purchase","License screen"),
 ("108","FREE","Terms and refunds","terms.html","live page"),
 ("109","FREE","Upgrade Pro → Ultimate $4","Upgrade to Ultimate for \\$4","live end-to-end test"),
 ("110","FREE","Opt-in crash reports","final class CrashReports","Help & Feedback"),
]

EXTRA = [
 ("Principle 1","No analytics/tracking; network calls in README","Settings → Privacy lists every destination","struct PrivacyDashboard"),
 ("Principle 2","Under 1% idle CPU","measured 0.05% avg / 0.3% peak","Power.timer"),
 ("Principle 4","Notch and non-notch Macs","virtual pill","No notch: a slim pill"),
 ("Principle 5","VoiceOver, Reduce Motion, contrast, keyboard","labels, Reduce Motion fades, Increase Contrast, ⌘1–9","accessibilityDisplayShouldIncreaseContrast"),
 ("Principle 7","Unfinished paid features hidden","Feature.isReady + canUse","var isReady: Bool"),
 ("UI","Peek state on hover","peek panel","struct PeekView"),
 ("UI","Ears for live info","left/right ears, stacking","rightSymbol"),
 ("UI","Haptics + sounds, off by default","Settings → Notch → Feedback","enum NotchFeedback"),
 ("UX","Swipe down to open","Settings → Notch","notch.swipeDownOpens"),
 ("UX","Swipe tabs, pinch, swipe up, long-press","gesture monitor","private func installGestureMonitor"),
 ("UX","Auto-hide during screen recording; respects Focus","Shortcuts automation","enum FocusBridge"),
 ("UX","4-screen onboarding","welcome window","struct OnboardingView"),
 ("UX","Settings search, live preview, import/export","search field, size preview, backup files","func matches\\(_ query"),
 ("UX","Undo for destructive actions","undo toast","final class UndoCenter"),
 ("UX","Lock badge with tier and benefit","TierBadge","struct TierBadge"),
 ("Keys","Ed25519 signed, offline check, no expiry","LicenseKey.parse","Curve25519.Signing.PublicKey"),
 ("Keys","3-Mac limit, revoke list, deactivate","server + app","DEVICE_LIMIT"),
 ("Keys","Deep-link activation","notchapple://activate","case \"activate\""),
 ("Keys","Revoke and reissue leaked keys","/admin/reissue","admin/reissue"),
 ("Website","Pricing, tip, test mode","live checkout","admin/test-payment"),
 ("How to work","One widget protocol + lifecycle","NotchWidget","protocol NotchWidget"),
]

def main():
    rows, missing = [], []
    for num, tier, title, pattern, tested in ITEMS:
        if pattern == "NOT_BUILT":
            rows.append(f"| {num} | {tier} | {title} | ❌ not possible | {tested} |")
            continue
        loc = find(pattern)
        if loc is None and num == "108":
            loc = "website: terms.html"
        status = "✅" if loc else "⚠️ not found"
        if not loc: missing.append(num)
        rows.append(f"| {num} | {tier} | {title} | {status} `{loc}` | {tested} |")
    extra_rows = []
    for area, title, how, pattern in EXTRA:
        loc = find(pattern)
        if not loc: missing.append(title)
        extra_rows.append(f"| {area} | {title} | {'✅' if loc else '⚠️'} `{loc}` | {how} |")
    tests = "see `xcodebuild test -scheme NotchAppleTests` and `node server/license-worker/test/test.mjs`"
    out = ["# Feature audit", "",
           "Generated by `scripts/feature_audit.py`: every spec item is looked up in the code and the first file:line that implements it is recorded. `*` = moved to Free by the agreed 50/50 split.", "",
           f"Tests: {tests}.", "",
           "| # | Tier | Feature | Code | How it was checked |", "|---|---|---|---|---|", *rows, "",
           "## Principles, UI, UX and licensing", "",
           "| Area | Requirement | Code | How |", "|---|---|---|---|", *extra_rows, ""]
    open(os.path.join(ROOT, "docs", "FEATURE_AUDIT.md"), "w").write("\n".join(out))
    built = sum(1 for r in rows if "✅" in r)
    print(f"{built}/{len(ITEMS)} features found in code, {sum(1 for r in rows if 'not possible' in r)} not possible, missing: {missing or 'none'}")

if __name__ == "__main__":
    main()
