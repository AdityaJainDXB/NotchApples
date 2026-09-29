//
//  NotchTranslatorView.swift
//  Notch apple
//
//  The Translator tab: type on the left, read the translation and its
//  pronunciation on the right. Arabic, English, French, Spanish, Hindi,
//  Mandarin and German, with a swap button, speech and copy.
//

import SwiftUI

struct NotchTranslatorView: View {
    @StateObject private var model = TranslationManager.shared
    @State private var copied = false

    var body: some View {
        VStack(spacing: 10) {
            languageBar
            HStack(alignment: .top, spacing: 12) {
                inputCard
                VStack(spacing: 10) {
                    outputCard
                    if !model.phonetic.isEmpty { phoneticCard }
                }
            }
        }
    }

    // MARK: Language bar

    private var languageBar: some View {
        HStack(spacing: 8) {
            picker("From", selection: $model.source)
            Button { withAnimation(Theme.spring) { model.swapLanguages() } } label: {
                Image(systemName: "arrow.left.and.right").font(.system(size: 13, weight: .semibold))
                    .frame(width: Theme.minTarget, height: Theme.minTarget)
                    .background(Theme.surface, in: Circle())
            }
            .buttonStyle(.plain).help("Swap languages").accessibilityLabel("Swap languages")
            picker("To", selection: $model.target)
            Spacer()
            if model.isTranslating { ProgressView().controlSize(.small) }
        }
    }

    private func picker(_ label: String, selection: Binding<TranslationLanguage>) -> some View {
        Picker(label, selection: selection) {
            ForEach(TranslationLanguage.allCases) { Text($0.name).tag($0) }
        }
        .pickerStyle(.menu).labelsHidden().frame(width: 130)
        .accessibilityLabel(label)
    }

    // MARK: Cards

    private var inputCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(model.source.name).sectionTitle()
                    Spacer()
                    Text("\(model.input.count)/\(TranslationManager.characterLimit)")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    if !model.input.isEmpty {
                        Button { model.input = "" } label: { Image(systemName: "xmark.circle.fill") }
                            .buttonStyle(.plain).foregroundStyle(Theme.textSecondary).help("Clear")
                    }
                }
                ZStack(alignment: .topLeading) {
                    TextEditor(text: Binding(get: { model.input },
                                             set: { model.input = String($0.prefix(TranslationManager.characterLimit)) }))
                        .font(.system(size: 15)).scrollContentBackground(.hidden)
                        .accessibilityLabel("Text to translate")
                    if model.input.isEmpty {
                        Text("Type or paste text…").font(.system(size: 15)).foregroundStyle(Theme.textSecondary)
                            .padding(.top, 8).padding(.leading, 5).allowsHitTesting(false)
                    }
                }
            }
        }
    }

    private var outputCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(model.target.name).sectionTitle()
                    Spacer()
                    IconButton(systemImage: model.isSpeaking ? "stop.fill" : "speaker.wave.2.fill",
                               help: model.hasVoiceForTarget ? "Read aloud" : "No \(model.target.name) voice installed") {
                        model.speakOutput()
                    }
                    .disabled(model.output.isEmpty || !model.hasVoiceForTarget)
                    IconButton(systemImage: copied ? "checkmark" : "doc.on.doc", help: "Copy translation") { copy(model.output) }
                        .disabled(model.output.isEmpty)
                }
                if let error = model.errorMessage {
                    Label(error, systemImage: "exclamationmark.triangle.fill").font(.system(size: 12)).foregroundStyle(.orange)
                } else if model.output.isEmpty {
                    Text("The translation appears here.").font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                } else {
                    ScrollView {
                        Text(model.output).font(.system(size: 16, weight: .medium)).foregroundStyle(.white)
                            .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                            .environment(\.layoutDirection, model.target == .arabic ? .rightToLeft : .leftToRight)
                    }
                }
            }
        }
    }

    private var phoneticCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Label(model.target.phoneticTitle, systemImage: "waveform").sectionTitle()
                    Spacer()
                    IconButton(systemImage: "doc.on.doc", help: "Copy pronunciation") { copy(model.phonetic) }
                }
                ScrollView {
                    Text(model.phonetic).font(.system(size: 14)).italic().foregroundStyle(Theme.accentBright)
                        .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .frame(maxHeight: 96)
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        withAnimation { copied = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { withAnimation { copied = false } }
    }
}
