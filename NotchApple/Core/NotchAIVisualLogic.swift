//
//  NotchAIVisualLogic.swift
//  Notch Apple
//
//  Visual explanations: the model describes a simple 3D illustration as JSON (parts with a shape, position, size and
//  colour), and this file reads and VALIDATES it before anything is built: how many parts, which shapes, how big, valid
//  colours, unique names. A spec that breaks the rules is refused with the reasons. Foundation only; unit tested.
//
//  The result is always shown as "a generated illustration, not a factual source": it is the model's sketch.
//

import Foundation

enum VisualShape: String, CaseIterable {
    case sphere, box, cylinder, cone, torus, capsule

    /// How many numbers the size needs: sphere r; box w,h,l; cylinder r,h; cone r,h; torus ring,pipe; capsule r,h.
    var sizeCount: Int {
        switch self { case .sphere: 1; case .box: 3; case .cylinder, .cone, .torus, .capsule: 2 }
    }
}

struct VisualPart: Equatable {
    var name: String
    var shape: VisualShape
    var position: [Double]
    var size: [Double]
    var color: String
    var info: String
}

struct VisualSpec: Equatable {
    var title: String
    var parts: [VisualPart]
    var explanation: String
}

enum VisualError: LocalizedError, Equatable {
    case noJSON, invalid([String])
    var errorDescription: String? {
        switch self {
        case .noJSON: "The model did not return an illustration."
        case .invalid(let p): "The illustration was refused: " + p.joined(separator: " ")
        }
    }
}

enum VisualLogic {
    static let maxParts = 40
    static let maxCoordinate = 20.0
    static let sizeRange = 0.05...10.0

    static func prompt(topic: String) -> String {
        """
        Describe a simple 3D illustration of: \(topic)
        Use at most \(maxParts) parts. Each part is one of: sphere (size [radius]), box ([w,h,l]), cylinder ([radius,height]), cone ([radius,height]), torus ([ring,pipe]), capsule ([radius,height]).
        Positions are [x,y,z] between -\(Int(maxCoordinate)) and \(Int(maxCoordinate)); sizes between \(sizeRange.lowerBound) and \(Int(sizeRange.upperBound)). Colours are hex like "#E53935".
        Reply with ONLY JSON: {"title":"…","explanation":"<two sentences>","parts":[{"name":"…","shape":"sphere","position":[0,0,0],"size":[1],"color":"#E53935","info":"<one sentence about this part>"}]}
        This is a simplified sketch, so keep what you say about each part accurate and modest.
        """
    }

    static func parse(_ reply: String) -> Result<VisualSpec, VisualError> {
        guard let s = reply.firstIndex(of: "{"), let e = reply.lastIndex(of: "}"), s < e,
              let obj = (try? JSONSerialization.jsonObject(with: Data(reply[s...e].utf8))) as? [String: Any],
              let rawParts = obj["parts"] as? [[String: Any]] else { return .failure(.noJSON) }
        var problems: [String] = []
        var parts: [VisualPart] = []
        var seen = Set<String>()
        if rawParts.isEmpty { problems.append("There are no parts.") }
        if rawParts.count > maxParts { problems.append("Too many parts (\(rawParts.count); the limit is \(maxParts)).") }
        for (i, d) in rawParts.prefix(maxParts).enumerated() {
            let n = "Part \(i + 1)"
            let name = (d["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if name.isEmpty { problems.append("\(n) has no name."); continue }
            if !seen.insert(name.lowercased()).inserted { problems.append("\(n): the name “\(name)” is used twice.") }
            guard let shape = (d["shape"] as? String).flatMap({ VisualShape(rawValue: $0.lowercased()) }) else { problems.append("\(n) (\(name)): unknown shape."); continue }
            let pos = (d["position"] as? [Any])?.compactMap { ($0 as? NSNumber)?.doubleValue } ?? []
            let size = (d["size"] as? [Any])?.compactMap { ($0 as? NSNumber)?.doubleValue } ?? []
            if pos.count != 3 || pos.contains(where: { !$0.isFinite || abs($0) > maxCoordinate }) { problems.append("\(n) (\(name)): the position must be 3 numbers within ±\(Int(maxCoordinate)).") }
            if size.count != shape.sizeCount || size.contains(where: { !sizeRange.contains($0) }) {
                problems.append("\(n) (\(name)): a \(shape.rawValue) needs \(shape.sizeCount) size number\(shape.sizeCount == 1 ? "" : "s") between \(sizeRange.lowerBound) and \(Int(sizeRange.upperBound)).")
            }
            let color = (d["color"] as? String) ?? ""
            if rgb(fromHex: color) == nil { problems.append("\(n) (\(name)): the colour must be hex like #E53935.") }
            parts.append(VisualPart(name: name, shape: shape, position: pos, size: size, color: color, info: (d["info"] as? String) ?? ""))
        }
        guard problems.isEmpty else { return .failure(.invalid(problems)) }
        return .success(VisualSpec(title: (obj["title"] as? String) ?? "Illustration", parts: parts, explanation: (obj["explanation"] as? String) ?? ""))
    }

    static func rgb(fromHex hex: String) -> (r: Double, g: Double, b: Double)? {
        var h = hex.trimmingCharacters(in: .whitespaces)
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        return (Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255)
    }

    /// How far back the camera should sit to see every part, from the parts' reach.
    static func cameraDistance(for spec: VisualSpec) -> Double {
        let reach = spec.parts.map { p in (p.position.map { $0 * $0 }.reduce(0, +)).squareRoot() + (p.size.max() ?? 1) }.max() ?? 1
        return max(4, reach * 2.6)
    }

    /// The question sent to the chat when the user asks about one part.
    static func partQuestion(part: VisualPart, in spec: VisualSpec) -> String {
        "In this simplified model of “\(spec.title)”, what is the \(part.name)? \(part.info.isEmpty ? "" : "The sketch says: \(part.info) ")Explain it accurately, and say if the sketch simplifies or gets anything wrong."
    }
}
