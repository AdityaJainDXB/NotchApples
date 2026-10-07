//
//  VoiceNotesView.swift
//  Notch apple
//
//  Pro: Voice Notes. Press record in the notch, talk, stop. The recording is
//  transcribed on your Mac (Apple's on-device speech recognition when the
//  language supports it), and one click turns it into an AI summary with
//  action items, using whichever AI you picked in Settings → AI.
//  Recordings live in ~/Library/Application Support/Notch apple/Voice Notes.
//

import AppKit
import AVFoundation
import Speech
import SwiftUI

struct VoiceNote: Codable, Identifiable, Equatable {
    var id = UUID()
    var date = Date()
    var duration: TimeInterval = 0
    var fileName: String
    var transcript: String?
    var summary: String?
    /// The calendar meeting this was recorded for (Ultimate). Optional so older notes still load.
    var meeting: String?
    var title: String { meeting ?? transcript.map { String($0.prefix(60)) } ?? "Voice note" }
}

@MainActor
final class VoiceNotesModel: NSObject, ObservableObject, AVAudioRecorderDelegate {
    static let shared = VoiceNotesModel()

    @Published private(set) var notes: [VoiceNote] = []
    @Published private(set) var isRecording = false
    @Published private(set) var level: Float = 0
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var busy: Set<UUID> = []
    @Published var message: String?
    /// Set when a recording is started from a calendar event; the note made from it remembers the meeting.
    @Published private(set) var meetingTitle: String?

    private var recorder: AVAudioRecorder?
    private var meter: Timer?
    private var player: AVAudioPlayer?
    @Published private(set) var playingID: UUID?

    static var folder: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Notch apple/Voice Notes", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
    private static var indexURL: URL { folder.appendingPathComponent("notes.json") }

    override init() {
        super.init()
        notes = (try? JSONDecoder().decode([VoiceNote].self, from: Data(contentsOf: Self.indexURL))) ?? []
    }

    private func save() { try? JSONEncoder().encode(notes).write(to: Self.indexURL, options: .atomic) }

    var liveActivity: LiveActivity? {
        isRecording ? LiveActivity(symbol: "waveform", label: CountdownTimer.short(elapsed), tint: .systemPink) : nil
    }

    // MARK: Recording

    func toggle() { isRecording ? stop() : start() }

    /// Starts recording for a calendar meeting (Ultimate). The note is named after it and gets a meeting-style summary.
    func startMeeting(title: String) {
        guard !isRecording, Entitlements.shared.canUse(.meetingSummaries) else { return }
        meetingTitle = title
        start()
        if !isRecording { meetingTitle = nil }
    }

