# NotchAI: future development master roadmap

Post-2.2.60 development specification. Written 11 November 2026 from the owner's instructions. This is a long-term specification, not permission to build everything at once: each milestone is built step by step, reported, and only merged or released when the owner says so.

## How to use this document

- Work one milestone at a time, in the order in section 21 (explain any change of order before doing it).
- Every milestone: unit tests, integration tests, security tests, real tool-execution tests, UI verification where it applies, performance measurements, regression tests and documentation. Compiling is not proof a feature works.
- Keep the **living status** table at the end up to date.
- Never claim a capability that is not implemented and verified, and say honestly what is macOS only.
- Standing constraints (from the owner): local-first stays fail closed; no silent cloud or paid-provider fallback; no changes to licensing or protected premium modules (Do It, Convert, Smart Home, Claude Usage, Purge) without explicit approval; no helper app, localhost server, bridge or WebSocket; Windows must keep working; keep the owner's local `server/license-worker/test/fixture.json` untouched; no merge or release without the owner's explicit go-ahead.

### Status words

Implemented and verified · Implemented but not fully verified · Partially implemented · Not implemented · Blocked by dependency · Not applicable to platform.

For Hey Clicky comparison rows: Equivalent and verified · Better or extended · Partially equivalent / partially implemented · Missing · Not applicable.

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

Updated 12 November 2026. Milestone 1 is in PR #63 (`notchai-step1-stability`). Milestones 2 to 12 are built and committed on local branches stacked on it, ending at `notchai-roadmap-m12-workspace`; none is pushed, merged or released. About 494 pure-logic tests pass. **All testing in milestones 7 to 12 was virtual** (unit tests with fake models, fake tools and a fake MCP server, offscreen renders of drawings and a 3D scene): nothing was run on a real screen, microphone, speaker, browser or display, at the owner's request. Anything that needs a real device is listed as unverified.

Status words are the ones defined at the top of this document.

