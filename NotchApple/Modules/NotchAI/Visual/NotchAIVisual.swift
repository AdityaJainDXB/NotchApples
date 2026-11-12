//
//  NotchAIVisual.swift
//  Notch Apple
//
//  Visual explanations (free): type a topic, the model sketches a simple 3D illustration (validated first, see
//  NotchAIVisualLogic), and you can rotate and zoom it, click a part to see what the sketch says about it, and ask the
//  chat about that part. It is always labelled as a generated illustration, not a factual source. The model call goes
//  through the Local-first guard like any other.
//

import AppKit
import SceneKit
import SwiftUI

@MainActor
final class NotchAIVisual: ObservableObject {
    static let shared = NotchAIVisual()
    @Published private(set) var spec: VisualSpec?
    @Published private(set) var scene: SCNScene?
    @Published var selected: VisualPart?
    @Published private(set) var status: String?
    @Published private(set) var working = false

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
            let hit = v.hitTest(g.location(in: v), options: nil).first?.node
            onPick(hit?.name)
        }
    }
}

struct NotchAIVisualView: View {
    @ObservedObject private var visual = NotchAIVisual.shared
    @State private var topic = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("What should it show? (e.g. a water molecule, the layers of the Earth)", text: $topic).textFieldStyle(.roundedBorder).onSubmit { visual.generate(topic: topic) }
                Button("Make it") { visual.generate(topic: topic) }.disabled(visual.working || topic.trimmingCharacters(in: .whitespaces).isEmpty)
                if visual.working { ProgressView().controlSize(.small) }
            }
            if let s = visual.status { Text(s).font(.system(size: 11)).foregroundStyle(.orange) }
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
                        Label("A generated illustration, not a factual source.", systemImage: "sparkles").font(.system(size: 9)).foregroundStyle(.orange)
                    }
                    .frame(width: 230, alignment: .leading)
                }
            } else {
                Text("Describe a topic and NotchAI sketches a simple 3D model you can turn around and ask questions about. The sketch is the model's own simplification, so check facts elsewhere.")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
        }
    }
}
