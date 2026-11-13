//
//  NotchAIReadyView.swift
//  Notch Apple
//
//  The empty state of the NotchAI chat, taken from the "Ready when you are" panel of the approved prototype
//  (docs/prototypes/liquid-metal-notch.html): a breathing dotted orb, the title, what it is using and where that runs,
//  a few starter chips, a demo button and the model pill with its Local or Cloud label. The buttons get the liquid-metal
//  rim when that option is on (Settings → Appearance). It shows only while the chat is empty and the provider is usable.
//

import SwiftUI

struct NotchAIReadyView: View {
    let providerTitle: String
    let model: String
    let locality: ModelLocality
    let configured: Bool
    var onAsk: (String) -> Void

    @AppStorage(LiquidMetalSetting.key) private var metal = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let starters: [(String, String)] = [
        ("Explain something", "Explain how a refrigerator works, simply."),
        ("Write", "Write a short, friendly message asking a teacher for an extension."),
        ("Brainstorm", "Give me five ideas for a weekend project."),
        ("Summarise", "Summarise the idea of compound interest in three sentences."),
    ]

    var body: some View {
        HStack(alignment: .center, spacing: 18) {
            Orb(reduceMotion: reduceMotion).frame(width: 64, height: 64)
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Ready when you are").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.textPrimary)
                    Text(configured ? "Type below, or start from one of these." : "Choose a provider in Settings → AI to start.")
                        .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                }
                if configured {
                    FlowChips(items: starters.map(\.0)) { i in onAsk(starters[i].1) }
                    HStack(spacing: 8) {
                        pill("Run a demo question") { onAsk("Show me, in two sentences, what you can help with.") }
                        modelPill
                    }
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var modelPill: some View {
        HStack(spacing: 6) {
            Text(model).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textPrimary).lineLimit(1)
            Text(locality.label.uppercased())
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundStyle(locality == .local ? Color(red: 0.45, green: 0.93, blue: 0.6) : Color.orange)
                .padding(.horizontal, 5).padding(.vertical, 2)
                .background((locality == .local ? Color.green : Color.orange).opacity(0.16), in: RoundedRectangle(cornerRadius: 4))
        }
        .padding(.horizontal, 12).frame(height: 30)
        .modifier(MetalRim(metal: metal))
        .help("\(providerTitle) · \(locality == .local ? "runs on this Mac or your network" : "a cloud service")")
    }

    private func pill(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 14).frame(height: 30)
        }
        .buttonStyle(MetalPlainStyle())
        .modifier(MetalRim(metal: metal))
        .contentShape(Capsule())
    }

    /// Dark glass with a thin outline; the liquid-metal rim flows around it when the option is on.
    private struct MetalRim: ViewModifier {
        let metal: Bool
        func body(content: Content) -> some View {
            content
                .background(Capsule().fill(Color.black.opacity(0.45)))
                .overlay(Capsule().strokeBorder(Theme.accentBright.opacity(metal ? 0.0 : 0.55), lineWidth: 1))
                .overlay { if metal { LiquidMetalCapsule(hover: false, mode: 2, veil: false).mask(Capsule().strokeBorder(lineWidth: 1.8)).allowsHitTesting(false) } }
        }
    }

    /// The breathing dotted orb.
    private struct Orb: View {
        let reduceMotion: Bool
        var body: some View {
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { ctx in
                let t = reduceMotion ? 0.0 : ctx.date.timeIntervalSinceReferenceDate
                Canvas { g, size in
                    let c = CGPoint(x: size.width / 2, y: size.height / 2)
                    let base = min(size.width, size.height) * 0.36
                    let breathe = 0.5 + 0.5 * sin(t * 1.4)
                    let n = 30
                    for i in 0..<n {
                        let a = Double(i) / Double(n) * 2 * .pi
                        let wob = 1.0 + 0.08 * sin(a * 3 + t * 1.1) + 0.05 * sin(a * 5 - t * 0.8)
                        let r = base * (0.92 + 0.14 * breathe) * wob
                        let p = CGPoint(x: c.x + r * cos(a), y: c.y + r * sin(a))
                        let d = 1.4 + 1.5 * (0.5 + 0.5 * sin(a * 2 - t * 1.6))
                        g.fill(Path(ellipseIn: CGRect(x: p.x - d / 2, y: p.y - d / 2, width: d, height: d)), with: .color(Theme.accentBright.opacity(0.55 + 0.4 * breathe)))
                    }
                }
            }
        }
    }

    /// Starter chips, wrapped onto as many lines as they need.
    private struct FlowChips: View {
        let items: [String]
        var pick: (Int) -> Void
        var body: some View {
            HStack(spacing: 6) {
                ForEach(Array(items.enumerated()), id: \.offset) { i, name in
                    Button { pick(i) } label: {
                        Text(name).font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                            .padding(.horizontal, 10).frame(height: 24)
                            .background(Capsule().fill(Color.white.opacity(0.05)))
                            .overlay(Capsule().strokeBorder(Color.white.opacity(0.12), lineWidth: 1))
                    }.buttonStyle(MetalPlainStyle())
                }
            }
        }
    }
}