| Area | Status | Notes |
|---|---|---|
| Cursor companion (dot, Quick Ask, right-click opens tab) | Implemented but not fully verified | Shipped in 2.2.60; start at login and Reduce Motion added. Multiple displays, reconnection, login item and Reduce Motion unverified (system settings or one display). |
| Chat: stream, stop, regenerate, new, Markdown, history, restore | Implemented and verified (real Qwen3 via Ollama, earlier) | Shared by Quick Ask and the tab; saved to AI History; a saved chat can be continued from the workspace window. Not implemented: attachments, search inside the tab (the workspace sidebar searches AI History). |
| Providers, per-agent model routing | Implemented and verified (unit and fake-server tests) | Each agent can have its own provider and model; every call passes the Local-first guard. |
| Local-first guard | Implemented and verified | Covers chat, voice, research, screen, agents and teaching model calls. |
| Ollama diagnostics | Implemented and verified | Overview card. |
| Voice: push-to-talk, spoken answers, states, interruption, captions | Implemented but not fully verified | Apple Speech in, Apple voice out, chunked; state machine drives the dot; live captions overlay; Control-Option-V global shortcut. No real microphone, speaker or key press was used. |
| TTS engines | Partially implemented | Apple (default). Gemini TTS written, opt-in, blocked while Local first is on, never run. Piper and OpenAI TTS: Not implemented. |
| STT engines | Partially implemented | Apple Speech only. Local Whisper: Not implemented. |
| Dictation into other apps | Implemented but not fully verified | Spoken punctuation, filler removal, vocabulary, edit-before-insert, Accessibility insertion with no clipboard fallback. Text rules unit tested; insertion not run. No hold-to-dictate, hands-free or screen-aware drafting. |
| Wake word, hands-free mode | Not implemented | Deliberately not built: an always-on microphone cannot be verified without a real device and the roadmap says push-to-talk must be stable first. |
| Alerts, chime, spoken updates, quiet mode | Implemented but not fully verified | Pure rules tested; notifications and sounds not delivered on a real Mac. |
| Screen awareness (Pro) | Partially implemented | On demand: window, display, half and centre regions; Vision OCR; exclusions; capture indicator; optional screenshot. OCR verified on a drawn image. Real capture, a free-form region picker and selected-text capture: not run / Not implemented. |
| Screen annotations and teaching mode (Pro) | Implemented but not fully verified | Arrows, circles, boxes, target rings, numbered badges, labels; teaching plans of up to 15 steps; targets found by OCR; steps advance when expected text appears. Drawing verified pixel by pixel and as an image; the on-screen overlay and live capture loop were not run. |
| Visual explanations and 3D models (free) | Partially implemented | The model sketches a validated scene of simple shapes; rotate, zoom, click a part and ask about it; labelled as a generated illustration. Scene verified as an offscreen render. Not implemented: real object models (USDZ), images, diagrams. |
| Research (Pro) | Partially implemented | Wikipedia search (the only engine, free, no key), public page fetch, cited answers, runs as a task. Verified live earlier on example.com with local Qwen3. No general web search, no link following. |
| File reading and whole-document intelligence (Pro) | Partially implemented | Text, Markdown, CSV, JSON, code, PDF and images; BM25 retrieval with page references for long documents (`search_document`). Not implemented: DOCX, XLSX, PPTX, folders and repositories, file search, creating or editing files. |
| Memory and response style | Implemented but not fully verified | List the user controls, refuses secrets, style presets. |
| Skills | Partially implemented | Markdown skill files matched by app, text only. No library or sharing. |
| MCP connectors (Pro) | Implemented and verified (fake server; stdio checked against a scripted server) | Remote address with optional key, or local command; discovery and refresh; states connecting, connected, expired, failed; per-tool ask, read-only or blocked; disconnect and remove. Not implemented: browser sign-in (OAuth) flows, so only key or no-auth servers. No built-in Gmail, Notion or GitHub connector. |
| Browser extension | Not implemented | Needs a native-messaging or local bridge, which the project forbids. A browser agent works through AppleScript instead (open a page, read the front tab, with approval each time). |
| Browser agent | Partially implemented | `browser_open` and `browser_read` for Safari, Chrome, Edge, Brave and Arc, escaped and approval-gated; scripts tested, never run. No clicking, form filling or uploads. |
| Tool registry, task model, approvals, checkpoints, recovery | Implemented and verified (unit tests, a live task, a simulated crash) | Read-only and approval-gated tools; retries, timeouts, cancellation, idempotent recovery, Stop all. |
| Agents: registry, planner, orchestrator, delegation, parallel agents, nested depth, custom agents, per-agent routing, usage, cards | Implemented and verified virtually (fake planner model, real engine, fake tools) | 8 built-in agents plus custom ones; plans validated (one repair attempt); parallel waves up to 3; children limited to their agent's tools by the engine; finished children reused after a restart; usage estimated per agent. Multi-agent is Ultimate. The floating cards are not seen on screen. Not implemented: agent-to-agent messaging beyond result passing, per-agent conversations and follow-ups. |
| Computer control (through Do It) | Not implemented for NotchAI (hook ready) | A `computer_task` tool exists (Ultimate, always asks) and calls `PremiumRegistry.doItRun`, which nothing sets. Connecting it needs a change in the private Do It entry, which needs the owner's explicit approval. |
| Task dashboard | Implemented but not fully verified | Tasks section, workspace window with steps, results, log and delegated steps. |
| Expanded workspace window with sidebar | Implemented but not fully verified | Resizable window; conversations and tasks sidebar; continue a saved chat. No documents-beside-chat pane. |
| Agent usage and approvals reporting | Partially implemented | Estimated usage per agent; approvals shown on the cards and in Tasks; no approval-preference history. |
| Routines (scheduled repeating jobs) | Not implemented | |
| Windows | Not applicable so far | See the Windows plan below. |

## Hey Clicky parity checklist

Dated **12 November 2026**. Sources read that day: heyclicky.com (features, pricing, FAQ) and heyclicky.com/changelog (entries from v1.0 on 6 April 2026 to v1.1.3 on 6 November 2026). Hey Clicky publishes no separate documentation or API pages. This table compares capabilities named there with what NotchAI has **built** (not what a person has verified: see the living status). No row is "equivalent and verified": nothing here has been checked against Hey Clicky itself or on a real device.

Classes: Equivalent and verified · Better or extended · Partially equivalent / partially implemented · Missing · Not applicable.

