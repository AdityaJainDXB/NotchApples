# NotchAI: future development master roadmap

Post-2.2.60 development specification. Written 11 November 2026 from the owner's instructions. This is a long-term specification, not permission to build everything at once: each milestone is built step by step, reported, and only merged or released when the owner says so.

## How to use this document

- **If you are picking this up, read "Handoff" below first.**
- Work one milestone at a time, in the order in section 21 (explain any change of order before doing it).
- Every milestone: unit tests, integration tests, security tests, real tool-execution tests, UI verification where it applies, performance measurements, regression tests and documentation. Compiling is not proof a feature works.
- Keep the **living status** table at the end up to date.
- Never claim a capability that is not implemented and verified, and say honestly what is macOS only.
- Standing constraints (from the owner): local-first stays fail closed; no silent cloud or paid-provider fallback; no changes to licensing or protected premium modules (Do It, Convert, Smart Home, Claude Usage, Purge) without explicit approval; no helper app, localhost server, bridge or WebSocket; Windows must keep working; keep the owner's local `server/license-worker/test/fixture.json` untouched; no merge or release without the owner's explicit go-ahead.

### Status words

Implemented and verified · Implemented but not fully verified · Partially implemented · Not implemented · Blocked by dependency · Not applicable to platform.

For Hey Clicky comparison rows: Equivalent and verified · Better or extended · Partially equivalent / partially implemented · Missing · Not applicable.

---

## Handoff: what remains, for whoever continues (12 November 2026)

The owner is handing the remaining features to another developer. This section is the starting point; the **Living status** table further down is the detailed truth for each row.

### Your first steps (do these in order)

You have access to both repositories, the public one (`AdityaJainDXB/NotchApples`) and the private one (`AdityaJainDXB/NotchApples-Premium`). The private repo holds Do It and the other Ultimate modules; the public build copies them in with `scripts/fetch-premium.sh`.

1. **Clone both repos side by side**, because the script looks for `../NotchApples-Premium` next to the public checkout:
   `NotchApples/` and `NotchApples-Premium/` in the same parent folder.
