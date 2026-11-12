//
//  NotchAIVisual.swift
//  Notch Apple
//
//  Visual explanations (free): type a topic, the model sketches a simple 3D illustration (validated first, see
//  NotchAIVisualLogic), and you can rotate and zoom it, click a part to see what the sketch says about it, and ask the
//  chat about that part. It is always labelled as a generated illustration, not a factual source. The model call goes
//  through the Local-first guard like any other.
//
//  Two more kinds live here too: a diagram (boxes and arrows the model describes, validated and laid out by
//  DiagramLogic), and a real 3D file of your own (USDZ, OBJ and others) that you can turn around and whose named
//  parts you can click and ask about. A file is yours, so it is labelled with its name, not as a generated sketch.
//

import AppKit
import ModelIO
import SceneKit
import SceneKit.ModelIO
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class NotchAIVisual: ObservableObject {
    static let shared = NotchAIVisual()
    @Published private(set) var spec: VisualSpec?
    @Published private(set) var scene: SCNScene?
    @Published var selected: VisualPart?
    @Published private(set) var status: String?
    @Published private(set) var working = false
    @Published private(set) var diagram: DiagramSpec?
    @Published var selectedNode: DiagramNode?
    /// A 3D file the user opened: its scene, its name and the readable names of its parts.
    @Published private(set) var fileScene: SCNScene?
    @Published private(set) var fileName = ""
    @Published private(set) var fileParts: [String] = []
    @Published var selectedFilePart: String?

    func generateDiagram(topic: String) {
        let t = topic.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !working else { return }
        working = true; status = nil; selectedNode = nil
        Task {
            defer { working = false }
            do {
                let reply = try await AgentModelClient.complete(agent: "research", system: "You draw accurate, simple diagrams as JSON.", user: DiagramLogic.prompt(topic: t))
                switch DiagramLogic.parse(reply) {
                case .success(let d): diagram = d
                case .failure(let e): status = e.localizedDescription
                }
            } catch { status = error.localizedDescription }
        }
    }

    func askAboutNode() {
        guard let n = selectedNode, let d = diagram else { return }
        NotchAIConversation.shared.send(DiagramLogic.nodeQuestion(n, in: d), display: "About “\(n.label)” in the \(d.title) diagram")
        NotchAINav.shared.section = .chat
    }

    // MARK: A 3D file of the user's own

    func chooseFile() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.allowedContentTypes = ModelFileLogic.extensions.compactMap { UTType(filenameExtension: $0) }
        panel.message = "Choose a 3D model (USDZ, OBJ, DAE, STL…)"
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        open(url)
    }

    func open(_ url: URL) {
        status = nil; selectedFilePart = nil
        let bytes = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if let p = ModelFileLogic.problem(fileName: url.lastPathComponent, bytes: bytes) { status = p; return }
        var loaded = try? SCNScene(url: url, options: [.checkConsistency: false])
        if loaded == nil || loaded?.rootNode.childNodes.isEmpty == true {
            // Model I/O reads formats SceneKit does not open by itself (STL, PLY, Alembic).
            let asset = MDLAsset(url: url)
            if asset.count > 0 { loaded = SCNScene(mdlAsset: asset) }
        }
        guard let scene = loaded, !scene.rootNode.childNodes.isEmpty else { status = "That file could not be opened as a 3D model."; return }
        scene.background.contents = NSColor(srgbRed: 0.08, green: 0.04, blue: 0.18, alpha: 1)
        var names: [String] = []
        scene.rootNode.enumerateHierarchy { node, _ in if let n = node.name, node.geometry != nil || !node.childNodes.isEmpty { names.append(n) } }
        fileScene = scene
        fileName = url.lastPathComponent
        fileParts = ModelFileLogic.partNames(names)
    }

    /// A click on the model: the nearest node up the tree whose name says something.
    func pickFilePart(_ raw: String?) {
        selectedFilePart = raw.map(ModelFileLogic.displayName).flatMap { $0.isEmpty ? nil : $0 }
    }

    func askAboutFilePart() {
        guard let part = selectedFilePart, !fileName.isEmpty else { return }
        NotchAIConversation.shared.send(ModelFileLogic.partQuestion(part: part, fileName: fileName), display: "About “\(part)” in \(fileName)")
        NotchAINav.shared.section = .chat
    }

    func generate(topic: String) {
        let t = topic.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !working else { return }
        working = true; status = nil; selected = nil
        Task {
            defer { working = false }
            do {
                let reply = try await AgentModelClient.complete(agent: "research", system: "You make accurate, simple 3D sketches as JSON.", user: VisualLogic.prompt(topic: t))
                switch VisualLogic.parse(reply) {
                case .success(let s): spec = s; scene = VisualSceneBuilder.scene(for: s)
                case .failure(let e): status = e.localizedDescription
                }
            } catch { status = error.localizedDescription }
        }
    }

    func pick(_ name: String?) { selected = name.flatMap { n in spec?.parts.first { $0.name == n } } }

    func askAboutSelection() {
        guard let part = selected, let spec else { return }
        NotchAIConversation.shared.send(VisualLogic.partQuestion(part: part, in: spec), display: "About “\(part.name)” in the \(spec.title) sketch")
        NotchAINav.shared.section = .chat
    }
}

