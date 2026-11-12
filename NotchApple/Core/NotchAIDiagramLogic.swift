//
//  NotchAIDiagramLogic.swift
//  Notch Apple
//
//  Two more kinds of visual explanation, as pure rules (Foundation only, unit tested):
//   • Diagrams: the model describes boxes and arrows as JSON; this file VALIDATES it (how many boxes, unique ids,
//     arrows that point at real boxes) and lays it out in rows, top to bottom, so it can be drawn. A diagram that
//     breaks the rules is refused with the reasons. Like the 3D sketch, it is the model's own simplification.
//   • 3D files: which files can be opened (USDZ and friends), how big they may be, how a part's name is shown, and
//     the question asked about a part. The file is the user's own; NotchAI only displays it.
//

import Foundation

// MARK: - Diagrams

enum DiagramKind: String, CaseIterable { case start, step, decision, end, note }

struct DiagramNode: Equatable {
    var id: String
    var label: String
    var kind: DiagramKind
    var info: String
}

struct DiagramEdge: Equatable {
    var from: String
    var to: String
    var label: String
}

struct DiagramSpec: Equatable {
    var title: String
    var explanation: String
    var nodes: [DiagramNode]
    var edges: [DiagramEdge]
}

/// Where each box goes: `row` from the top, `slot` from the left within its row.
struct DiagramLayout: Equatable {
    struct Place: Equatable { var row: Int; var slot: Int; var inRow: Int }
    var places: [String: Place]
    var rows: Int
    var widest: Int

    /// The centre of a box as fractions of the drawing area (0...1, origin top-left).
    func centre(_ id: String) -> (x: Double, y: Double)? {
        guard let p = places[id], rows > 0, p.inRow > 0 else { return nil }
        return ((Double(p.slot) + 0.5) / Double(p.inRow), (Double(p.row) + 0.5) / Double(rows))
    }
}

enum DiagramLogic {
    static let maxNodes = 24
    static let maxEdges = 48
    static let maxLabel = 60

    static func prompt(topic: String) -> String {
        """
        Draw a simple diagram that explains: \(topic)
        Use at most \(maxNodes) boxes and \(maxEdges) arrows. Each box has a short id, a label of at most \(maxLabel) characters and a kind: start, step, decision, end or note.
        Reply with ONLY JSON: {"title":"…","explanation":"<two sentences>","nodes":[{"id":"a","label":"…","kind":"step","info":"<one sentence>"}],"edges":[{"from":"a","to":"b","label":"<optional, a word or two>"}]}
        Arrows go from cause to effect or from one step to the next. Keep it accurate and modest: this is a simplified picture.
        """
    }

    static func parse(_ reply: String) -> Result<DiagramSpec, VisualError> {
        guard let s = reply.firstIndex(of: "{"), let e = reply.lastIndex(of: "}"), s < e,
              let obj = (try? JSONSerialization.jsonObject(with: Data(reply[s...e].utf8))) as? [String: Any],
              let rawNodes = obj["nodes"] as? [[String: Any]] else { return .failure(.noJSON) }
        var problems: [String] = []
        var nodes: [DiagramNode] = []
        var ids = Set<String>()
        if rawNodes.isEmpty { problems.append("There are no boxes.") }
        if rawNodes.count > maxNodes { problems.append("Too many boxes (\(rawNodes.count); the limit is \(maxNodes)).") }
        for (i, d) in rawNodes.prefix(maxNodes).enumerated() {
            let n = "Box \(i + 1)"
            let id = text(d["id"]).lowercased()
            let label = text(d["label"])
            if id.isEmpty { problems.append("\(n) has no id."); continue }
            if !ids.insert(id).inserted { problems.append("\(n): the id “\(id)” is used twice."); continue }
            if label.isEmpty { problems.append("\(n) (\(id)) has no label.") }
            if label.count > maxLabel { problems.append("\(n) (\(id)): the label is longer than \(maxLabel) characters.") }
            let kind = DiagramKind(rawValue: text(d["kind"]).lowercased()) ?? .step
            nodes.append(DiagramNode(id: id, label: label, kind: kind, info: text(d["info"])))
        }
        let rawEdges = (obj["edges"] as? [[String: Any]]) ?? []
        if rawEdges.count > maxEdges { problems.append("Too many arrows (\(rawEdges.count); the limit is \(maxEdges)).") }
        var edges: [DiagramEdge] = []
        for (i, d) in rawEdges.prefix(maxEdges).enumerated() {
            let from = text(d["from"]).lowercased(), to = text(d["to"]).lowercased()
            if !ids.contains(from) || !ids.contains(to) { problems.append("Arrow \(i + 1) points at a box that does not exist (\(from) → \(to))."); continue }
            if from == to { continue }                                              // an arrow to itself says nothing
            if edges.contains(where: { $0.from == from && $0.to == to }) { continue }   // said twice
            edges.append(DiagramEdge(from: from, to: to, label: String(text(d["label"]).prefix(24))))
        }
        guard problems.isEmpty else { return .failure(.invalid(problems)) }
        return .success(DiagramSpec(title: text(obj["title"]).isEmpty ? "Diagram" : text(obj["title"]), explanation: text(obj["explanation"]), nodes: nodes, edges: edges))
    }

    private static func text(_ v: Any?) -> String {
        if let s = v as? String { return s.trimmingCharacters(in: .whitespacesAndNewlines) }
        if let n = v as? NSNumber { return n.stringValue }
        return ""
    }

