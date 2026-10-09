//
//  ConvertView.swift
//  Notch apple
//
//  The Convert tab (Ultimate): drop files (or choose them), check what each one is, pick what it should become, and
//  convert. Each result is saved next to the original. See ConvertEngine.
//

import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class ConvertStore: ObservableObject {
    static let shared = ConvertStore()

    enum Status { case ready, busy, done, failed }

    struct Item: Identifiable {
        let id = UUID()
        let url: URL
        let size: Int64
        var from: String?
        var to: String?
        var status = Status.ready
        var step = ""
        var output: URL?
        var error: String?
        var help: ConvertHelp?
    }

    /// Kept while the app runs, so switching tabs doesn't lose the list.
    @Published var items: [Item] = []
    @Published var tools = ConvertEngine.tools
    @AppStorage("convert.combine") var combine = false

    func add(_ urls: [URL]) {
        for url in urls where !items.contains(where: { $0.url == url }) {
            let size = Int64((try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
            let from = ConvertFormats.detect(url)
            items.append(Item(url: url, size: size, from: from, to: pick(from)))
        }
    }

    /// The last thing this format was turned into, or the best choice.
    func pick(_ from: String?) -> String? {
        guard let from else { return nil }
        let list = ConvertFormats.targets(from)
        let last = (UserDefaults.standard.dictionary(forKey: "convert.last") as? [String: String])?[from]
        return last.flatMap { list.contains($0) ? $0 : nil } ?? list.first
    }

    func remember(_ from: String, _ to: String) {
        var last = (UserDefaults.standard.dictionary(forKey: "convert.last") as? [String: String]) ?? [:]
        last[from] = to
        UserDefaults.standard.set(last, forKey: "convert.last")
    }

    func refreshTools() {
        ConvertEngine.refreshTools()
        tools = ConvertEngine.tools
    }

    func setFrom(_ id: UUID, _ from: String?) {
        update(id) { $0.from = from; $0.to = pick(from); $0.status = .ready }
    }

    func setTo(_ id: UUID, _ to: String) {
        update(id) { $0.to = to; $0.status = .ready }
        if let from = items.first(where: { $0.id == id })?.from { remember(from, to) }
    }

    func remove(_ id: UUID) { items.removeAll { $0.id == id && $0.status != .busy } }

    private func update(_ id: UUID, _ change: (inout Item) -> Void) {
        if let i = items.firstIndex(where: { $0.id == id }) { change(&items[i]) }
    }

    func run(_ id: UUID) async {
        guard let item = items.first(where: { $0.id == id }), let from = item.from, let to = item.to else { return }
        update(id) { $0.status = .busy; $0.step = "Starting…"; $0.error = nil; $0.help = nil }
        do {
            let out = try await ConvertEngine.convert(item.url, from: from, to: to) { [weak self] s in self?.update(id) { $0.step = s } }
            update(id) { $0.status = .done; $0.output = out }
        } catch {
            var help: ConvertHelp?
            if case ConvertError.needs(let h) = error { help = h }
            update(id) { $0.status = .failed; $0.error = error.localizedDescription; $0.help = help }
        }
    }

    var imagesToPDF: [Item] {
        items.filter { ConvertFormats.format($0.from ?? "")?.kind == .image && $0.to == "pdf" && $0.status != .busy && $0.status != .done }
    }

    func runAll() async {
        let images = imagesToPDF
        if combine, images.count > 1 {
            for i in images { update(i.id) { $0.status = .busy; $0.step = "Combining…" } }
            do {
                let out = try await ConvertEngine.combinePDF(images.map(\.url)) { [weak self] s in for i in images { self?.update(i.id) { $0.step = s } } }
                for i in images { update(i.id) { $0.status = .done; $0.output = out } }
            } catch {
                for i in images { update(i.id) { $0.status = .failed; $0.error = error.localizedDescription } }
            }
        }
        for item in items where (item.status == .ready || item.status == .failed) && item.from != nil && item.to != nil {
            await run(item.id)
        }
    }
}

struct ConvertView: View {
    @ObservedObject private var store = ConvertStore.shared
    @State private var targeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if store.items.isEmpty {
                dropZone
            } else {
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(store.items) { item in ConvertRow(item: item, store: store) }
                    }
                }
                footer
            }
        }
        .onDrop(of: [.fileURL], isTargeted: $targeted) { providers in
            for provider in providers {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    if let url { DispatchQueue.main.async { store.add([url]) } }
                }
            }
            return true
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 9).fill(Theme.accentGradient)
                Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
            }
            .frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 1) {
                Text("Convert").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                Text("Pictures, PDFs, documents, slides, tables, audio and video. Saved next to the original.")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
            Spacer(minLength: 4)
            chip(store.tools.keynote || store.tools.pages || store.tools.numbers, "iWork", "Keynote, Pages and Numbers convert slides, documents and sheets when they're installed.")
            chip(store.tools.libreOffice != nil, "LibreOffice", "Free. Converts old Office and OpenDocument files.")
            chip(store.tools.ffmpeg != nil, "FFmpeg", "Free. Converts MP3, Ogg, WebM, MKV and more audio and video.")
            Button { store.refreshTools() } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.plain).foregroundStyle(Theme.textSecondary)
                .help("Look for Keynote, Pages, Numbers, LibreOffice and FFmpeg again")
            Button("Choose files", action: choose).buttonStyle(PurpleButtonStyle())
        }
    }

    private func chip(_ on: Bool, _ name: String, _ help: String) -> some View {
        Text("\(on ? "✓" : "–") \(name)")
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(on ? Color.green : Theme.textSecondary)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(Capsule().fill(on ? Color.green.opacity(0.14) : Theme.surface))
            .help(help)
    }

    private var dropZone: some View {
        VStack(spacing: 5) {
            Image(systemName: "tray.and.arrow.down.fill").font(.system(size: 26)).foregroundStyle(targeted ? Theme.accentBright : Theme.textSecondary)
            Text("Drop files here").font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
            Text("or click to choose them. PPTX → PDF, HEIC → JPG, DOCX → PDF, MOV → MP4, PNG → ICO, XLSX → CSV, PDF → pictures and more.")
                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(RoundedRectangle(cornerRadius: 12).fill(targeted ? Theme.accent.opacity(0.15) : Color.clear))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(targeted ? Theme.accent : Theme.textSecondary.opacity(0.35), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
        .contentShape(Rectangle())
        .onTapGesture(perform: choose)
    }

    private var footer: some View {
        let all = Array(Set(store.items.compactMap(\.from).flatMap(ConvertFormats.targets))).sorted()
        return HStack(spacing: 8) {
            Menu("Make them all…") {
                ForEach(all, id: \.self) { f in
                    Button(ConvertFormats.label(f)) {
                        for i in store.items.indices where store.items[i].status != .busy {
                            if let from = store.items[i].from, ConvertFormats.targets(from).contains(f) { store.items[i].to = f; store.items[i].status = .ready }
                        }
                    }
                }
            }
            .menuStyle(.borderlessButton).fixedSize().font(.system(size: 11))
            if store.imagesToPDF.count > 1 {
                Toggle("Combine the pictures into one PDF", isOn: $store.combine).toggleStyle(.checkbox).font(.system(size: 11))
            }
            Spacer()
            Button("Clear") { store.items.removeAll { $0.status != .busy } }
                .buttonStyle(PurpleButtonStyle(prominent: false))
            Button(store.items.count > 1 ? "Convert all" : "Convert") { Task { await store.runAll() } }
                .buttonStyle(PurpleButtonStyle())
                .disabled(!store.items.contains { $0.from != nil && $0.to != nil && ($0.status == .ready || $0.status == .failed) })
        }
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = true
        panel.message = "Choose files to convert"
        NSApp.activate(ignoringOtherApps: true)
        if panel.runModal() == .OK { store.add(panel.urls) }
    }
}

private struct ConvertRow: View {
    let item: ConvertStore.Item
    @ObservedObject var store: ConvertStore

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: ConvertFormats.format(item.from ?? "")?.kind.symbol ?? "questionmark.square.dashed")
                    .font(.system(size: 15)).foregroundStyle(Theme.accentBright).frame(width: 20)
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.url.lastPathComponent).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white).lineLimit(1).truncationMode(.middle)
                    Text(subtitle).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
                .help(item.url.path)
                Spacer(minLength: 4)
                fromPicker
                Image(systemName: "arrow.right").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.textSecondary)
                toPicker
                action.frame(minWidth: 72, alignment: .trailing)
                Button { store.remove(item.id) } label: { Image(systemName: "xmark").font(.system(size: 10, weight: .bold)) }
                    .buttonStyle(.plain).foregroundStyle(Theme.textSecondary).help("Remove from the list")
                    .disabled(item.status == .busy)
            }
            if item.status == .failed, let error = item.error {
                HStack(spacing: 8) {
                    Text(error).font(.system(size: 11)).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    if let command = item.help?.command {
                        Button("Copy install command") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(command, forType: .string)
                        }
                        .buttonStyle(PurpleButtonStyle(prominent: false)).help("Paste it in Terminal: \(command)")
                    }
                    if let help = item.help, let link = help.link {
                        Button(help.button) { NSWorkspace.shared.open(link) }.buttonStyle(PurpleButtonStyle())
                    }
                }
            }
        }
        .padding(.horizontal, 9).padding(.vertical, 7)
        .background(RoundedRectangle(cornerRadius: 11).fill(Theme.surface))
        .overlay(RoundedRectangle(cornerRadius: 11).strokeBorder(item.status == .failed ? Color.red.opacity(0.5) : .clear, lineWidth: 1))
    }

    private var subtitle: String {
        let size = item.size > 0 ? ByteCountFormatter.string(fromByteCount: item.size, countStyle: .file) : ""
        if item.status == .done, let out = item.output { return [size, "→ \(out.lastPathComponent)"].filter { !$0.isEmpty }.joined(separator: " · ") }
        return size
    }

    private var fromPicker: some View {
        Picker("", selection: Binding(get: { item.from ?? "" }, set: { v in store.setFrom(item.id, v.isEmpty ? nil : v) })) {
            if item.from == nil { Text("Unknown: choose…").tag("") }
            ForEach(ConvertKind.allCases, id: \.self) { kind in
                Section(kind.title) {
                    ForEach(ConvertFormats.all.filter { $0.kind == kind }, id: \.id) { f in Text(ConvertFormats.label(f.id)).tag(f.id) }
                }
            }
        }
        .labelsHidden().pickerStyle(.menu).frame(width: 150).controlSize(.small)
        .help("What this file is")
        .disabled(item.status == .busy)
    }

    private var toPicker: some View {
        let targets = ConvertFormats.targets(item.from ?? "")
        return Picker("", selection: Binding(get: { item.to ?? "" }, set: { v in store.setTo(item.id, v) })) {
            if targets.isEmpty { Text("—").tag("") }
            ForEach(targets, id: \.self) { f in Text(ConvertFormats.label(f)).tag(f) }
        }
        .labelsHidden().pickerStyle(.menu).frame(width: 150).controlSize(.small)
        .help("What it should become")
        .disabled(targets.isEmpty || item.status == .busy)
    }

    @ViewBuilder private var action: some View {
        switch item.status {
        case .busy:
            HStack(spacing: 5) {
                ProgressView().controlSize(.small)
                Text(item.step).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).lineLimit(1)
            }
        case .done:
            HStack(spacing: 4) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                if let out = item.output {
                    Button("Open") { NSWorkspace.shared.open(out) }.buttonStyle(PurpleButtonStyle(prominent: false))
                    Button("Show") { NSWorkspace.shared.activateFileViewerSelecting([out]) }.buttonStyle(PurpleButtonStyle(prominent: false))
                }
            }
        default:
            Button("Convert") { Task { await store.run(item.id) } }
                .buttonStyle(PurpleButtonStyle())
                .disabled(item.from == nil || item.to == nil)
        }
    }
}
