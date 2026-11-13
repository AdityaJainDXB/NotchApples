//
//  OllamaDiagnosticsLogic.swift
//  Notch Apple
//
//  Turns what Ollama's own endpoints say (/api/version and /api/tags) into a plain report for the NotchAI tab:
//  is it running, which models are installed and where each one runs, and whether the model NotchAI is set to use
//  will work. Pure: the network part lives in OllamaDiagnostics. Unit tested.
//

import Foundation

struct OllamaReport: Equatable {
    enum Level: Equatable { case ok, warning, problem, info }

    struct Finding: Equatable {
        var level: Level
        var text: String
    }

    struct Model: Equatable {
        var name: String
        var badge: String        // Local, Cloud or Unverified, from the server's own metadata
        var detail: String       // "8.2B · Q4_K_M · 5.2 GB · 41k context"
    }

    var running: Bool
    var version: String?
    var models: [Model]
    var findings: [Finding]
    /// The context window (tokens) the server reports for the selected model, when it does.
    var selectedContextTokens: Int?
}

enum OllamaDiagnosticsLogic {
    static let endpoint = "localhost:11434"

    /// - selectedModel: the model NotchAI is set to use, when the chosen provider is Ollama (nil otherwise).
    static func report(versionData: Data?, tagsData: Data?, selectedModel: String?, allowCloud: Bool) -> OllamaReport {
        func json(_ d: Data?) -> [String: Any]? { d.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } }
        let version = json(versionData)?["version"] as? String
        guard let tagsJSON = json(tagsData), let tags = tagsJSON["models"] as? [[String: Any]] else {
            let why = versionData == nil && tagsData == nil
                ? "Nothing answered at \(endpoint)."
                : "Something answered at \(endpoint), but it isn't Ollama's model list."
            return OllamaReport(running: false, version: version, models: [],
                                findings: [.init(level: .problem, text: why + " Start the Ollama app (or run `ollama serve`), then check again.")],
                                selectedContextTokens: nil)
        }

        var models: [OllamaReport.Model] = []
        var contexts: [String: Int] = [:]
        for e in tags {
            let name = (e["name"] as? String) ?? (e["model"] as? String) ?? "?"
            let verdict = ModelLocality.verdict(tags: [e], model: name)
            let badge: String
            switch verdict {
            case .local: badge = "Local"
            case .cloud: badge = "Cloud"
            case .unverified: badge = "Unverified"
            }
            let d = e["details"] as? [String: Any]
            var bits: [String] = []
            if let p = d?["parameter_size"] as? String { bits.append(p) }
            if let q = d?["quantization_level"] as? String { bits.append(q) }
            if let s = (e["size"] as? NSNumber)?.doubleValue, s > 0 { bits.append(String(format: "%.1f GB", s / 1_000_000_000)) }
            if let c = (d?["context_length"] as? NSNumber)?.intValue, c > 0 {
                bits.append("\(c >= 1000 ? "\(c / 1000)k" : "\(c)") context")
                contexts[name.lowercased()] = c
            }
            models.append(.init(name: name, badge: badge, detail: bits.joined(separator: " · ")))
        }

        var findings: [OllamaReport.Finding] = []
        findings.append(.init(level: .ok, text: "Ollama \(version.map { "\($0) " } ?? "")is running on this Mac."))
        let local = models.filter { $0.badge == "Local" }
        if local.isEmpty {
            findings.append(.init(level: .warning, text: "No verified local model is installed. Run `ollama pull qwen3:8b`, then check again."))
        } else {
            findings.append(.init(level: .ok, text: "\(local.count) local model\(local.count == 1 ? "" : "s") installed."))
        }
        let cloud = models.filter { $0.badge == "Cloud" }
        if !cloud.isEmpty {
            findings.append(.init(level: .info, text: "\(cloud.count) cloud model\(cloud.count == 1 ? "" : "s") listed (\(cloud.map(\.name).joined(separator: ", "))). "
                + (allowCloud ? "Cloud models are allowed in Settings → AI." : "They are blocked while Local first is on.")))
        }

        var selectedContext: Int?
        if let m = selectedModel, !m.isEmpty {
            let wanted = m.lowercased()
            selectedContext = contexts[wanted] ?? contexts[wanted + ":latest"]
            switch ModelLocality.verdict(tags: tags, model: m) {
            case .local:
                findings.append(.init(level: .ok, text: "\(m) is installed and verified to run on this Mac."))
            case .cloud(let why):
                findings.append(.init(level: allowCloud ? .warning : .problem,
                                      text: "\(m) is a cloud model (\(why)). " + (allowCloud ? "Prompts will leave this Mac." : "NotchAI will refuse it while Local first is on.")))
            case .unverified(let why):
                findings.append(.init(level: .problem, text: "\(m) can't be verified as local: \(why). "
                    + (local.isEmpty ? "" : "Installed local models: \(local.map(\.name).joined(separator: ", ")).")))
            }
        }
        return OllamaReport(running: true, version: version, models: models, findings: findings, selectedContextTokens: selectedContext)
    }
}

/// The real requests (local only): Ollama's version and model list, three seconds each.
enum OllamaDiagnostics {
    static func run(selectedModel: String?, allowCloud: Bool) async -> OllamaReport {
        async let v = fetch("http://\(OllamaDiagnosticsLogic.endpoint)/api/version")
        async let t = fetch("http://\(OllamaDiagnosticsLogic.endpoint)/api/tags")
        return OllamaDiagnosticsLogic.report(versionData: await v, tagsData: await t, selectedModel: selectedModel, allowCloud: allowCloud)
    }

    private static func fetch(_ urlString: String) async -> Data? {
        guard let url = URL(string: urlString) else { return nil }
        var r = URLRequest(url: url); r.timeoutInterval = 3
        guard let (data, response) = try? await URLSession.shared.data(for: r), (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return data
    }
}
