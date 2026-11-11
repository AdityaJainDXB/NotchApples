# NotchAI: architecture and plan (Milestone 1)

Status: proposal, nothing implemented yet. Written after reading the repo, not from the brief's assumptions.

## 1. What the brief got wrong about this repo

The brief says NotchApples is web-based and needs a separate native helper. It is not: the Mac app is one native
SwiftUI/AppKit app (`NotchApple/`), the website in `web/` is only marketing. So: **no helper process, no localhost
bridge, no WebSocket.** NotchAI is a new module inside the app. That removes the whole "secure web-to-native
channel" requirement (brief section 10) and its attack surface.

## 2. What already exists (reuse, do not rebuild)

| Need | Already in the repo |
|---|---|
| Providers: Gemini, Groq, OpenRouter, Ollama, Apple Intelligence, DeepSeek, Claude, OpenAI, hosted | `Modules/Claude/AIProviders.swift` (`AIProvider` enum, default models, key URLs) |
| Streaming + errors + connection test | `AIStreaming.swift` (`stream`, `AIFailure`, `testConnection`) |
| Fallbacks | `GeminiFallback.swift`, `OpenRouterFallback.swift` |
| API keys | `Core/KeychainHelper.swift` (own store, deliberately not the login Keychain because builds are ad-hoc signed) |
| Screen capture (ScreenCaptureKit) | `Modules/Claude/ScreenCapture.swift`, `CaptureManager.swift` |
| Computer control: AX actions, CGEvent, stuck detection, retry, stop hotkey | `Modules/DoIt/` (`DoItAgent`, `DoItAX`), `Core/DoItPolicy.swift` |
| Speech-to-text | `SFSpeechRecognizer` in `AIExtras.swift` and `VoiceNotesView.swift` |
| Overlay panels over other apps | `NSPanel` use in `UI/HelloAnimation.swift` (level `.statusBar + 2`, `ignoresMouseEvents`) |
| Module lifecycle (sleep, display change, quit) | `Core/ModuleRegistry.swift` + `NotchKit.FeatureModule` |
| Tab registration + tier gating | `UI/ModuleContentView.swift`, `Core/Entitlements.swift` |
| Global hotkeys | `App/GlobalHotkeyManager.swift` |
| Permissions UI | `UI/PermissionsView.swift` |

Not found anywhere: text-to-speech, Vision OCR, any orchestrator or multi-agent code, any on-screen
drawing/annotation layer, any cursor-following overlay, memory store, skills/integrations system.
`DoItAgent` is a single-agent loop (screenshot, one JSON action, outcome feedback); it is the best base for the
Computer Agent and should be wrapped, not copied.

Constraints from `CLAUDE.md`: `NotchApple/Modules/DoIt/` is gitignored premium code (do not edit it; call
through its public API), releases follow the existing scripts, README/CHANGELOG/WhatsNew rules apply.

## 3. Proposed structure

New folder `NotchApple/Modules/NotchAI/`, pure logic in `Core/NotchAI*Logic.swift` (matches the repo's `*Logic.swift`
+ unit-test pattern in `NotchAppleTests`).

```
NotchAI/
  Companion/   CursorDotWindow (borderless NSPanel, ignoresMouseEvents, canJoinAllSpaces), follow loop, states
  Speech/      SpeechProvider protocol; AppleSpeech (default); later Gemini TTS, OpenAI TTS, Piper
  Listen/      SpeechInput protocol; AppleSTT (reuse AIExtras recogniser); later Whisper
  Context/     ScreenContext: app + window + AX text + Vision OCR + optional screenshot
  Agents/      Orchestrator, AgentSpec, Task graph, ApprovalGate, Run log
  Providers/   ModelRouter: per-agent (provider, model) on top of AIProvider; capability flags (vision)
  UI/          NotchAIView tabs: Overview, Companion, Intelligence, Agents, Voice, Settings
```

- Registered as a `FeatureModule` so sleep/display changes/quit are handled for free; off by default.
- New tab added the same way as `.doIt`; tier gating decided by the owner (open question below).
- Provider settings: read the existing `AIProvider` selection and keys. NotchAI only stores a routing table
  (agent id to provider + model) in `SettingsManager`. No second key store.
- OpenAI-compatible custom endpoint is the one genuinely missing provider shape: add as an `AIProvider` case or a
  parallel `CustomEndpoint` config (small change to an existing enum; needs your OK per rule 15).

## 4. Companion dot