    func start() {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: break
        case .notDetermined:
            NSApp.activate(ignoringOtherApps: true)
            AVCaptureDevice.requestAccess(for: .audio) { ok in
                DispatchQueue.main.async { if ok { self.start() } else { self.message = "Microphone access was declined." } }
            }
            return
        default:
            message = "Allow the microphone for Notch apple in System Settings → Privacy & Security → Microphone."
            PermissionsModel.openPrivacy("Privacy_Microphone")
            return
        }
        let name = "note-\(Int(Date.now.timeIntervalSince1970)).m4a"
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44_100, AVNumberOfChannelsKey: 1,
                                       AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue]
        do {
            let r = try AVAudioRecorder(url: Self.folder.appendingPathComponent(name), settings: settings)
            r.isMeteringEnabled = true
            r.delegate = self
            guard r.record() else { message = "Couldn't start recording."; return }
            recorder = r
            isRecording = true
            elapsed = 0
            let t = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self, let r = self.recorder else { return }
                    r.updateMeters()
                    self.level = max(0, min(1, (r.averagePower(forChannel: 0) + 50) / 50))
                    self.elapsed = r.currentTime
                    if Int(self.elapsed * 10) % 5 == 0 { LiveActivityCenter.shared.recompute() }
                }
            }
            t.tolerance = 0.03
            RunLoop.main.add(t, forMode: .common)
            meter = t
            LiveActivityCenter.shared.recompute()
        } catch {
            message = "Couldn't start recording: \(error.localizedDescription)"
        }
    }

    func stop() {
        guard let r = recorder else { return }
        let duration = r.currentTime
        let name = r.url.lastPathComponent
        r.stop()
        recorder = nil
        meter?.invalidate()
        meter = nil
        isRecording = false
        level = 0
        LiveActivityCenter.shared.recompute()
        let note = VoiceNote(duration: duration, fileName: name, meeting: meetingTitle)
        meetingTitle = nil
        notes.insert(note, at: 0)
        save()
        transcribe(note)
    }

    // MARK: Transcription (on-device when possible)

    func transcribe(_ note: VoiceNote) {
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    self.message = "Allow Speech Recognition for Notch apple in System Settings → Privacy & Security."
                    PermissionsModel.openPrivacy("Privacy_SpeechRecognition")
                    return
                }
                self.runTranscription(note)
            }
        }
    }

    private func runTranscription(_ note: VoiceNote) {
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else { message = "Speech recognition isn't available right now."; return }
        let request = SFSpeechURLRecognitionRequest(url: Self.folder.appendingPathComponent(note.fileName))
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        request.addsPunctuation = true
        busy.insert(note.id)
        recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let result, result.isFinal || error != nil {
                    self.update(note.id) { $0.transcript = result.bestTranscription.formattedString }
                    self.busy.remove(note.id)
                } else if error != nil {
                    self.update(note.id) { $0.transcript = $0.transcript ?? "" }
                    self.busy.remove(note.id)
                    self.message = "Couldn't transcribe that one (was anything said?)."
                }
            }
        }
    }

    // MARK: AI summary

    func summarise(_ note: VoiceNote) {
        guard let text = note.transcript, !text.isEmpty else { return }
        busy.insert(note.id)
        let prompt = note.meeting.map { MeetingSummaryLogic.prompt(title: $0, transcript: text) } ?? """
        Summarise this voice note. Reply with a one-line title, then 2–4 short bullet points, then "Action items:" with any to-dos (or "none").

        \(text)
        """
        let config = AIConfig.shared
        Task {
            do {
                let reply = try await AIClient.send([ChatMessage(role: .user, text: prompt)], provider: config.provider, model: config.model)
                update(note.id) { $0.summary = reply.trimmingCharacters(in: .whitespacesAndNewlines) }
            } catch {
                message = "AI summary failed: \(error.localizedDescription). Check Settings → AI."
            }
            busy.remove(note.id)
        }
    }

    // MARK: Playback and housekeeping

    func play(_ note: VoiceNote) {
        if playingID == note.id { player?.stop(); playingID = nil; return }
        player = try? AVAudioPlayer(contentsOf: Self.folder.appendingPathComponent(note.fileName))
        player?.play()
        playingID = player == nil ? nil : note.id
        let length = player?.duration ?? 0
        DispatchQueue.main.asyncAfter(deadline: .now() + length + 0.2) { [weak self] in
            if self?.playingID == note.id && self?.player?.isPlaying != true { self?.playingID = nil }
        }
    }

    func delete(_ note: VoiceNote) {
        try? FileManager.default.removeItem(at: Self.folder.appendingPathComponent(note.fileName))
        notes.removeAll { $0.id == note.id }
        save()
    }

    /// Adds a meeting's summary to its note in Notes (making the note if there isn't one yet).
    func addToMeetingNotes(_ note: VoiceNote) {
        guard let title = note.meeting, let summary = note.summary, !summary.isEmpty else { return }
        let day = note.date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated))
        let time = note.date.formatted(date: .omitted, time: .shortened)
        let meetingNote = NotesStore.shared.noteForMeeting(title: title, day: day, time: time)
        if meetingNote.text.contains(summary.trimmingCharacters(in: .whitespacesAndNewlines)) { message = "Already in your meeting notes"; return }
        NotesStore.shared.update(meetingNote.id, text: meetingNote.text + MeetingSummaryLogic.noteSection(summary: summary))
        message = "Added to your meeting notes"
    }

    func copy(_ note: VoiceNote) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString([note.summary, note.transcript].compactMap { $0 }.joined(separator: "\n\n"), forType: .string)
        message = "Copied"
    }

    private func update(_ id: UUID, _ change: (inout VoiceNote) -> Void) {
        guard let i = notes.firstIndex(where: { $0.id == id }) else { return }
        change(&notes[i])
        save()
    }
}

