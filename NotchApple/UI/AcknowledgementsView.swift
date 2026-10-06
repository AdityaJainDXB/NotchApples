//
//  AcknowledgementsView.swift
//  Notch apple
//
//  Credits for the open-source work Notch apple adapts, with each license's full text.
//  The text files are bundled from the repo's LICENSES/ folder.
//

import SwiftUI

struct AcknowledgementsView: View {
    @Environment(\.dismiss) private var dismiss

    private struct Credit: Identifiable {
        let id: String, name: String, author: String, license: String, use: String, file: String, url: String
    }

    private let credits = [
        Credit(id: "still", name: "Still", author: "Akshay Sharma and Kavish Shah", license: "MIT",
               use: "Lid Fold: projection math, gesture state, screen snapshot and Metal shader.",
               file: "Still-MIT", url: "https://github.com/kavishshahh"),
        Credit(id: "lid", name: "LidAngleSensor", author: "Sam Henri Gold", license: "Apache 2.0",
               use: "Lid Fold: how the lid-angle sensor is found and read.",
               file: "LidAngleSensor-Apache-2.0", url: "https://github.com/samhenrigold/LidAngleSensor"),
        Credit(id: "purge", name: "Purge", author: "Jithin Sabu", license: "MIT",
               use: "Cleaner: the safety allowlist, scan policies and delete rules.",
               file: "Purge-MIT", url: "https://github.com/jithin-sabu/purge-app")
    ]

    @State private var open: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Acknowledgements").font(.title2.bold())
                Spacer()
                Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
            }
            .padding(16)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Notch apple adapts work from these open-source projects. Each keeps its own license; the full text is below.")
                        .font(.callout).foregroundStyle(.secondary)
                    ForEach(credits) { c in
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(c.name).font(.headline)
                                Text(c.license).font(.caption.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 1)
                                    .background(Color.secondary.opacity(0.2), in: Capsule())
                                Spacer()
                                Link("Source", destination: URL(string: c.url)!).font(.caption)
                            }
                            Text("\(c.author). \(c.use)").font(.callout).foregroundStyle(.secondary)
                            DisclosureGroup("License text", isExpanded: Binding(get: { open == c.id }, set: { open = $0 ? c.id : nil })) {
                                Text(Self.text(c.file)).font(.system(size: 10, design: .monospaced))
                                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 4)
                            }
                            .font(.caption)
                        }
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.secondary.opacity(0.08)))
                    }
                }
                .padding(16)
            }
        }
        .frame(width: 560, height: 520)
    }

    private static func text(_ name: String) -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: "txt", subdirectory: "LICENSES")
                ?? Bundle.main.url(forResource: name, withExtension: "txt"),
              let s = try? String(contentsOf: url, encoding: .utf8) else {
            return "License text is bundled with the app. It was not found in this build."
        }
        return s
    }
}
