//
//  NotchAIVoiceView.swift
//  Notch Apple
//
//  The Voice section of the NotchAI tab: Talk (push-to-talk), the live caption, the state, and the voice settings
//  (engine, voice, speed, pitch, volume, preview, speak replies). The microphone indicator shows only while the
//  microphone is actually open.
//

import SwiftUI

struct NotchAIVoiceView: View {
    @ObservedObject private var voice = NotchAIVoice.shared
    @ObservedObject private var input = VoiceInput.shared
    @ObservedObject private var convo = NotchAIConversation.shared
    @ObservedObject private var dictation = NotchAIDictation.shared
    @ObservedObject private var notifier = NotchAINotifier.shared
    @State private var heard = ""
    @State private var meant = ""

    private var voices: [SpeechVoice] { voice.provider.listVoices() }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                talkRow
                if let p = voice.problem {
                    Label(p, systemImage: "exclamationmark.triangle.fill").font(.system(size: 11)).foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if !voice.caption.isEmpty {
                    Text(voice.caption).font(.system(size: 12)).foregroundStyle(.white).lineLimit(4)
                        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 8))
                }
                Divider().opacity(0.3)
                HStack {
                    Text("Voice engine").font(.system(size: 11)).foregroundStyle(.white).frame(width: 100, alignment: .leading)
                    Picker("", selection: $voice.providerID) {
                        ForEach(voice.providers, id: \.id) { Text($0.displayName).tag($0.id) }
                    }.labelsHidden()
                }
                if !voice.provider.runsLocally {
                    Label(ModelLocality.allowCloud ? "Cloud voice: the text of each answer is sent to Google to be spoken."
                                                   : "Cloud voice, blocked: Local first is on. Allow cloud models in Settings → AI to use it.",
                          systemImage: "cloud.fill").font(.system(size: 10)).foregroundStyle(.orange)
                }
                HStack {
                    Text("Voice").font(.system(size: 11)).foregroundStyle(.white).frame(width: 100, alignment: .leading)
                    Picker("", selection: $voice.voiceID) {
                        Text("Default").tag("")
                        ForEach(voices) { Text("\($0.name) (\($0.language))").tag($0.id) }
                    }.labelsHidden()
                    Button("Preview") { voice.previewVoice() }
                    Button("Stop") { voice.stopSpeaking() }.disabled(voice.state != .speaking)
                }
                slider("Speed", $voice.speed, 0.5...2, "\(String(format: "%.1f", voice.speed))×", enabled: voice.provider.id == "apple")
                slider("Pitch", $voice.pitch, 0.5...2, "\(String(format: "%.1f", voice.pitch))×", enabled: voice.provider.id == "apple")
                slider("Volume", $voice.volume, 0...1, "\(Int(voice.volume * 100))%", enabled: true)
                Toggle("Speak every answer aloud", isOn: $voice.speakReplies).toggleStyle(.switch).controlSize(.small)
                Toggle("Live captions while NotchAI speaks", isOn: $notifier.captions).toggleStyle(.switch).controlSize(.small)
                Text("Shortcut: ⌃⌥V starts and ends Talk from any app.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                Divider().opacity(0.3)
                Text("Dictation into other apps").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                HStack {
                    Button(dictation.listening ? "Done" : "Dictate") { dictation.toggle() }.tint(NotchAIView.green)
                    Button("Insert") { dictation.insert() }.disabled(dictation.text.isEmpty || dictation.listening)
                    Button("Cancel") { dictation.cancel() }.disabled(dictation.text.isEmpty && !dictation.listening)
                    if let s = dictation.status { Text(s).font(.system(size: 10)).foregroundStyle(Theme.textSecondary) }
                }
                TextField("Dictated text appears here. You can edit it before inserting.", text: $dictation.text, axis: .vertical)
                    .textFieldStyle(.roundedBorder).lineLimit(2...5)
                HStack {
                    TextField("Heard as…", text: $heard).textFieldStyle(.roundedBorder)
                    TextField("Should be…", text: $meant).textFieldStyle(.roundedBorder)
                    Button("Add word") { dictation.setWord(heard, meaning: meant); heard = ""; meant = "" }.disabled(heard.isEmpty || meant.isEmpty)
                }
                ForEach(dictation.vocabulary.sorted { $0.key < $1.key }, id: \.key) { k, v in
                    HStack { Text("\(k) → \(v)").font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.textSecondary); Spacer()
                        Button { dictation.removeWord(k) } label: { Image(systemName: "xmark.circle") }.buttonStyle(.plain) }
                }
                Text("Say “comma”, “period”, “question mark”, “new line”, “new paragraph”. Text goes only into the field you choose, through Accessibility (never the clipboard).")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                Divider().opacity(0.3)
                Text("Alerts").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                Toggle("Notify me when a task finishes or needs approval", isOn: Binding(get: { notifier.notify }, set: { notifier.notify = $0; if $0 { notifier.requestPermission() } }))
                    .toggleStyle(.switch).controlSize(.small)
                Toggle("Play a chime", isOn: $notifier.chime).toggleStyle(.switch).controlSize(.small)
                Toggle("Say it aloud", isOn: $notifier.speak).toggleStyle(.switch).controlSize(.small)
                Toggle("Quiet mode (no sounds or speech)", isOn: $notifier.quietManual).toggleStyle(.switch).controlSize(.small)
                Text("Sounds and speech also stay off while Zoom, Teams, FaceTime or Webex is in front. macOS Focus decides whether banners appear.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                Text("Speech recognition and the voice run on this Mac by default. Talk opens the microphone only until you stop speaking; it needs Microphone and Speech Recognition permission. The AI model, the speech recogniser and the voice are separate choices.")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private var talkRow: some View {
        HStack(spacing: 10) {
            Button {
                voice.talk()
            } label: {
                Label(NotchAIVoiceLogic.isCapturingAudio(voice.state) ? "Done" : (voice.state == .speaking ? "Interrupt and talk" : "Talk"),
                      systemImage: NotchAIVoiceLogic.isCapturingAudio(voice.state) ? "stop.circle.fill" : "mic.fill")
            }
            .buttonStyle(.borderedProminent).tint(NotchAIView.green)
            .disabled(convo.busy && voice.state != .speaking && !NotchAIVoiceLogic.isCapturingAudio(voice.state))
            if NotchAIVoiceLogic.isCapturingAudio(voice.state) || voice.state == .interrupted {
                Button("Cancel") { voice.cancelListening() }
            }
            Spacer()
            HStack(spacing: 5) {
                Circle().fill(NotchAIVoiceLogic.isCapturingAudio(voice.state) ? Color.red : Color.gray.opacity(0.5)).frame(width: 8, height: 8)
                Text(NotchAIVoiceLogic.isCapturingAudio(voice.state) ? "Microphone open" : "Microphone off")
                    .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                Text(voice.state.title).font(.system(size: 10, weight: .semibold))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(NotchAIView.green.opacity(voice.state == .idle ? 0.1 : 0.3), in: Capsule())
                    .foregroundStyle(.white)
            }
        }
    }

    private func slider(_ title: String, _ value: Binding<Double>, _ range: ClosedRange<Double>, _ label: String, enabled: Bool) -> some View {
        HStack {
            Text(title).font(.system(size: 11)).foregroundStyle(.white).frame(width: 100, alignment: .leading)
            Slider(value: value, in: range).disabled(!enabled)
            Text(enabled ? label : "n/a").font(.system(size: 10)).foregroundStyle(Theme.textSecondary).frame(width: 46, alignment: .trailing)
        }
    }
}