    /// Arrows that would close a loop (found walking the boxes in order), so the rest can be laid out top to bottom.
    static func backEdges(_ spec: DiagramSpec) -> Set<Int> {
        var out = Set<Int>()
        var state: [String: Int] = [:]                    // 1 = on the current path, 2 = finished
        let outgoing = Dictionary(grouping: spec.edges.indices, by: { spec.edges[$0].from })
        func visit(_ id: String) {
            state[id] = 1
            for i in outgoing[id] ?? [] {
                let to = spec.edges[i].to
                if state[to] == 1 { out.insert(i) }
                else if state[to] == nil { visit(to) }
            }
            state[id] = 2
        }
        for n in spec.nodes where state[n.id] == nil { visit(n.id) }
        return out
    }

    /// Rows from the top: a box sits one row below the lowest box that points at it. Loops are allowed (the arrow
    /// that closes a loop is ignored for the layout only). Within a row, boxes follow the order of what points at them.
    static func layout(_ spec: DiagramSpec) -> DiagramLayout {
        let back = backEdges(spec)
        let forward = spec.edges.indices.filter { !back.contains($0) }.map { spec.edges[$0] }
        var row: [String: Int] = [:]
        let incoming = Dictionary(grouping: forward, by: \.to)
        func depth(_ id: String) -> Int {
            if let r = row[id] { return r }
            row[id] = 0                                     // guard; forward edges have no loops
            let r = (incoming[id] ?? []).map { depth($0.from) + 1 }.max() ?? 0
            row[id] = r
            return r
        }
        for n in spec.nodes { _ = depth(n.id) }
        let rows = (row.values.max() ?? -1) + 1
        var places: [String: DiagramLayout.Place] = [:]
        var slotOf: [String: Double] = [:]
        var widest = 0
        for r in 0..<max(rows, 0) {
            var ids = spec.nodes.map(\.id).filter { row[$0] == r }
            if r > 0 {
                // Order by the average position of the boxes that point here, keeping the given order for ties.
                let order = Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($1, $0) })
                func weight(_ id: String) -> Double {
                    let parents = (incoming[id] ?? []).compactMap { slotOf[$0.from] }
                    return parents.isEmpty ? Double(order[id] ?? 0) : parents.reduce(0, +) / Double(parents.count)
                }
                ids.sort { (weight($0), order[$0] ?? 0) < (weight($1), order[$1] ?? 0) }
            }
            for (i, id) in ids.enumerated() {
                places[id] = .init(row: r, slot: i, inRow: ids.count)
                slotOf[id] = (Double(i) + 0.5) / Double(ids.count)
            }
            widest = max(widest, ids.count)
        }
        return DiagramLayout(places: places, rows: max(rows, 0), widest: widest)
    }

    /// The question sent to the chat when the user asks about one box.
    static func nodeQuestion(_ node: DiagramNode, in spec: DiagramSpec) -> String {
        "In this simplified diagram of “\(spec.title)”, what does the box “\(node.label)” mean? \(node.info.isEmpty ? "" : "The diagram says: \(node.info) ")Explain it accurately, and say if the diagram simplifies or gets anything wrong."
    }
}

// MARK: - 3D files

enum ModelFileLogic {
    /// Files SceneKit and Model I/O can open on a Mac.
    static let extensions = ["usdz", "usd", "usda", "usdc", "obj", "dae", "scn", "stl", "ply", "abc"]
    static let maxBytes = 300 * 1024 * 1024

    static func canOpen(fileName: String) -> Bool {
        guard let dot = fileName.lastIndex(of: ".") else { return false }
        return extensions.contains(fileName[fileName.index(after: dot)...].lowercased())
    }

    /// Why a file is refused, or nil.
    static func problem(fileName: String, bytes: Int) -> String? {
        if !canOpen(fileName: fileName) { return "NotchAI can show these 3D files: " + extensions.map { "." + $0 }.joined(separator: ", ") + "." }
        if bytes > maxBytes { return "That file is larger than \(maxBytes / 1024 / 1024) MB." }
        if bytes == 0 { return "That file is empty." }
        return nil
    }

    /// A part's name as a person would read it: "Wheel_Front.L_001" becomes "Wheel Front L". Empty for names that say
    /// nothing ("Mesh", "node_12", "Object.003").
    static func displayName(_ raw: String) -> String {
        var t = raw.replacingOccurrences(of: "[_.\\-/:]+", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
        t = t.replacingOccurrences(of: "\\b\\d+\\b", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        let dull: Set<String> = ["mesh", "node", "object", "geometry", "geom", "group", "xform", "root", "scene", "default", "material", "model", "prim", "shape"]
        let words = t.split(separator: " ").filter { !dull.contains($0.lowercased()) }
        return words.joined(separator: " ")
    }

    /// The names to list for a file, from its nodes' names: readable, no repeats, at most `limit`.
    static func partNames(_ raw: [String], limit: Int = 60) -> [String] {
        var seen = Set<String>(), out: [String] = []
        for r in raw {
            let n = displayName(r)
            guard !n.isEmpty, seen.insert(n.lowercased()).inserted else { continue }
            out.append(n)
            if out.count == limit { break }
        }
        return out
    }

    static func partQuestion(part: String, fileName: String) -> String {
        "I am looking at a 3D model from the file “\(fileName)”. One of its parts is named “\(part)”. What is that part likely to be and what does it do? You cannot see the model, so say clearly what you are assuming from the names."
    }
}