2. **Get the public work.** In `NotchApples`, `git fetch`, then check out `notchai-roadmap-m12-workspace` (draft PR #64, which includes #63's work). Run `xcodegen generate`, then `scripts/run-app-tests.sh`; it should report about 496 tests and 0 failures. Do not merge anything yet.
3. **Get the private Do It bridge.** The Do It connection for the Computer agent is one small commit in the private repo, on its own branch `notchai-doit-bridge` (commit `cdf33eb`, only `mac/Modules/PremiumEntry/PremiumEntry.swift` changed). In `NotchApples-Premium`, `git fetch` and check out `notchai-doit-bridge`. Read the diff: it sets `PremiumRegistry.doItRun` and adds `NotchAIDoItBridge`, which hands one task to Do It through Do It's own public entry points, makes Do It confirm every action, stops Do It if the NotchAI task is cancelled, and gives up after 15 minutes. **Do It itself is not changed.** It is not on the private `main` yet.
4. **Build with it.** In `NotchApples`, run `scripts/fetch-premium.sh` (it copies the private files in; they are gitignored, so they are never committed to the public repo), then build the Debug app. Grant Screen Recording and Accessibility to the build when macOS asks.
5. **Run the Do It check (backlog item 2).** In the Agents section, run a harmless request that needs the Computer agent, for example "Open TextEdit and type: hello". Confirm all of: a NotchAI approval appears first; Do It then asks to confirm each action in its own bar; cancelling the NotchAI task stops Do It; the outcome comes back as the task's result; a failed Do It run shows as a failed step, not a success. Fix problems **in the bridge or in the public NotchAI code**. Do not edit Do It's own files (`DoItAgent.swift`, `DoItAX.swift`, ...) without the owner's approval.
6. **Ask the owner to merge the private branch** into the private `main` once step 5 passes. Official releases run `scripts/fetch-premium.sh --require`, so whatever is on the private `main` ships with the next release: do not merge it earlier, and never merge it from a build that failed step 5.
7. **Then work down the backlog below**, starting with item 1 (real-device verification, which needs a real Mac), updating the status table and this section as you go, one milestone at a time, reporting after each.

Rules for the private repo: commit only what the task needs; never put keys, license data or personal data in it; changes to Do It, Convert, Smart Home, Claude Usage or Purge need the owner's explicit say-so; the public repo must keep building without it (`PremiumRegistry` slots stay empty and tabs say "included in the official build").

### Where the code is

| What | Where |
|---|---|
| Milestone 1 (chat, regenerate, Ollama diagnostics, start at login, Reduce Motion) | PR #63, branch `notchai-step1-stability` |
| Milestones 2 to 12 (voice, screen, research and files, memory, tasks, agents, MCP, dictation and alerts, teaching, 3D, workspace) | PR #64, branch `notchai-roadmap-m12-workspace`; on `main`, released in 2.2.63 |
| Web search, routines, Office files, area picker, Documents pane, connector sign-in (backlog 3, 4, 6, 8, 10, 11) | PR #71, branch `notchai-remaining`; on `main`, released in 2.2.63 |
| Agent follow-up chats (backlog 5) | PR #77, branch `notchai-agent-chats`; released in 2.2.66 |
| Voice engines, hands-free, wake word, drawing, hand-drawn style, diagrams, 3D files, folders and file search, connector buttons, screen-aware drafting, Windows chat (backlog 6 to 10, 13) | On `main`, released in 2.2.66 |
| Do It bridge for the Computer agent | `NotchApples-Premium` (private), branch `notchai-doit-bridge`, commit `cdf33eb`; **not on the private `main`**. Public side: `PremiumRegistry.doItRun` |
| Module code | `NotchApple/Modules/NotchAI/` (Agents, Integrations, Memory, Research, Screen, Skills, Tasks, Teaching, Visual, Voice, Workspace). Pure rules live in `NotchApple/Core/NotchAI*Logic.swift`, `ScreenContextLogic.swift`, `ResearchLogic.swift`, `ModelLocality.swift`, `CompanionMotion.swift` |
| Tests | `NotchAppleTests/NotchAI*Tests.swift` and others; run all with `scripts/run-app-tests.sh` (about 496 tests). The Xcode test target does not compile on `main` for unrelated reasons (missing `Chess`, `LockCode`...), so that script is the way to run them. New logic files must be added to `project.yml` (test sources) and `scripts/run-app-tests.sh` |

Merge state on 12 November 2026: #63, #64, #71 and #77 are all on `main` and released (2.2.63 and 2.2.66). The only thing not merged is the private branch `notchai-doit-bridge`: merge it into the private `main` only after the Do It check passes and the owner agrees. Follow the release rules in `CLAUDE.md` and `docs/VERSIONING.md`.

### How to build and test

- Build: `xcodegen generate` then `xcodebuild -project NotchApple.xcodeproj -scheme NotchApple -configuration Debug -destination 'platform=macOS' build CODE_SIGNING_ALLOWED=NO`. `scripts/fetch-premium.sh` copies the private Do It code in.
- DEBUG-only launch flags (compiled out of Release; check with `grep -rac selftest "<Release app>"`): `-notchai.dot.on YES`, `-notchai.selftest "<question>"`, `.provider`, `.model`, `.regenerate`, `.research "<url> | <question>"`, `.agents "<request>"`, `.resume YES`, `.workspace YES`, `.overlay YES`, `.speak "<text>"`, `.settings <tab>`, `.snapshot <section>`. Pass them after `--args`; use `-ai.provider ollama` to pin the model provider.
- Local model used in testing: Ollama `qwen3:8b` at `localhost:11434` (about 20 tokens per second, and it reasons for a minute or more, so give model steps generous time limits).
- Capture only Notch Apple's own windows when testing on a Mac (`screencapture -l <window id>`), and never inject keystrokes: an earlier attempt pressed Return in the wrong app.

### Standing rules (from the owner; keep them)

1. Local first stays fail closed: cloud and unverifiable models are blocked unless "Allow cloud and unverified models" is on; never a silent cloud or paid fallback. Every model call (chat, agents, planner, teaching, 3D, voice) goes through `NotchAIGuard`.
2. Do not change licensing or entitlement code. Tiers read `Entitlements.tier` through `NotchAITier`: Free (tab, dot, chat, history, local Ollama, 3D sketches), Pro (screen, research, files, connectors, teaching), Ultimate (multi-agent, computer control).
3. Do It, Convert, Smart Home, Claude Usage and Purge are protected premium modules: change them only with the owner's explicit approval (the Do It bridge was approved on 12 Nov, in the entry file only).
4. No helper app, localhost server, bridge or WebSocket. (A local MCP command the user adds runs only while connected.)
5. Every tool declares a risk (`ToolRisk`); sensitive and destructive steps always ask at every permission level. A plan can never grant a permission.
6. No merge or release without the owner's go-ahead. Never claim a feature works without a real run; say what was only virtual.
7. Keep this document's status table current, and keep the README and CHANGELOG rules in `CLAUDE.md`.

### Backlog (suggested order, each with how to know it is done)

| # | Work | Done when | Notes |
|---|---|---|---|
| 1 | **Real-device verification** of what was only built | Each item in the "Verified" column of the status table moves from unverified to verified, with the date | **Still open.** Needs a real Mac and a person: speak to Talk and hear the answer; interrupt speech; Screen Recording granted to the build, then Explain my screen, OCR, Teach me; dictate into TextEdit; notifications and chime; floating agent cards; the Control-Option-V shortcut; two displays; start at login; Reduce Motion; browser tools in Safari/Chrome (Automation prompt). Since 2.2.66 also: hands-free and the wake word with a real microphone, Piper and Whisper with the programs installed, drawing with Control-Option on a real screen, a real 3D file in the window, the connector buttons signing in to a real account |
| 2 | **Computer control through Do It**: run one harmless task end to end | A Computer-agent step shows an approval, Do It confirms each action, cancelling the NotchAI task stops Do It, and the result returns | **Still open.** Bridge exists (`NotchAIDoItBridge` in the private `PremiumEntry.swift`, branch `notchai-doit-bridge`); never run, and **not merged into the private `main`**, so released builds do not have it. It needs a Debug build with Screen Recording and Accessibility and a person watching. Merge the private branch only after the check passes and with the owner's OK |
| 3 | ✅ (built in PR #71, unit-tested, not run on a real screen) **General web search** | A `SearchProvider` other than Wikipedia works and is labelled as sending the query off the device | Owner wants no paid API first; options to propose: a free keyless engine or a self-hosted one. Add as a new conformer plus fixture tests like `WikipediaSearchProvider` |
| 4 | ✅ (built in PR #71, unit-tested, not run on a real screen) **Routines** (scheduled repeating tasks) | A saved task runs on a schedule, survives restart, pauses after three failures, waits for network and Mac awake | Build on `NotchAITask` and `TaskEngine`; add a scheduler and a store; reuse recovery rules |
| 5 | ✅ (12 Nov, model reply verified, panel not clicked through) **Per-agent conversations and follow-ups** | An agent's task has its own chat; a follow-up message routes to the right task; Stop button on it | Extend `NotchAITask` with a message list; Agents cards open it |
| 6 | ✅ (2.2.63 and 2.2.66, unit-tested, not run on a real drop) **More file types**: DOCX, XLSX, PPTX, folders, file search | Each is read read-only and cited with a location | Office files in 2.2.63. Since 2.2.66: a dropped or chosen folder adds its readable files (`DocumentLogic.pick`), "Search inside" finds words in the listed files with line numbers, and old Word (.doc) and rich text are read by macOS's own reader. Old .xls and .ppt are still not read |
| 7 | ✅ (2.2.66, rules unit-tested; no microphone, speaker, Piper or Whisper was used) **Voice**: local Whisper, Piper, OpenAI TTS, hands-free, optional wake word | Each engine is a `SpeechProvider` or `SpeechInput` conformer; wake word is off by default with a visible indicator and a privacy note | `OpenAISpeechProvider`, `PiperSpeechProvider`, `WhisperInput` (`LocalVoiceEngines.swift`), `NotchAIWakeWord.swift`, rules in `Core/NotchAIVoiceEngines.swift`. Piper and Whisper are programs the user installs; NotchAI runs one per sentence (the runner was exercised with real programs). The wake word requires on-device recognition and refuses to start without it. It was built before push-to-talk was verified on a real device, so it is labelled experimental: verify item 1 first |
| 8 | ✅ (2.2.63 and 2.2.66, unit-tested, not run on a real screen) **Screen**: free-form region picker, selected-text capture, screen-aware dictation | The picker draws a rectangle and captures it; dictation can draft from the screen | Picker and selected text in 2.2.63. Since 2.2.66 "Draft from the screen" in Voice: the dictated instruction plus the window's text go to the model, and the draft waits in the box until Insert (`ScreenDraftLogic`). Hold-to-dictate is not built |
| 9 | ✅ (2.2.66; drawing rendered to an image and 3D files loaded in a test program, nothing on a real screen) **Drawing and 3D**: user drawing with a modifier key, hand-drawn style, real object models (USDZ), diagrams | Each works on the real screen | `NotchAIDrawing.swift` (hold Control and Option and move the pointer; "Explain what I drew around"), `HandDrawn` in `Core/NotchAIDrawingLogic.swift`, diagrams and 3D files in `NotchAIVisual.swift` with `Core/NotchAIDiagramLogic.swift`. OBJ, STL and PLY files were opened by the same code path in a test program; no USDZ file was tried. Generated images are not built |
| 10 | ✅ (2.2.63 and 2.2.66, unit-tested; no real account was signed in to) **Connectors**: browser sign-in (OAuth) for MCP, built-in Gmail/Notion/GitHub through MCP servers, multiple accounts per connector | A connector signs in without pasting a key; tokens stay in `KeychainHelper` | Since 2.2.66 one-press entries for Notion, Linear and Sentry (browser sign-in) and GitHub (token), in `Core/NotchAIConnectorCatalog.swift`; the four addresses answered on 12 Nov 2026 and the first three advertise sign-in with self-registration. A second account is a second connector ("Notion 2"). There is **no Gmail entry**: Google runs no public MCP server for Gmail, so it needs a server the user adds by address |
| 11 | ✅ (built in PR #71, unit-tested, not run on a real screen) **Documents pane** in the workspace window; drag files into the notch | Files created or read by agents are listed beside the conversation | `NotchAIWorkspace.swift` |
| 12 | **Browser extension** | Only if the owner changes the "no bridge" rule | Currently forbidden; the AppleScript browser tools are the substitute |
| 13 | ✅ first stage (2.2.66; logic tested in node, tab checked in a browser preview, not on a Windows PC) **Windows**: see "Windows plan" under the parity checklist | A Windows build of chat first | `NotchWindows/src/js/modules/notchai.js` and `services/notchailogic.js` (locality, guard, conversation and voice rules ported with tests). Next stages (voice, screen and OCR, tasks and agents) are not started |
| 14 | ✅ re-read on 12 Nov 2026 (table below) **Final parity audit** | Re-read heyclicky.com and its changelog, update the dated table, and re-class each row after real verification | The changelog's newest entry is still Mac 1.1.3 / Windows 1.1.5 of 6 Nov 2026. Every row was re-classed against what is built; **no row can be "equivalent and verified" until item 1 is done**, so the audit has to be repeated after real-device verification |

### Known issues and things to look at first

- The first live agent run failed because model steps timed out at 60 seconds; per-tool limits were added (`TaskTool.timeout`). If a new model step times out, set its `timeout` rather than raising the global default.
- A regenerated answer is saved next to the first one in AI History, not in place of it.
- `GeminiSpeechProvider` has never run (it would send text to Google); verify with a test key only if the owner allows a cloud request.
- Hey Clicky's changelog says it removed its own "skills" in one release and brought back a second version later; do not copy their feature list blindly, check what the owner wants.
- The orchestrator's final answer uses the chat's model (Settings → AI), not the planner's route; decide whether that is what the owner wants.

---

## 1. Product vision

A powerful, native macOS AI assistant inspired by the capabilities of Hey Clicky, expanded with the owner's own ideas. It should feel like an intelligent companion integrated into the desktop, not another chatbot window. It should be able to understand what the user is doing, answer questions about the current screen, listen and respond naturally, research online, read and understand files, execute computer tasks with permission, delegate complex tasks to specialised agents, remember user-approved context, run workflows and report progress, resume interrupted tasks, and work with local and cloud models. It stays native to NotchApples.

## 2. Non-negotiable engineering requirements

1. Inspect the existing repository and architecture first.
2. Reuse the existing provider, entitlement, licensing, UI, settings and premium infrastructure.
3. Inspect existing Do It before implementing computer control.
4. Do not duplicate existing systems.
5. Do not modify protected premium modules or licensing without explicit authorisation.
6. No unnecessary helper applications, localhost servers, bridges, WebSockets or separate background processes.
7. Prefer native SwiftUI, AppKit, ScreenCaptureKit, Vision, Accessibility and system APIs.
8. Keep Windows working; use platform-specific implementations where required.
9. Do not simulate functionality or label placeholders as completed features.

Every new integration needs clear interfaces, error handling, permission handling, tests and documentation.

## 3. Cursor companion

Expand the green cursor dot into a complete desktop companion: neon green `#22C55E`; smooth tracking across displays; lightweight animation (idle breathing, moving, thinking, speaking, hover) with smooth transitions; multiple monitors and display reconnection; reduced-motion support; start at login; configurable appearance and behaviour.

Interactions: left-click opens Quick Ask; right-click opens NotchAI in the notch; clicking outside dismisses the right panels; never steal keyboard focus unexpectedly; never open duplicate Quick Ask windows. Animation must not depend on AI inference and must use minimal CPU and memory.

## 4. Quick Ask and conversational interface

A complete conversational assistant: streaming, conversation history, stop generation, regenerate, Markdown rendering, code formatting and copy, file attachments, image understanding where supported, context-aware questions, conversation search, clear controls, model selection, provider status, retry and error recovery. A conversation started from the dot can continue in the full NotchAI interface.

## 5. Voice assistant: STT, LLM and TTS

Pipeline: speech input, speech-to-text, AI orchestrator, LLM, text-to-speech, audio output. STT, LLM and TTS stay independent so each provider can change separately.

- **STT:** Apple Speech first; local Whisper as an option; more only when justified. Push-to-talk, live transcription where supported, clear microphone indicators, permission handling, cancellation, error recovery.
- **TTS:** Gemini TTS preferred; AVSpeechSynthesizer as the offline fallback; Piper as an optional local engine; more through a modular interface. Natural speech, configurable voice and speed, streaming or low latency, stop speaking, interrupt when the user starts talking, no needless delay. Never silently send private conversations to a cloud TTS provider.
- **Wake word:** only after push-to-talk is stable. Off by default, explicit microphone permission, visible listening indicator, easy disable, clear privacy explanation, low power, no recording or transmission without consent.

## 6. Screen awareness and visual understanding

Native screen understanding with ScreenCaptureKit, Apple Vision OCR and native window and application context APIs: understand visible content, OCR, identify the active application and window, capture selected regions, send relevant context to the AI, answer questions about screenshots, understand supported UI elements, explain what is visible.

Privacy: permission-based, clear capture indicators, application and window exclusions, never capture continuously without explicit configuration, cloud transmission visible and permission-controlled, do not store screenshots unnecessarily.

## 7. Screen annotations and drawing

A native overlay for arrows, rectangles, highlights, pointers, temporary instructions, marking UI elements, "click here" guidance, highlighting content, clearing, and a configurable duration. It sits above the relevant windows without getting in the way of normal use.

## 8. Multi-agent orchestration

A real multi-agent system, not simulated agent cards. Specialised agents:

- **Research:** search, gather, compare sources, summarise, cite.
- **Browser:** navigate, read, interact with supported sites, complete permitted workflows, report actions and results.
- **Computer:** operate supported apps, interact with UI elements, run approved actions, use Do It where appropriate.
- **Coding:** read project files, explain, debug, write and edit code, run approved tests, report file changes.
- **Screen:** understand screenshots, OCR, identify UI elements, support annotations.
- **File:** read documents, summarise PDFs, understand spreadsheets, search files, extract information, create and edit permitted documents.
- **Voice:** speech input, transcription, spoken replies, interruption and audio state.
- **Planning:** break requests into steps, delegate, track progress, coordinate, recover from failures.
- **Custom agents:** future user-created agents with configurable tools, instructions and models.

## 9. Agent orchestration architecture

Build the shared foundation before expanding the agents: tool registry, tool schemas, permission model, agent registry, task data model, task execution lifecycle, task queue, cancellation, structured execution logs, retry handling, idempotency, persistent task storage, checkpoints, recovery and resume, agent-to-agent communication, resource and concurrency limits.

Agents execute real tools. Never claim a browser action, file edit, search or computer operation happened unless it actually succeeded. The orchestrator understands the request, plans, selects agents, delegates, runs sequentially or in parallel where safe, monitors, recovers from recoverable errors, asks approval for sensitive actions and presents the result.

## 10. Computer control

Native macOS: Accessibility APIs, AppleScript, Shortcuts, CGEvent and the existing Do It integration. Click UI elements, type, scroll, navigate apps, interact with windows, run approved workflows, give visual guidance, do multi-step tasks.

Safety: explicit permissions, approval for sensitive operations, confirmation before destructive actions, purchases, payments and external communications, an emergency stop, action history, a clear indication of what the assistant is doing. Never bypass macOS security or accessibility permissions.

## 11. Web research and browsing

Web search, opening sites, extracting readable content, following relevant links, comparing sources, summarising, citations, saving results, multi-step browsing. Distinguish verified facts, source claims and AI conclusions. Never invent citations or claim a site was accessed when it was not.

## 12. Files and documents

User-approved files: PDF, DOCX, TXT, Markdown, CSV, XLSX, PPTX and images. Search, summarise, answer questions, extract structured information, compare, create reports, generate permitted files, explain code repositories. Preserve originals unless the user authorises editing or replacement.

## 13. Memory and personalisation

User-controlled memory: preferences, frequent workflows, projects, approved personal context, custom instructions, useful conversation context. The user can see, review, correct and delete it; privacy boundaries are clear; nothing sensitive is stored without consent; temporary conversation context is kept separate from persistent memory.

## 14. Skills and integrations

A modular skills system so capabilities can be added without changing the core app. Potential integrations: GitHub, GitLab, Slack, Discord, Google Drive, Google Calendar, Gmail, Notion, local files, terminal, Shortcuts, supported browser workflows. Each integration has an explicit permission model, explains what data it reads, stores credentials securely, supports disconnection, handles expired credentials and reports errors accurately. Do not assume an integration exists until it is built and connected.

## 15. AI provider architecture

Reuse the existing providers (Ollama, Gemini, Groq, OpenRouter, Apple Intelligence, DeepSeek, Claude, OpenAI, the hosted provider and custom OpenAI-compatible endpoints). Future: per-agent model routing, independent STT, LLM and TTS selection, model capability detection, context-window awareness, provider diagnostics, connection testing, streaming, retry policies, availability reporting.

**Local first stays secure:** prefer verified local Ollama models; never fall back to cloud silently; block cloud providers when cloud access is off; treat unknown or unverifiable locality as untrusted; label device-local, LAN-hosted and cloud models clearly; keep credentials in the Keychain; show users when data leaves the device; never bypass the locality guard for speed.

## 16. Task dashboard and persistent workflows

Show active, completed, failed and paused tasks, agent assignments, the current step, progress, logs, tool calls, approval requests, errors and duration. Pause, resume, cancel, retry, inspect history, and recover tasks after an app restart. Use persistent storage and idempotency so a crash or restart never repeats a side effect.

## 17. NotchAI interface

Areas: Overview, Companion, Chat, Agents, Voice, Tasks, Memory, Integrations, Skills, Settings. Modern, responsive, consistent with NotchApples, native macOS patterns, no clutter.

## 18. Free, Pro and Ultimate

Capabilities go through the existing entitlement architecture; do not invent a second licensing system and do not change licensing without approval. The final mapping must be checked against the existing licensing and product rules before implementation.

- **Free:** cursor companion, Quick Ask, basic chat, conversation history, local Ollama, basic provider access under existing policies, basic task history.
- **Pro:** screen awareness, OCR, active-window context, region capture, advanced voice, research, browser and file agents, advanced memory, skills and integrations, optional wake word.
- **Ultimate:** multi-agent orchestration, parallel agents, per-agent model routing, advanced computer interaction, persistent workflows, checkpoints and recovery, advanced planning, advanced automation and integrations, custom agents.

## 19. Performance and reliability

Minimal idle CPU, low memory, responsive cursor, efficient screen capture, no needless polling, proper cancellation, no leaks, crash recovery, clear errors, graceful offline behaviour. The dot stays responsive while an AI task runs.

## 20. Testing and acceptance

Every milestone has: unit tests, integration tests, security tests, real tool-execution tests, UI verification where applicable, performance measurements, regression tests and documentation. Never mark a feature complete on a successful compile alone.

Required end-to-end examples: a real Qwen3 conversation with cloud access off; real voice input and spoken output; interrupting TTS; OCR of a real screen capture; a real browser search with citations; real file reading and summarising; an approved computer action; cancelling a running task; a forced restart during a task with recovery and no duplicate side effects.

## 21. Development sequence

1. **Core stability:** chat history, stop and regenerate, Ollama diagnostics, start at login, multiple displays, cursor reliability, Quick Ask refinement.
2. **Voice:** push-to-talk, Apple Speech, Gemini TTS, offline fallback, interruption, speaking and thinking states.
3. **Screen intelligence:** ScreenCaptureKit, Vision OCR, active-app context, region selection, screen-aware chat, annotation overlays.
4. **Research and files:** search, browser reading, citations, file agent, document understanding.
5. **Skills and memory:** user-controlled memory, skill registry, integrations, custom workflows.
6. **Multi-agent architecture:** tool registry, agent registry, planner, task execution, parallel work, logs, cancellation.
7. **Autonomous workflows:** persistent tasks, checkpoints, restart recovery, idempotency, computer control, approvals, emergency stop.
8. **Advanced:** optional wake word, custom agents, per-agent model routing, advanced integrations, tier-specific enhancements.

The sequence can change for architectural dependencies; explain any change before implementing it. The Hey Clicky parity features (sections 24 and 25) are folded into these milestones where they fit.

## 22. Release and documentation discipline

Every release must build on its platform, pass its tests, keep existing features, verify entitlement behaviour, verify privacy and permissions, have accurate release notes, and not claim anything unimplemented. Be honest about what is macOS only; do not claim a macOS API works on Windows without a real equivalent.

## 23. Instructions for the agent

1. Preserve the approved PR and release constraints.
2. Before each milestone: inspect the repository, compare it with this roadmap, produce a feature-by-feature audit, list reusable code and dependencies, recommend the milestone and say why, estimate risks, tests and scope.
3. Build step by step, reporting after each milestone (changes, tests, failures, limitations, next step).
4. Keep this roadmap and the status table current.

---

## 24. Hey Clicky feature-parity expansion

Identified from a comparison with Hey Clicky's publicly documented features and changelog. Do not copy proprietary implementation details; build our own product and architecture.

**A. Global hotkey and instant screen context.** Configurable global shortcut; capture the screen when asked; ask about it by voice or text; keep relevant screen context within the active conversation; respect app exclusions and privacy permissions.

**B. Real-time voice interaction.** Low-latency voice mode; natural interruptions; speaking and listening at once; voice-driven agent creation; agents that ask clarifying questions aloud; multilingual recognition and TTS; voice selection with spoken previews.

**C. Universal dictation.** Dictate into supported text fields across macOS; insert at the cursor; punctuation and formatting commands; edit or cancel before insertion; never capture or send typed text unnecessarily.

**D. Interactive teaching mode.** Step-by-step workflows with arrows, circles, target rings and instruction cards; detect when the user has done the step and advance; reassess the screen before the next step; adapt to the active app; application-specific skill files.

**E. Application-specific skills.** Detect supported apps and load matching skill instructions; user-created skill files; workflows, shortcuts and guidance; permission-controlled and sandboxed where possible.

**F. Advanced agent experience.** Create agents from voice or text; clarifying questions; a short cancellation window before consequential tasks; each agent's conversation; files agents created; website uploads only where authorised; long jobs that keep running while the user does other things; progress, cancellation and recovery.

**G. Expanded NotchAI workspace.** A resizable window that grows from the notch; a persistent conversation sidebar; separate agent conversations; documents and generated files beside conversations; light and dark; native macOS behaviour.

**H. Visual explanations and 3D models.** Explanatory diagrams; relevant images; interactive 3D models for suitable topics (rotate, zoom, inspect parts); questions about individual parts; generated visuals clearly distinguished from factual sources.

**I. Long-running task reliability.** Jobs continue while the user works elsewhere; recover from network failures; persisted state; questions when blocked; no duplicate external actions; notifications on finish or when approval is needed.

**J. Acceptance testing.** Real end-to-end verification for every capability. A UI that looks similar is not parity. Classify each as equivalent and verified, better or extended, partially equivalent, missing, or not applicable. Keep a dated comparison with Hey Clicky's public changelog and documentation.

## 25. Advanced Hey Clicky parity: final integration requirements

As of November 2026.

1. **MCP connectors.** Custom MCP servers; remote URLs and permitted local commands; API-key and browser sign-in where available; dynamic tool discovery and refresh; connecting, connected, expired and failed states; disconnect and revoke; permission controls on every tool.
2. **Browser extension.** A secure optional extension for Chrome and compatible Chromium browsers where feasible; agents work in the user's explicitly authorised session; existing signed-in sessions without asking for passwords; tab groups and agent workspaces; permitted site interaction and file uploads; never bypass site security or authentication; transparent, revocable permissions.
3. **Whole-document intelligence.** Read whole PDFs, documents and webpages; text, tables and relevant visuals; document-level questions; source and page references; chunking and retrieval for large documents; privacy and local-first rules apply.
4. **Agent HUD and contextual interaction.** Floating agent cards around the notch with names, plans, progress and results; open an agent's conversation; follow-ups while tasks run; cancel, retry, approve; route follow-ups to the right agent.
5. **Voice shortcuts and dictation.** Configurable global shortcuts; hold to talk; optional double-tap or hands-free; universal dictation; multilingual recognition; editable vocabulary and corrections; transcripts preserved when interrupted; accurate text insertion rather than a clipboard fallback.
6. **Captions and announcements.** Live captions while NotchAI speaks; separate controls for spoken updates and cursor-side text; completion sounds; quiet mode during calls and screen sharing; agent notification settings; respect macOS Focus and notification settings.
7. **Adaptive response preferences.** Remember approved style preferences (concise, detailed, simple, structured), formatting and language; apply across conversations; inspect, edit and disable them.
8. **Agent usage and approvals.** Usage per agent and task; approval preferences; a cancellation window before consequential tasks; clear usage limits; never bypass purchase, payment, deletion or external-communication confirmations.
9. **Final parity audit.** Compare every publicly documented capability and classify it (equivalent and verified, better or extended, partially implemented, missing, not applicable), separating macOS and Windows. Do not claim full parity from UI resemblance or a successful compile. Keep the comparison dated and update it when Hey Clicky ships significant new capabilities.

---

## Living status

Updated 12 November 2026, after release 2.2.66. Everything in this table is on `main` and released unless a row says otherwise. About 641 pure-logic tests pass on the Mac (`scripts/run-app-tests.sh`) and 553 on Windows (`node --test`). Milestones 7 to 12 were first tested virtually (unit tests with fake models, fake tools and a fake MCP server, offscreen renders), then, after the owner allowed it on 12 November, partly on the real Mac: a live multi-agent run, the workspace window and the annotation overlay (see the rows below). What 2.2.66 added was checked by unit tests, a whole-app type-check, the release compile in CI, and small test programs (the local-program runner, the hand-drawn renderer, loading OBJ, STL and PLY files). No microphone, speaker output, real screen capture, browser sign-in, second display or system setting was exercised. Anything that needs those is listed as unverified.

Status words are the ones defined at the top of this document.

| Area | Status | Notes |
|---|---|---|
| Cursor companion (dot, Quick Ask, right-click opens tab) | Implemented but not fully verified | Shipped in 2.2.60; start at login and Reduce Motion added. Multiple displays, reconnection, login item and Reduce Motion unverified (system settings or one display). |
| Chat: stream, stop, regenerate, new, Markdown, history, restore | Implemented and verified (real Qwen3 via Ollama, earlier) | Shared by Quick Ask and the tab; saved to AI History; a saved chat can be continued from the workspace window. Not implemented: attachments, search inside the tab (the workspace sidebar searches AI History). |
| Providers, per-agent model routing | Implemented and verified (unit and fake-server tests) | Each agent can have its own provider and model; every call passes the Local-first guard. |
| Local-first guard | Implemented and verified | Covers chat, voice, research, screen, agents and teaching model calls. |
| Ollama diagnostics | Implemented and verified | Overview card. |
| Voice: push-to-talk, spoken answers, states, interruption, captions | Implemented but not fully verified | Apple Speech in, Apple voice out, chunked; state machine drives the dot; live captions overlay; Control-Option-V global shortcut. No real microphone, speaker or key press was used. |
| TTS engines | Implemented but not fully verified | Apple (default); Piper, a local neural voice the user installs (program and voice file set in Voice; one short run per sentence group, nothing leaves the Mac); Gemini TTS and OpenAI TTS, both cloud, opt-in and blocked while Local first is on. The program runner was exercised with real programs; Piper itself, Gemini and OpenAI were never run. |
| STT engines | Implemented but not fully verified | Apple Speech (live text) or Whisper (whisper.cpp the user installs: the question is recorded to a temporary file, transcribed on the Mac, and the file deleted; the words arrive when you finish speaking). Command line and output cleaning unit tested; Whisper itself and the recording were never run. |
| Dictation into other apps | Implemented but not fully verified | Spoken punctuation, filler removal, vocabulary, edit-before-insert, Accessibility insertion with no clipboard fallback. Since 2.2.66 "Draft from the screen": the instruction and the window's text go to the model and the draft waits in the box until Insert. Text rules unit tested; insertion and drafting not run. No hold-to-dictate. |
| Wake word, hands-free mode | Implemented but not verified (experimental) | Hands-free (off by default): a pause of 1.6 s ends the sentence, 8 s of silence closes the microphone, and NotchAI listens again after it answers a spoken question. Wake word (off by default, "hey notch" or a phrase of two to four words): on-device recognition only, refuses to start if the Mac cannot do that, pauses while anything else uses the microphone, shows "Wake word" in the NotchAI header and an orange dot in Voice while the microphone is open. Rules unit tested (matching, pauses, limits). **Never run with a real microphone**, and built before push-to-talk was verified on a device. |
| Alerts, chime, spoken updates, quiet mode | Implemented but not fully verified | Pure rules tested; notifications and sounds not delivered on a real Mac. |
| Screen awareness (Pro) | Implemented but not fully verified | On demand: window, display, half and centre regions; a free-form area picker (drag a rectangle on any display); selected-text capture through Accessibility (no clipboard, no key presses); Vision OCR; exclusions (an excluded app's windows are now blanked out of display and area captures); capture indicator; optional screenshot. Region maths tested; OCR verified on a drawn image. The picker, real capture and Accessibility reads have not been run on a real screen. |
| Screen annotations and teaching mode (Pro) | Partially verified | Arrows, circles, boxes, target rings, numbered badges, labels; teaching plans of up to 15 steps; targets found by OCR; steps advance when expected text appears. Drawing verified pixel by pixel; the click-through overlay window was shown on the real screen and captured (ring, arrow, badge, label in place). The live capture loop (OCR of the real screen) was not run. Since 2.2.66: the user can draw (hold Control and Option and move the pointer; lines fade after 20 s; "Explain what I drew around" reads that area) and NotchAI's shapes can use a hand-drawn style. Both were rendered to an image and checked; neither was used on a real screen. |
| Visual explanations and 3D models (free) | Implemented but not fully verified | The model sketches a validated scene of simple shapes; rotate, zoom, click a part and ask about it; labelled as a generated illustration. Scene verified as an offscreen render. Since 2.2.66: diagrams (validated boxes and arrows laid out in rows, click a box and ask) and the user's own 3D files (USDZ, USD, OBJ, DAE, SCN, STL, PLY; named parts listed and clickable; labelled as the user's file). OBJ, STL and PLY were opened by the same code in a test program; no USDZ was tried and neither view was seen in the app. Not implemented: generated images. |
| Research (Pro) | Implemented but not fully verified | General web search with no key or paid API: DuckDuckGo (default), the user's own SearXNG, or Wikipedia, chosen in Research; every engine says it sends the query off the device; no SearXNG address means no search, never a silent switch. A question with no address searches, reads the top three pages and cites them. The DuckDuckGo parser was checked against the real page (10 results). Not yet: following links, a live end-to-end run with the local model. |
| File reading and whole-document intelligence (Pro) | Implemented but not fully verified | Text, Markdown, CSV, JSON, code, PDF, images, Word (.docx), Excel (.xlsx) and PowerPoint (.pptx), read-only with no outside code (own zip reader with zip-bomb limits; slides and sheets are cited as pages). Tested on real files from textutil and openpyxl. Since 2.2.66: a folder adds its readable files (up to 100, four levels deep, hidden and tool folders skipped), "Search inside" finds words in the listed files with line numbers, and old Word (.doc) and rich text go through macOS's own reader. Not implemented: repositories as such, creating or editing files, old .xls and .ppt. |
| Memory and response style | Implemented but not fully verified | List the user controls, refuses secrets, style presets. |
| Skills | Partially implemented | Markdown skill files matched by app, text only. No library or sharing. |
| MCP connectors (Pro) | Implemented and verified (fake server; stdio checked against a scripted server) | Remote address with optional key, or local command; discovery and refresh; states connecting, connected, expired, failed; per-tool ask, read-only or blocked; disconnect and remove. Browser sign-in (OAuth 2.1 with PKCE, dynamic registration, refresh) is built: discovery, registration, code exchange and refresh were run end to end against a local test server; the browser sheet itself (ASWebAuthenticationSession) has never been shown, and no real service was signed in to. Tokens are kept in the private store. Since 2.2.66 there are one-press entries for Notion, Linear and Sentry (browser sign-in) and GitHub (token); a second account is a second connector ("Notion 2") with its own sign-in. The addresses answered on 12 Nov 2026; no account was signed in to. No Gmail entry: Google runs no public server of this kind. |
| Browser extension | Not implemented | Needs a native-messaging or local bridge, which the project forbids. A browser agent works through AppleScript instead (open a page, read the front tab, with approval each time). |
| Browser agent | Partially implemented | `browser_open` and `browser_read` for Safari, Chrome, Edge, Brave and Arc, escaped and approval-gated; scripts tested, never run. No clicking, form filling or uploads. |
| Tool registry, task model, approvals, checkpoints, recovery | Implemented and verified (unit tests, a live task, a simulated crash) | Read-only and approval-gated tools; retries, timeouts, cancellation, idempotent recovery, Stop all. |
| Agents: registry, planner, orchestrator, delegation, parallel agents, nested depth, custom agents, per-agent routing, usage, cards | Implemented and verified (virtual tests, and a live run on 12 Nov: local Qwen3 planned, two Wikipedia searches ran in parallel as child tasks, a comparison step ran, and the answer came back in Chat; per-agent routes pointed the planner and research agents at qwen3:8b) | 8 built-in agents plus custom ones; plans validated (one repair attempt); parallel waves up to 3; children limited to their agent's tools by the engine; finished children reused after a restart; usage estimated per agent. Multi-agent is Ultimate. The floating cards were not seen on screen. A real run exposed that a local model can reason for over a minute, so model-calling tools now have their own time limits (plan 10 min, ask 5 min, run_plan 1 h). Follow-ups about a finished task are built (each task keeps its own chat; a real follow-up was answered by local Qwen3 on 12 Nov; the panel was not clicked through). Not implemented: agent-to-agent messaging beyond result passing. |
| Computer control (through Do It) | Implemented but not verified | The owner approved the change on 12 Nov. `computer_task` (Ultimate, always asks) calls `PremiumRegistry.doItRun`, which the private entry now sets with a small bridge: one task to Do It, every action confirmed in Do It's own bar, stops if the NotchAI task is cancelled, 15-minute limit. Committed on the private branch `notchai-doit-bridge`, **not on the private `main`, so no released build has it**; Do It itself is unchanged. The app builds with it; no task was run because Do It would drive the Mac. |
| Task dashboard | Implemented but not fully verified | Tasks section, workspace window with steps, results, log and delegated steps. |
| Expanded workspace window with sidebar | Implemented and verified on screen (opened, captured as its own window) | Resizable window; conversation list from AI History, the agent task, and the live NotchAI tab. Continue-a-chat and resizing not exercised. A Documents pane now lists dropped, chosen and agent-read files (not yet seen on screen). |
| Agent usage and approvals reporting | Partially implemented | Estimated usage per agent; approvals shown on the cards and in Tasks; no approval-preference history. |
| Routines (scheduled repeating jobs) | Implemented but not fully verified | Every N minutes, daily or weekly; survives restart; waits offline; one catch-up run after sleep; pauses after 3 failures; unapproved run cancelled after an hour; no timer or monitor while nothing is on. Pure rules tested (24 tests). Not yet run for a day on a real Mac, and a routine's answer lands in Chat. |
| Windows | Partially implemented (chat only) | Since 2.2.66 the Windows app has a NotchAI tab: one chat with Stop, Regenerate, New chat and answers read aloud, behind the same Local-first rule (only a model Ollama lists as installed on the PC, anything else refused before a request). Rules ported to JS with 10 tests; the tab was exercised in a browser preview (both refusals seen), not on a Windows PC and not with a running Ollama. Everything else is still Mac only: see the Windows plan below. |

## Hey Clicky parity checklist

Dated **12 November 2026** and re-read the same day after release 2.2.66. Sources: heyclicky.com (features, pricing, FAQ) and heyclicky.com/changelog (entries from v1.0 on 6 April 2026 to Mac 1.1.3 / Windows 1.1.5 on 6 November 2026, still the newest entry). Hey Clicky publishes no separate documentation or API pages. This table compares capabilities named there with what NotchAI has **built** (not what a person has verified: see the living status). No row is "equivalent and verified": nothing here has been checked against Hey Clicky itself or on a real device, so the classes below are the highest each row can honestly have today.

Classes: Equivalent and verified · Better or extended · Partially equivalent / partially implemented · Missing · Not applicable.

| Hey Clicky capability (per its site and changelog) | NotchAI today | Class |
|---|---|---|
| Hotkey voice questions, screen seen only when asked (v1.0, site) | Control-Option-V talk; screen read only on a button press; screen text not attached to a spoken question automatically | Partially equivalent (unverified) |
| Realtime voice, barge-in, 130+ languages, 30 voices (v1.0.21, v1.0.22, v1.1.2) | Push-to-talk or hands-free (a pause ends the sentence, listens again after the answer) and an optional wake word; Apple Speech or local Whisper in; Apple, Piper, Gemini or OpenAI voices out; interrupt by pressing talk. Not a realtime duplex model, and you cannot talk over an answer hands-free | Partially equivalent (unverified) |
| Voice speed 0.5x to 1.5x (v1.0.45) | 0.5x to 2x, plus pitch and volume (Apple voice) | Better or extended (unverified) |
| Captions for spoken replies (v1.1.1) | Live caption bar while speaking | Partially equivalent (unverified) |
| Dictation into any app, hold or hands-free, personal dictionary, screen-aware drafting (v1.0.37) | Toggle dictation, vocabulary, Accessibility insertion, and drafting from the window you were using; no hold-to-dictate | Partially equivalent (unverified) |
| Teaching mode and draw-on-screen walkthroughs up to 15 steps (v1.0.26, v1.0.21, v1.0.48) | Walkthroughs up to 15 steps with ring, arrow, badge, label; OCR finds the target; advances when text appears | Partially equivalent (unverified) |
| Draw on screen with Control+Option; hand-drawn style (v1.0.25, v1.0.40); 2D and 3D drawing (v1.1.1) | Hold Control and Option and move the pointer to draw, then ask about the area drawn around; a hand-drawn style for NotchAI's own shapes. Drawing is 2D only | Partially equivalent (unverified) |
| 3D models of real objects you can rotate and click (v1.1.1) | Generated sketches from simple shapes, generated diagrams, and the user's own 3D files (USDZ, OBJ, STL and others) to rotate and click; NotchAI does not find or make a real object's model itself | Partially equivalent (unverified) |
| Agents ("Clickys"): named, memory, files, own chats, long jobs, follow-ups, Stop, Retry (v1.0.49 to v1.1.3) | Agents with tasks, steps, Stop, Retry, resume after restart, usage, and follow-up questions about a finished task in that task's own chat; no per-agent memory or files | Partially equivalent |
| Several agents created in one request; agent HUD cards (v1.0.51, v1.0.24) | Planner runs several agents in parallel waves; floating cards (off by default) | Partially equivalent (cards unverified) |
| Computer use ("drive"): mouse and keyboard with permission, background mode (v1.1.1, v1.0.52) | Built but not shipped: a bridge hands one approved task to Do It, which confirms every action; it is on a private branch, has never been run, and no released build has it | Missing in releases (built, unverified) |
| Chrome extension, own tab group, file uploads with approval (v1.1.1, v1.1.2, v1.1.3) | Not built (needs a bridge the project forbids); AppleScript browser tools instead | Missing |
| Custom MCP connections by URL or local command (v1.0.49) | Same two kinds, per-tool permissions, states, a key or browser sign-in | Partially equivalent (sign-in unverified) |
| Connections to Gmail, Notion, Linear, Google Workspace, Calendar (v1.0.11, v1.0.15); several accounts per app (v1.0.53) | One-press connectors for Notion, Linear, Sentry and GitHub through their own MCP servers, more than one account each. No Gmail, Google Workspace or Calendar | Partially equivalent (unverified) |
| App skills for 89 apps; skills library; team skills (v1.0.28, v1.0.33, v1.0.44; paused in v1.0.49) | User-written skill files matched by app; no library or sharing | Partially equivalent |
| Memory files for profile and project; remembers how to address you (v1.0.33, v1.1.3) | User-controlled memory list and answer style | Partially equivalent |
| Routines: scheduled repeating jobs (v1.0.49, v1.1.3) | Every N minutes, daily or weekly; survive restart; wait offline; pause after three failures | Partially equivalent (unverified) |
| Whole-document understanding of PDFs, files, web pages (v1.0.47) | Page reading and BM25 passage retrieval with page references; no deeper-model routing | Partially equivalent |
| Resizable window with sidebar of chats and every agent's chat; documents beside chat (v1.1.2) | Resizable window with conversation and task sidebar and a Documents pane (files, folders, search inside) | Partially equivalent (unverified) |
| Quieter behaviour during calls; recording apps do not count as calls (v1.0.51, v1.1.3) | Quiet mode, auto on conferencing apps (recorders excluded); macOS Focus honoured by banners | Partially equivalent |
| Drag files into the notch (v1.0.23) | Files and folders dropped on the NotchAI tab or the workspace window are listed in Documents and can be summarised, asked about or searched (read-only); never run on a real drag | Partially equivalent (unverified) |
| Local models and a local-first guard | Ollama and custom endpoints, verified-local check, cloud blocked by default | Better or extended |
| Screenshots not stored, summaries kept (site privacy note) | Nothing captured is stored; memory is user-written only | Better or extended |
| Accounts, billing, referrals, student discount, usage limits (site) | Not applicable (NotchAI uses the app's existing tiers) | Not applicable |
| Windows app (v1.1.1) | A NotchAI tab on Windows with chat only (local first); voice, screen, files and agents are Mac only | Partially equivalent (chat only, unverified on a PC) |

### Windows plan

NotchAI started on the Mac. The Windows app is a Tauri app (`NotchWindows/`) with its own JavaScript services. Each feature needs its own implementation, not a port of the Swift code:

- **Reusable pure logic, by rewriting in JS with the same tests:** conversation rules, voice chunking and state machine, task engine and recovery, plan validation, document retrieval, memory rules, MCP protocol layer, teaching and visual-spec rules. The Swift tests are the specification.
- **Windows-specific pieces:** screen capture (Windows.Graphics.Capture) and OCR (Windows.Media.Ocr), speech (Windows.Media.SpeechRecognition and SpeechSynthesis), global hotkey and overlay windows (Tauri), UI Automation for computer control (the Do It Windows engine already uses it), the cursor dot overlay.
- **Order:** chat and Ollama first, then voice, then screen and OCR, then tasks and agents.
- **Done (2.2.66):** chat and Ollama. `modules/notchai.js` is the tab; `services/notchailogic.js` holds the ported rules (where a model runs, the Local-first gate, Regenerate and trimming, spoken text and chunking, the voice state machine) with `tests/notchailogic.test.mjs`. It reuses the AI tab's provider and model. Not yet run on a Windows PC or against a running Ollama.
- **Next:** voice (Windows.Media.SpeechRecognition), then screen and OCR.

## Acceptance checklists

Kept as separate lists for Free, Pro and Ultimate. Each item needs a real end-to-end test before it is ticked; none is ticked yet.

**Free:** the dot follows the pointer on one and on several displays; left-click opens one Quick Ask panel; right-click opens the NotchAI tab; clicking the dot while Quick Ask is open closes it; clicking away closes it without losing focus elsewhere; a real Qwen3 conversation with cloud access off; cloud and unverified models are refused with no request sent; the model list labels are right on this Mac and on a LAN server.

**Pro:** (built; none ticked yet) screen capture and OCR of a real screen; push-to-talk to spoken answer; interrupting speech; research with real citations; reading and summarising a real file.

**Ultimate:** (built; none ticked yet) a task with real tool calls; cancelling it; forcing a restart mid-task and recovering without repeating a side effect; an approved computer action; the emergency stop.

