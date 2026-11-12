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