| Hey Clicky capability (per its site and changelog) | NotchAI today | Class |
|---|---|---|
| Hotkey voice questions, screen seen only when asked (v1.0, site) | Control-Option-V talk; screen read only on a button press; screen text not attached to a spoken question automatically | Partially equivalent |
| Realtime voice, barge-in, 130+ languages, 30 voices (v1.0.21, v1.0.22, v1.1.2) | Push-to-talk with Apple Speech and Apple voices; interrupt by pressing talk again; languages and voices are macOS's | Partially equivalent (not realtime duplex) |
| Voice speed 0.5x to 1.5x (v1.0.45) | 0.5x to 2x, plus pitch and volume (Apple voice) | Better or extended (unverified) |
| Captions for spoken replies (v1.1.1) | Live caption bar while speaking | Partially equivalent (unverified) |
| Dictation into any app, hold or hands-free, personal dictionary, screen-aware drafting (v1.0.37) | Toggle dictation, vocabulary, Accessibility insertion; no hold, hands-free or screen-aware drafting | Partially equivalent (unverified) |
| Teaching mode and draw-on-screen walkthroughs up to 15 steps (v1.0.26, v1.0.21, v1.0.48) | Walkthroughs up to 15 steps with ring, arrow, badge, label; OCR finds the target; advances when text appears | Partially equivalent (unverified) |
| Draw on screen with Control+Option; hand-drawn style (v1.0.25, v1.0.40) | Programmatic annotations only; user drawing and hand-drawn style are not built | Missing |
| 3D models of real objects you can rotate and click (v1.1.1) | Generated sketches from simple shapes you can rotate and click; no real object models | Partially equivalent |
| Agents ("Clickys"): named, memory, files, own chats, long jobs, follow-ups, Stop, Retry (v1.0.49 to v1.1.3) | Agents with tasks, steps, Stop, Retry, resume after restart, usage; no per-agent chat, memory, files or follow-ups | Partially equivalent |
| Several agents created in one request; agent HUD cards (v1.0.51, v1.0.24) | Planner runs several agents in parallel waves; floating cards (off by default) | Partially equivalent (cards unverified) |
| Computer use ("drive"): mouse and keyboard with permission, background mode (v1.1.1, v1.0.52) | Not connected: the tool exists and asks every time, but Do It is not wired to NotchAI | Missing |
| Chrome extension, own tab group, file uploads with approval (v1.1.1, v1.1.2, v1.1.3) | Not built (needs a bridge the project forbids); AppleScript browser tools instead | Missing |
| Custom MCP connections by URL or local command (v1.0.49) | Same two kinds, per-tool permissions, states; key only, no browser sign-in | Partially equivalent |
| Connections to Gmail, Notion, Linear, Google Workspace, Calendar (v1.0.11, v1.0.15) | None built in; only through MCP servers the user adds | Missing |
| App skills for 89 apps; skills library; team skills (v1.0.28, v1.0.33, v1.0.44; paused in v1.0.49) | User-written skill files matched by app; no library or sharing | Partially equivalent |
| Memory files for profile and project; remembers how to address you (v1.0.33, v1.1.3) | User-controlled memory list and answer style | Partially equivalent |
| Routines: scheduled repeating jobs (v1.0.49, v1.1.3) | Not built | Missing |
| Whole-document understanding of PDFs, files, web pages (v1.0.47) | Page reading and BM25 passage retrieval with page references; no deeper-model routing | Partially equivalent |
| Resizable window with sidebar of chats and every agent's chat; documents beside chat (v1.1.2) | Resizable window with conversation and task sidebar; no documents pane | Partially equivalent (unverified) |
| Quieter behaviour during calls; recording apps do not count as calls (v1.0.51, v1.1.3) | Quiet mode, auto on conferencing apps (recorders excluded); macOS Focus honoured by banners | Partially equivalent |
| Drag files into the notch (v1.0.23) | Not built | Missing |
| Local models and a local-first guard | Ollama and custom endpoints, verified-local check, cloud blocked by default | Better or extended |
| Screenshots not stored, summaries kept (site privacy note) | Nothing captured is stored; memory is user-written only | Better or extended |
| Accounts, billing, referrals, student discount, usage limits (site) | Not applicable (NotchAI uses the app's existing tiers) | Not applicable |
| Windows app (v1.1.1) | NotchAI is macOS only | Missing on Windows (see plan) |

### Windows plan

NotchAI is macOS only. The Windows app is a Tauri app (`NotchWindows/`) with its own JavaScript services. Each feature needs its own implementation, not a port of the Swift code:

- **Reusable pure logic, by rewriting in JS with the same tests:** conversation rules, voice chunking and state machine, task engine and recovery, plan validation, document retrieval, memory rules, MCP protocol layer, teaching and visual-spec rules. The Swift tests are the specification.
- **Windows-specific pieces:** screen capture (Windows.Graphics.Capture) and OCR (Windows.Media.Ocr), speech (Windows.Media.SpeechRecognition and SpeechSynthesis), global hotkey and overlay windows (Tauri), UI Automation for computer control (the Do It Windows engine already uses it), the cursor dot overlay.
- **Order:** chat and Ollama first, then voice, then screen and OCR, then tasks and agents. Nothing is started.

## Acceptance checklists

Kept as separate lists for Free, Pro and Ultimate. Each item needs a real end-to-end test before it is ticked; none is ticked yet.

**Free:** the dot follows the pointer on one and on several displays; left-click opens one Quick Ask panel; right-click opens the NotchAI tab; clicking the dot while Quick Ask is open closes it; clicking away closes it without losing focus elsewhere; a real Qwen3 conversation with cloud access off; cloud and unverified models are refused with no request sent; the model list labels are right on this Mac and on a LAN server.

**Pro:** (none built yet) screen capture and OCR of a real screen; push-to-talk to spoken answer; interrupting speech; research with real citations; reading and summarising a real file.

**Ultimate:** (none built yet) a task with real tool calls; cancelling it; forcing a restart mid-task and recovering without repeating a side effect; an approved computer action; the emergency stop.
