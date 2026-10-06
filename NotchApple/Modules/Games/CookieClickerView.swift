//
//  CookieClickerView.swift
//  Notch apple
//
//  Cookie Clicker: click the cookie, buy click multipliers (each doubles a click) and auto-clickers
//  (cursors, grandmas, farms, mines, factories) that bake while you do something else.
//  Progress is saved on this Mac and picks up where you left off (up to an hour of away-time at half speed).
//  The rules live in CookieEngine (GameEngines.swift).
//

import AppKit
import SwiftUI

@MainActor
final class CookieModel: ObservableObject {
    @Published private(set) var engine = CookieModel.load()
    /// "+N" bubbles that float up from the cookie.
    @Published private(set) var pops: [Pop] = []
    private var timer: Timer?
    private var lastTick = Date()
    private var lastSave = Date()
    private static let key = "games.cookie.save"

    struct Pop: Identifiable { let id = UUID(); let amount: Double; let x: CGFloat }

    private static func load() -> CookieEngine {
        var e = UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(CookieEngine.self, from: $0) } ?? CookieEngine()
        e.applyOffline()
        return e
    }

    func activate() {
        lastTick = Date()
        timer?.invalidate()
        // Ten times a second is plenty for a counter. It stops entirely when the tab is closed.
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    func deactivate() {
        timer?.invalidate(); timer = nil
        save()
    }

    private func tick() {
        let now = Date()
        engine.tick(now.timeIntervalSince(lastTick))
        lastTick = now
        if now.timeIntervalSince(lastSave) > 5 { save() }
    }

    func click() {
        let gain = engine.click()
        let pop = Pop(amount: gain, x: CGFloat.random(in: -34...34))
        pops.append(pop)
        if pops.count > 8 { pops.removeFirst() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in self?.pops.removeAll { $0.id == pop.id } }
        GameSound.play("Pop")
    }

    func buy(_ b: CookieEngine.Building) { if engine.buy(b) { GameSound.play("Tink"); save() } }
    func buyClickUpgrade() { if engine.buyClickUpgrade() { GameSound.play("Glass"); save() } }

    func reset() { engine = CookieEngine(); save() }

    private func save() {
        engine.savedAt = Date()
        lastSave = Date()
        if let data = try? JSONEncoder().encode(engine) { UserDefaults.standard.set(data, forKey: Self.key) }
    }
}

struct CookieClickerView: View {
    @StateObject private var model = CookieModel()
    @State private var pressed = false
    @State private var confirmReset = false

    var body: some View {
        let e = model.engine
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 6) {
                Text("\(CookieEngine.format(e.cookies)) cookies").font(.system(size: 15, weight: .bold).monospacedDigit()).foregroundStyle(.white)
                Text("\(e.cps.formatted(.number.precision(.fractionLength(0...1)))) per second").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                ZStack {
                    Button { model.click() } label: { cookie }
                        .buttonStyle(.plain)
                        .scaleEffect(pressed ? 0.93 : 1)
                        .animation(.spring(response: 0.18, dampingFraction: 0.5), value: pressed)
                        .simultaneousGesture(DragGesture(minimumDistance: 0).onChanged { _ in pressed = true }.onEnded { _ in pressed = false })
                        .accessibilityLabel("Cookie. Click for \(CookieEngine.format(e.clickValue)) cookies.")
                    ForEach(model.pops) { pop in PopView(pop: pop) }
                }
                .frame(width: 130, height: 120)
                Text("Each click: \(CookieEngine.format(e.clickValue))").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                Spacer(minLength: 0)
            }
            .frame(width: 150)

            ScrollView {
                VStack(spacing: 6) {
                    if let cost = e.nextClickUpgradeCost {
                        row(symbol: "hand.tap.fill", title: "Stronger clicks ×2", detail: "Each click is worth \(CookieEngine.format(e.clickValue * 2))",
                            owned: nil, cost: cost, affordable: e.cookies >= cost) { model.buyClickUpgrade() }
                    } else {
                        Text("Clicks are fully upgraded").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    }
                    ForEach(CookieEngine.Building.allCases) { b in
                        if e.isUnlocked(b) {
                            row(symbol: b.symbol, title: b.name, detail: "+\(b.cps.formatted()) /s each", owned: e.count(b),
                                cost: e.cost(b), affordable: e.cookies >= e.cost(b)) { model.buy(b) }
                        } else {
                            lockedRow(b)
                        }
                    }
                    Button("Start over…", role: .destructive) { confirmReset = true }
                        .buttonStyle(.plain).font(.system(size: 10)).foregroundStyle(Theme.textSecondary).padding(.top, 4)
                }
            }
        }
        .onAppear { model.activate() }
        .onDisappear { model.deactivate() }
        .confirmationDialog("Start over from zero?", isPresented: $confirmReset) {
            Button("Start over", role: .destructive) { model.reset() }
        }
    }

    private var cookie: some View {
        ZStack {
            Circle().fill(RadialGradient(colors: [Color(red: 0.86, green: 0.6, blue: 0.3), Color(red: 0.6, green: 0.36, blue: 0.16)],
                                         center: .topLeading, startRadius: 4, endRadius: 90))
                .frame(width: 104, height: 104).shadow(color: .black.opacity(0.4), radius: 6, y: 3)
            ForEach(Array([(-24, -22), (14, -30), (28, 4), (-30, 12), (2, 22), (-6, -4)].enumerated()), id: \.offset) { _, p in
                Circle().fill(Color(red: 0.25, green: 0.14, blue: 0.08)).frame(width: 12, height: 12).offset(x: CGFloat(p.0), y: CGFloat(p.1))
            }
        }
    }

    /// Shown until you've baked enough to reveal it.
    private func lockedRow(_ b: CookieEngine.Building) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "lock.fill").frame(width: 22).foregroundStyle(Theme.textSecondary)
            VStack(alignment: .leading, spacing: 1) {
                Text("???").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                Text("Unlocks after \(CookieEngine.format((b.baseCost * 0.6).rounded())) cookies baked").font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(Theme.surface.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func row(symbol: String, title: String, detail: String, owned: Int?, cost: Double, affordable: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: symbol).frame(width: 22).foregroundStyle(Theme.accentBright)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                    Text(detail).font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
                }
                Spacer()
                if let owned { Text("\(owned)").font(.system(size: 13, weight: .bold).monospacedDigit()).foregroundStyle(Theme.textSecondary) }
                Text(CookieEngine.format(cost)).font(.system(size: 11, weight: .semibold).monospacedDigit())
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(affordable ? Theme.accent : Theme.surface, in: Capsule())
                    .foregroundStyle(affordable ? .white : Theme.textSecondary)
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .opacity(affordable ? 1 : 0.65)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!affordable)
    }
}

private struct PopView: View {
    let pop: CookieModel.Pop
    @State private var risen = false

    var body: some View {
        Text("+\(CookieEngine.format(pop.amount))")
            .font(.system(size: 14, weight: .bold).monospacedDigit()).foregroundStyle(.white).shadow(radius: 2)
            .offset(x: pop.x, y: risen ? -60 : -10).opacity(risen ? 0 : 1)
            .onAppear { withAnimation(.easeOut(duration: 0.9)) { risen = true } }
            .allowsHitTesting(false)
    }
}
