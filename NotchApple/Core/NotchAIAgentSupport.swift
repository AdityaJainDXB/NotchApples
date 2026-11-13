//
//  NotchAIAgentSupport.swift
//  Notch Apple
//
//  Pure helpers for agents: per-agent usage (from the tasks that really ran), and the AppleScript that talks to the
//  user's browser. The scripts are built here, with every piece of text escaped, so they can be tested without a
//  browser; running them (with the user's Automation permission) happens elsewhere.
//

import Foundation

// MARK: - Usage

struct AgentUsage: Equatable {
    var agent: String
    var tasks = 0
    var stepsDone = 0
    var stepsFailed = 0
    /// Estimated from characters (about four per token); no provider reports exact tokens to the app.
    var estimatedTokens = 0
    var seconds = 0.0
}

enum AgentUsageLogic {
    static func estimatedTokens(_ text: String) -> Int { (text.count + 3) / 4 }

    static func summary(_ tasks: [NotchAITask]) -> [AgentUsage] {
        var by: [String: AgentUsage] = [:]
        for t in tasks {
            var u = by[t.agent] ?? AgentUsage(agent: t.agent)
            u.tasks += 1
            for s in t.steps {
                if s.state == .done { u.stepsDone += 1 } else if s.state == .failed { u.stepsFailed += 1 }
                u.estimatedTokens += estimatedTokens(s.argument) + estimatedTokens(s.result ?? "")
            }
            if let a = t.started { u.seconds += max(0, (t.finished ?? t.updated).timeIntervalSince(a)) }
            by[t.agent] = u
        }
        return by.values.sorted { ($0.tasks, $0.agent) > ($1.tasks, $1.agent) }
    }
}

// MARK: - Browser scripts

enum BrowserKind: String, CaseIterable {
    case safari, chrome, edge, brave, arc

    var appName: String {
        switch self { case .safari: "Safari"; case .chrome: "Google Chrome"; case .edge: "Microsoft Edge"; case .brave: "Brave Browser"; case .arc: "Arc" }
    }

    static func from(bundleID: String?) -> BrowserKind? {
        switch bundleID?.lowercased() {
        case "com.apple.safari": .safari
        case "com.google.chrome": .chrome
        case "com.microsoft.edgemac": .edge
        case "com.brave.browser": .brave
        case "company.thebrowser.browser": .arc
        default: nil
        }
    }
}

enum BrowserScripts {
    /// Text for inside an AppleScript string literal: backslashes and quotes escaped, line breaks and control characters
    /// removed, so no input can end the string and run something else.
    static func escape(_ s: String) -> String {
        var out = ""
        for ch in s.unicodeScalars {
            switch ch {
            case "\\": out += "\\\\"
            case "\"": out += "\\\""
            case "\n", "\r", "\t": out += " "
            default: if ch.value >= 32 && ch.value != 127 { out.unicodeScalars.append(ch) }
            }
        }
        return out
    }

    /// Opens a public http(s) address in the browser. Nil for anything else.
    static func open(_ url: URL, in browser: BrowserKind) -> String? {
        guard ResearchLogic.isFetchable(url) else { return nil }
        return "tell application \"\(browser.appName)\" to open location \"\(escape(url.absoluteString))\""
    }

    /// The page the front tab shows: its address, title and text. Needs the browser's "Allow JavaScript from Apple
    /// Events" option; if that is off the browser answers with an error and nothing is read.
    static func readFrontTab(in browser: BrowserKind) -> String {
        let js = "document.body ? document.body.innerText : ''"
        if browser == .safari {
            return """
            tell application "Safari"
                set u to URL of current tab of front window
                set t to name of current tab of front window
                set body to do JavaScript "\(js)" in current tab of front window
                return u & linefeed & t & linefeed & body
            end tell
            """
        }
        return """
        tell application "\(browser.appName)"
            set u to URL of active tab of front window
            set t to title of active tab of front window
            set body to execute active tab of front window javascript "\(js)"
            return u & linefeed & t & linefeed & body
        end tell
        """
    }

    /// Splits what readFrontTab returned into address, title and text.
    static func parseTab(_ raw: String) -> (url: String, title: String, text: String)? {
        let parts = raw.split(separator: "\n", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
        guard parts.count >= 2, !parts[0].isEmpty else { return nil }
        return (parts[0], parts[1], parts.count > 2 ? parts[2] : "")
    }
}