struct VoiceNotesView: View {
    @StateObject private var model = VoiceNotesModel.shared
    @State private var selected: UUID?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            GlassCard {
                VStack(spacing: 12) {
                    Button(action: model.toggle) {
                        ZStack {
                            Circle().fill(model.isRecording ? AnyShapeStyle(Color.red.gradient) : AnyShapeStyle(Theme.accentGradient))
                                .frame(width: 84, height: 84)
                                .scaleEffect(model.isRecording ? 1 + CGFloat(model.level) * 0.18 : 1)
                                .animation(.easeOut(duration: 0.1), value: model.level)
                                .shadow(color: (model.isRecording ? Color.red : Theme.accent).opacity(0.5), radius: 16)
                            Image(systemName: model.isRecording ? "stop.fill" : "mic.fill").font(.system(size: 30, weight: .bold)).foregroundStyle(.white)
                        }
                    }
                    .buttonStyle(.plain)
                    .help(model.isRecording ? "Stop and transcribe" : "Start a voice note")
                    Text(model.isRecording ? CountdownTimer.long(model.elapsed) : "Tap to record")
                        .font(.system(size: 15, weight: .semibold, design: .rounded)).monospacedDigit().foregroundStyle(.white)
                    if model.isRecording, model.meetingTitle != nil {
                        Text(MeetingSummaryLogic.consentReminder).font(.system(size: 10, weight: .semibold)).foregroundStyle(.yellow).multilineTextAlignment(.center)
                    }
                    Text("Transcribed on your Mac. Summaries use your AI from Settings → AI. It records your microphone.")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
                    if let m = model.message { Text(m).font(.system(size: 10)).foregroundStyle(.orange).multilineTextAlignment(.center) }
                }
                .frame(maxWidth: .infinity)
            }
            .frame(width: 190)

            ScrollView {
                VStack(spacing: 6) {
                    if model.notes.isEmpty {
                        Text("Your voice notes appear here with their transcript.").font(.system(size: 12))
                            .foregroundStyle(Theme.textSecondary).padding(.top, 30)
                    }
                    ForEach(model.notes) { note in row(note) }
                }
            }
        }
    }

    private func row(_ note: VoiceNote) -> some View {
        let open = selected == note.id
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                IconButton(systemImage: model.playingID == note.id ? "stop.circle.fill" : "play.circle.fill", help: "Play") { model.play(note) }
                VStack(alignment: .leading, spacing: 1) {
                    Text(note.title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1)
                    Text("\(note.date.formatted(date: .abbreviated, time: .shortened)) · \(CountdownTimer.long(note.duration))")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                if model.busy.contains(note.id) { ProgressView().controlSize(.small) }
                IconButton(systemImage: "sparkles", help: "Summarise with AI") { model.summarise(note); selected = note.id }
                    .disabled(note.transcript?.isEmpty ?? true)
                if note.meeting != nil, note.summary != nil {
                    IconButton(systemImage: "note.text.badge.plus", help: "Add the summary to this meeting's note") { model.addToMeetingNotes(note) }
                }
                IconButton(systemImage: "doc.on.doc", help: "Copy transcript and summary") { model.copy(note) }
                IconButton(systemImage: open ? "chevron.up" : "chevron.down", help: "Show text") { selected = open ? nil : note.id }
                IconButton(systemImage: "trash", help: "Delete") { model.delete(note) }
            }
            if open {
                if let summary = note.summary {
                    Text(LocalizedStringKey(summary)).font(.system(size: 12)).foregroundStyle(.white).textSelection(.enabled)
                        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.accent.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
                }
                Text(note.transcript ?? "Transcribing…").font(.system(size: 12)).foregroundStyle(Theme.textSecondary).textSelection(.enabled)
            }
        }
        .padding(8)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
    }
}