One `NSPanel` per display, `.borderless`, non-activating, `ignoresMouseEvents = true` except while the dot is
being clicked. Position from `NSEvent.addGlobalMonitorForEvents(.mouseMoved)` (needs no extra permission) driven
into a spring on a `CADisplayLink`/`CVDisplayLink` that stops when idle. States (idle/listening/thinking/speaking)
are an enum fed by the conversation state machine, so the dot never calls an AI. Click-through problem: with
`ignoresMouseEvents = true` the dot cannot be clicked; plan is a hit-test on the global monitor plus a global
hotkey, and flipping `ignoresMouseEvents` only while the cursor is inside the dot.

## 5. Multi-agent design

- `AgentSpec`: id, role, system prompt, tool list, input/output JSON schema, permission level, timeout, model route.
- `Orchestrator` asks its model for a plan as JSON (validated against a schema; malformed output is a retry, never
  executed), builds a dependency graph, runs independent nodes concurrently with a Swift `TaskGroup`, joins results.
- Limits: max depth 2, max 12 tasks per run, max 3 concurrent, per-task timeout, global Stop (also Ctrl+Option+Esc,
  reusing the Do It hotkey) cancelling the task tree.
- Tools are the only way agents touch the world. Initial set: `capture_screen`, `ocr`, `ax_read`, `web_fetch`,
  `file_read`, `file_write`, `do_it_step` (wraps DoItAgent), `speak`. Browser agent starts as AppleScript/`do_it_step`
  on the browser, not a Chrome extension.
- Honest scope: web search needs a search API or fetching a search page; that is a dependency decision for you.

## 6. Security and permission model

- Levels: Suggest only, Ask before acting (default), Trusted (explicit allowlist of low-risk tools).
- Hard-coded always-ask list in code, not in prompts: send message/email, purchase, delete, install, security
  settings, shell, personal-data form submit. The model cannot downgrade it.
- Shell: no free-form execution in v1; allowlisted commands with argument validation, each approved.
- Screen/mic: on demand only, visible indicator while capturing, nothing sent unless the chosen provider is shown
  to the user first. Images are never routed to text-only models (capability flag). Fallback never switches
  provider silently; it asks.
- Text from screens, pages and files is data, never instructions (prompt-injection rule applies to every agent).
- Keys: existing `KeychainHelper`. No keys in the repo.

## 7. Milestones (each shippable, tested on a real Mac before the next)

1. This document. Owner decisions below.
2. NotchAI tab shell + routing table + conversation state machine, reading existing providers. No agents yet.
3. Green dot companion (no AI dependency). Test: multi-display, full-screen apps, CPU idle.
4. Provider router: per-agent models, capability flags, Ollama detection/diagnostics, custom OpenAI-compatible endpoint.
5. Screen intelligence: Vision OCR + AX text + existing capture, `ScreenContext`, "Explain my screen".
6. TTS (`SpeechProvider`, Apple first) wired to dot speaking state; then Gemini TTS.
7. Orchestrator + Research/Screen/File/Planning agents; Agents dashboard with job panels and Stop.
8. Computer/Browser agents via Do It, approval gate.
9. Voice loop: push-to-talk, partial captions, interruption; wake word last.
10. Annotations overlay (arrows, rings, numbered steps); memory; skills.

## 8. Limitations and risks

- Wake word needs an always-on mic; Apple's recogniser is not designed for it. Ship push-to-talk first; wake word
  is a later, opt-in, clearly indicated feature and may need a dedicated detector.
- Gemini TTS is a cloud call (text leaves the Mac); default stays Apple on-device. Piper means bundling a model and
  a binary (size, licence, notarisation).
- Ad-hoc signing: macOS permissions (Screen Recording, Accessibility, Mic) are tied to the binary signature, so
  each new build can re-prompt. Already a known issue in this repo.
- Click-through overlay vs clickable dot (section 4) needs on-device tuning.
- Reliability of computer use is bounded by the model; Do It's own history shows live testing is still thin.
- "HeyClicky parity" and the Gmail/Notion connectors are large and need OAuth apps; out of scope until the core works.
- Scope: the whole brief is many releases of work. Milestones 2 to 6 are a realistic first release.

## 9. Decisions needed from the owner

1. Which tier gets NotchAI (free, Pro, Ultimate)? It reuses Do It, which is Ultimate.
2. OK to extend `AIProvider` for a custom OpenAI-compatible endpoint?
3. Web search source for the Research agent (paid API, or fetch-only)?
4. Start with milestones 2 to 3 (tab + green dot) as the first slice?
