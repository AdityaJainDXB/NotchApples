//
//  NotchAIConnectorCatalog.swift
//  Notch Apple
//
//  Ready-made connectors: services that run their own MCP server, so the user presses one button instead of typing an
//  address. Each entry is only an address and how that service signs in; the connection itself is the ordinary MCP
//  connector (same approvals, same per-tool permissions). Nothing connects until the user presses the button.
//
//  The addresses were checked on 12 November 2026: Notion, Linear and Sentry answered with browser sign-in and
//  self-registration; GitHub's server wants a personal access token. Google does not run a public MCP server for
//  Gmail or Calendar, so there is no Gmail entry: the user can add their own server by address.
//  A second account is a second connector ("Notion 2") with its own sign-in.
//

import Foundation

struct ConnectorPreset: Equatable, Identifiable {
    enum SignIn: Equatable {
        /// Sign in through the browser; nothing to paste.
        case browser
        /// Paste a token made on the service's site. `hint` says where.
        case token(hint: String)
    }
    var id: String
    var name: String
    var address: String
    var signIn: SignIn
    var about: String
}

enum ConnectorCatalog {
    static let presets: [ConnectorPreset] = [
        ConnectorPreset(id: "notion", name: "Notion", address: "https://mcp.notion.com/mcp", signIn: .browser,
                        about: "Search, read and edit your Notion pages."),
        ConnectorPreset(id: "linear", name: "Linear", address: "https://mcp.linear.app/mcp", signIn: .browser,
                        about: "Find, create and update Linear issues."),
        ConnectorPreset(id: "sentry", name: "Sentry", address: "https://mcp.sentry.dev/mcp", signIn: .browser,
                        about: "Look up errors and issues in Sentry."),
        ConnectorPreset(id: "github", name: "GitHub", address: "https://api.githubcopilot.com/mcp/", signIn: .token(hint: "Make a personal access token at github.com → Settings → Developer settings, and paste it as the key."),
                        about: "Read repositories, issues and pull requests."),
    ]

    /// A name nothing else uses: "Notion", then "Notion 2", "Notion 3"... so a second account can be added.
    static func freeName(_ base: String, taken: [String]) -> String {
        let used = Set(taken.map { $0.lowercased() })
        if !used.contains(base.lowercased()) { return base }
        var n = 2
        while used.contains("\(base) \(n)".lowercased()) { n += 1 }
        return "\(base) \(n)"
    }

    /// How many connectors already point at this preset's address (the accounts added so far).
    static func accounts(of preset: ConnectorPreset, in addresses: [String]) -> Int {
        func norm(_ s: String) -> String { s.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "/ ")) }
        return addresses.filter { norm($0) == norm(preset.address) }.count
    }
}