struct VisualSceneView: NSViewRepresentable {
    let scene: SCNScene
    let onPick: (String?) -> Void

    func makeNSView(context: Context) -> SCNView {
        let v = SCNView()
        v.scene = scene
        v.allowsCameraControl = true          // rotate, pan and zoom with the mouse or trackpad
        v.autoenablesDefaultLighting = true   // a file with no lights of its own is still visible
        v.backgroundColor = .clear
        v.antialiasingMode = .multisampling4X
        v.addGestureRecognizer(NSClickGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.click(_:))))
        return v
    }

    func updateNSView(_ v: SCNView, context: Context) { if v.scene !== scene { v.scene = scene }; context.coordinator.onPick = onPick }
    func makeCoordinator() -> Coordinator { Coordinator(onPick) }

    final class Coordinator: NSObject {
        var onPick: (String?) -> Void
        init(_ onPick: @escaping (String?) -> Void) { self.onPick = onPick }
        @objc func click(_ g: NSClickGestureRecognizer) {
            guard let v = g.view as? SCNView else { return }
            var hit = v.hitTest(g.location(in: v), options: nil).first?.node
            // A model file often names the group, not the mesh: walk up to the first name that says something.
            while let h = hit, ModelFileLogic.displayName(h.name ?? "").isEmpty, let parent = h.parent { hit = parent }
            onPick(hit?.name)
        }
    }
}

struct NotchAIVisualView: View {
    enum Mode: String, CaseIterable, Identifiable { case sketch = "3D sketch", diagram = "Diagram", file = "3D file"; var id: String { rawValue } }

    @ObservedObject private var visual = NotchAIVisual.shared
    @State private var topic = ""
    @AppStorage("notchai.visual.mode") private var modeRaw = Mode.sketch.rawValue
    private var mode: Mode { Mode(rawValue: modeRaw) ?? .sketch }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("", selection: $modeRaw) { ForEach(Mode.allCases) { Text($0.rawValue).tag($0.rawValue) } }
                .pickerStyle(.segmented).labelsHidden().frame(width: 280)
            switch mode {
            case .sketch: sketch
            case .diagram: diagramPane
            case .file: filePane
            }
        }
    }

    private func make() { if mode == .diagram { visual.generateDiagram(topic: topic) } else { visual.generate(topic: topic) } }

    private func askRow(_ hint: String) -> some View {
        HStack {
            TextField(hint, text: $topic).textFieldStyle(.roundedBorder).foregroundStyle(Theme.textPrimary).onSubmit { make() }
            Button("Make it") { make() }.disabled(visual.working || topic.trimmingCharacters(in: .whitespaces).isEmpty)
            if visual.working { ProgressView().controlSize(.small) }
        }
    }

    @ViewBuilder private var statusLine: some View {
        if let s = visual.status { Text(s).font(.system(size: 11)).foregroundStyle(.orange) }
    }

    private var generatedNote: some View {
        Label("A generated illustration, not a factual source.", systemImage: "sparkles").font(.system(size: 9)).foregroundStyle(.orange)
    }

    @ViewBuilder private var sketch: some View {
        askRow("What should it show? (e.g. a water molecule, the layers of the Earth)")
        statusLine
        if let spec = visual.spec, let scene = visual.scene {
            HStack(alignment: .top, spacing: 10) {
                VisualSceneView(scene: scene) { visual.pick($0) }
                    .frame(minHeight: 200).clipShape(RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 6) {
                    Text(spec.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    Text(spec.explanation).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    if let p = visual.selected {
                        Text(p.name).font(.system(size: 12, weight: .semibold)).foregroundStyle(NotchAIView.green)
                        Text(p.info.isEmpty ? "No note for this part." : p.info).font(.system(size: 11)).foregroundStyle(.white)
                        Button("Ask NotchAI about this part") { visual.askAboutSelection() }.controlSize(.small)
                    } else { Text("Drag to rotate, scroll to zoom, click a part.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary) }
                    Spacer()
                    generatedNote
                }
                .frame(width: 230, alignment: .leading)
            }
        } else {
            Text("Describe a topic and NotchAI sketches a simple 3D model you can turn around and ask questions about. The sketch is the model's own simplification, so check facts elsewhere.")
                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
        }
    }

    @ViewBuilder private var diagramPane: some View {
        askRow("What should it explain? (e.g. how a bill becomes law, the water cycle)")
        statusLine
        if let d = visual.diagram {
            HStack(alignment: .top, spacing: 10) {
                DiagramView(spec: d, selected: visual.selectedNode?.id) { id in visual.selectedNode = d.nodes.first { $0.id == id } }
                    .frame(minHeight: 200).background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 6) {
                    Text(d.title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    Text(d.explanation).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    if let n = visual.selectedNode {
                        Text(n.label).font(.system(size: 12, weight: .semibold)).foregroundStyle(NotchAIView.green)
                        Text(n.info.isEmpty ? "No note for this box." : n.info).font(.system(size: 11)).foregroundStyle(.white)
                        Button("Ask NotchAI about this box") { visual.askAboutNode() }.controlSize(.small)
                    } else { Text("Click a box to read about it.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary) }
                    Spacer()
                    generatedNote
                }
                .frame(width: 230, alignment: .leading)
            }
        } else {
            Text("Describe a process or an idea and NotchAI draws it as boxes and arrows. The diagram is the model's own simplification, so check facts elsewhere.")
                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
        }
    }

    @ViewBuilder private var filePane: some View {
        HStack {
            Button("Open a 3D file…") { visual.chooseFile() }
            Text("USDZ, USD, OBJ, DAE, SCN, STL, PLY").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
        statusLine
        if let scene = visual.fileScene {
            HStack(alignment: .top, spacing: 10) {
                VisualSceneView(scene: scene) { visual.pickFilePart($0) }
                    .frame(minHeight: 200).clipShape(RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 6) {
                    Text(visual.fileName).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white).lineLimit(2)
                    if let p = visual.selectedFilePart {
                        Text(p).font(.system(size: 12, weight: .semibold)).foregroundStyle(NotchAIView.green)
                        Button("Ask NotchAI about this part") { visual.askAboutFilePart() }.controlSize(.small)
                    } else { Text("Drag to rotate, scroll to zoom, click a part.").font(.system(size: 10)).foregroundStyle(Theme.textSecondary) }
                    if !visual.fileParts.isEmpty {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(visual.fileParts, id: \.self) { name in
                                    Button(name) { visual.selectedFilePart = name }.buttonStyle(.plain)
                                        .font(.system(size: 10)).foregroundStyle(visual.selectedFilePart == name ? NotchAIView.green : Theme.textSecondary)
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    Spacer()
                    Label("Your own file, shown as it is. NotchAI cannot see the shapes: answers about a part come from its name.", systemImage: "cube")
                        .font(.system(size: 9)).foregroundStyle(Theme.textSecondary)
                }
                .frame(width: 230, alignment: .leading)
            }
            .onDrop(of: [.fileURL], isTargeted: nil) { providers in dropped(providers) }
        } else {
            Text("Open a real 3D model from your Mac (or drop one here) to turn it around, zoom in and click its named parts. The file stays on this Mac.")
                .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity, minHeight: 60, alignment: .topLeading)
                .onDrop(of: [.fileURL], isTargeted: nil) { providers in dropped(providers) }
        }
    }

    private func dropped(_ providers: [NSItemProvider]) -> Bool {
        guard let p = providers.first else { return false }
        _ = p.loadObject(ofClass: URL.self) { url, _ in
            guard let url else { return }
            Task { @MainActor in visual.open(url) }
        }
        return true
    }
}

/// Boxes and arrows, laid out in rows by DiagramLogic.
struct DiagramView: View {
    let spec: DiagramSpec
    let selected: String?
    let onPick: (String) -> Void

    var body: some View {
        let layout = DiagramLogic.layout(spec)
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let boxW = min(150, max(60, w / CGFloat(max(layout.widest, 1)) - 14))
            let boxH = min(40, max(22, h / CGFloat(max(layout.rows, 1)) - 16))
            let centre: (String) -> CGPoint? = { id in layout.centre(id).map { CGPoint(x: $0.x * w, y: $0.y * h) } }
            ZStack {
                Canvas { ctx, _ in
                    for e in spec.edges {
                        guard let a = centre(e.from), let b = centre(e.to) else { continue }
                        let down = b.y > a.y + 1
                        let start = CGPoint(x: a.x, y: a.y + (down ? boxH / 2 : (b.y < a.y - 1 ? -boxH / 2 : 0)))
                        let end = CGPoint(x: b.x, y: b.y + (down ? -boxH / 2 : (b.y < a.y - 1 ? boxH / 2 : 0)))
                        var path = Path()
                        path.move(to: start)
                        if down { path.addLine(to: end) }
                        else {
                            // An arrow that goes back up, or sideways, bends out so it does not run through the boxes.
                            let bend = CGPoint(x: max(a.x, b.x) + boxW * 0.75, y: (start.y + end.y) / 2)
                            path.addQuadCurve(to: end, control: bend)
                        }
                        ctx.stroke(path, with: .color(.white.opacity(0.55)), lineWidth: 1.4)
                        let from = down ? start : CGPoint(x: max(a.x, b.x) + boxW * 0.75, y: (start.y + end.y) / 2)
                        let angle = atan2(end.y - from.y, end.x - from.x), head: CGFloat = 7
                        var tip = Path()
                        tip.move(to: end)
                        tip.addLine(to: CGPoint(x: end.x - head * cos(angle - .pi / 7), y: end.y - head * sin(angle - .pi / 7)))
                        tip.addLine(to: CGPoint(x: end.x - head * cos(angle + .pi / 7), y: end.y - head * sin(angle + .pi / 7)))
                        tip.closeSubpath()
                        ctx.fill(tip, with: .color(.white.opacity(0.7)))
                        if !e.label.isEmpty {
                            ctx.draw(Text(e.label).font(.system(size: 9)).foregroundColor(.white.opacity(0.8)),
                                     at: CGPoint(x: (start.x + end.x) / 2 + 6, y: (start.y + end.y) / 2), anchor: .leading)
                        }
                    }
                }
                ForEach(spec.nodes, id: \.id) { n in
                    if let c = centre(n.id) {
                        Button { onPick(n.id) } label: {
                            Text(n.label).font(.system(size: 10, weight: .medium)).foregroundStyle(.white)
                                .multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.7)
                                .padding(.horizontal, 5)
                                .frame(width: boxW, height: boxH)
                                .background(fill(n.kind), in: shape(n.kind))
                                .overlay(shape(n.kind).stroke(selected == n.id ? NotchAIView.green : Color.white.opacity(0.25), lineWidth: selected == n.id ? 2 : 1))
                        }
                        .buttonStyle(.plain)
                        .position(c)
                    }
                }
            }
        }
        .padding(6)
    }

    private func shape(_ kind: DiagramKind) -> RoundedRectangle {
        RoundedRectangle(cornerRadius: kind == .start || kind == .end ? 18 : (kind == .decision ? 2 : 7))
    }

    private func fill(_ kind: DiagramKind) -> Color {
        switch kind {
        case .start, .end: NotchAIView.green.opacity(0.35)
        case .decision: Color.orange.opacity(0.3)
        case .note: Color.white.opacity(0.08)
        case .step: Color.white.opacity(0.14)
        }
    }
}
