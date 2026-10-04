//
//  MarketsView.swift
//  Notch apple
//
//  Markets (Pro): a watchlist of stocks and crypto with today's change and a
//  small chart. Pin one to show it beside the closed notch.
//   • Crypto prices: CoinGecko's free public API (no key).
//   • Stock prices: Yahoo Finance's public chart feed (no key; delayed ~15 min
//     on most exchanges). Only the symbols you add are sent.
//  Prices refresh every minute while the tab is open or something is pinned.
//

import AppKit
import SwiftUI

@MainActor
final class MarketsModel: ObservableObject {
    static let shared = MarketsModel()

    struct Quote: Equatable {
        var price: Double
        var change: Double          // percent since the previous close
        var points: [Double] = []   // today's prices for the sparkline
        var currency = "USD"
    }

    @AppStorage("markets.symbols") private var symbolsRaw = "AAPL,MSFT,BTC,ETH"
    @AppStorage("markets.pinned") var pinned = ""
    @Published private(set) var quotes: [String: Quote] = [:]
    @Published private(set) var failed: Set<String> = []
    private var lastFetch = Date.distantPast
    var viewing = false { didSet { if viewing { refreshIfDue(force: true) } } }

    var symbols: [String] { symbolsRaw.split(separator: ",").map { String($0) }.filter { !$0.isEmpty } }

    /// Common tickers → CoinGecko IDs. Anything else is treated as a stock symbol
    /// (or a CoinGecko ID if written in lower case, e.g. "render-token").
    static let crypto: [String: String] = [
        "BTC": "bitcoin", "ETH": "ethereum", "SOL": "solana", "LTC": "litecoin", "DOGE": "dogecoin", "XRP": "ripple",
        "ADA": "cardano", "BNB": "binancecoin", "DOT": "polkadot", "AVAX": "avalanche-2", "TRX": "tron", "TON": "the-open-network",
        "LINK": "chainlink", "MATIC": "matic-network", "SHIB": "shiba-inu", "USDT": "tether", "USDC": "usd-coin", "XMR": "monero",
    ]

    static func coinID(_ s: String) -> String? { crypto[s] ?? (s == s.lowercased() && s.range(of: "^[a-z0-9-]+$", options: .regularExpression) != nil ? s : nil) }

    func add(_ raw: String) {
        let s = raw.trimmingCharacters(in: .whitespaces)
        let sym = Self.coinID(s.lowercased()) != nil && Self.crypto[s.uppercased()] == nil && s == s.lowercased() ? s : s.uppercased()
        guard !sym.isEmpty, sym.count <= 24, !symbols.contains(sym), symbols.count < 20 else { return }
        symbolsRaw = (symbols + [sym]).joined(separator: ",")
        refreshIfDue(force: true)
    }

    func remove(_ s: String) {
        symbolsRaw = symbols.filter { $0 != s }.joined(separator: ",")
        quotes[s] = nil
        if pinned == s { pinned = ""; LiveActivityCenter.shared.recompute() }
    }

    func togglePin(_ s: String) {
        pinned = pinned == s ? "" : s
        refreshIfDue(force: true)
        LiveActivityCenter.shared.recompute()
    }

    func refreshIfDue(force: Bool = false) {
        guard Entitlements.shared.canUse(Feature.markets), viewing || !pinned.isEmpty || force else { return }
        guard force || Date.now.timeIntervalSince(lastFetch) > 60 else { return }
        lastFetch = .now
        let list = viewing ? symbols : (pinned.isEmpty ? symbols : [pinned])
        Task {
            var out = quotes, bad: Set<String> = []
            let coins = list.compactMap { s in Self.coinID(s).map { (s, $0) } }
            if !coins.isEmpty, let c = await Self.cryptoQuotes(coins.map(\.1)) {
                for (s, id) in coins { if let q = c[id] { out[s] = q } else { bad.insert(s) } }
            }
            for s in list where Self.coinID(s) == nil {
                if let q = await Self.stockQuote(s) { out[s] = q } else { bad.insert(s) }
            }
            quotes = out
            failed = bad
            LiveActivityCenter.shared.recompute()
        }
    }

    var liveActivity: LiveActivity? {
        guard Entitlements.shared.canUse(Feature.markets), !pinned.isEmpty, let q = quotes[pinned] else { return nil }
        let arrow = q.change >= 0 ? "▲" : "▼"
        return LiveActivity(symbol: q.change >= 0 ? "chart.line.uptrend.xyaxis" : "chart.line.downtrend.xyaxis",
                            label: "\(pinned.prefix(5).uppercased()) \(Self.short(q.price)) \(arrow)\(String(format: "%.1f", abs(q.change)))%",
                            tint: q.change >= 0 ? .systemGreen : .systemRed)
    }

    static func short(_ p: Double) -> String {
        p >= 10_000 ? String(format: "%.0f", p) : p >= 100 ? String(format: "%.1f", p) : p >= 1 ? String(format: "%.2f", p) : String(format: "%.4f", p)
    }

    // MARK: Sources

    nonisolated private static func cryptoQuotes(_ ids: [String]) async -> [String: Quote]? {
        let joined = ids.joined(separator: ",")
        guard let url = URL(string: "https://api.coingecko.com/api/v3/simple/price?ids=\(joined)&vs_currencies=usd&include_24hr_change=true"),
              let (data, r) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 15)),
              (r as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: [String: Double]] else { return nil }
        return json.compactMapValues { v in v["usd"].map { Quote(price: $0, change: v["usd_24h_change"] ?? 0) } }
    }

    nonisolated private static func stockQuote(_ symbol: String) async -> Quote? {
        guard let enc = symbol.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let url = URL(string: "https://query1.finance.yahoo.com/v8/finance/chart/\(enc)?range=1d&interval=15m") else { return nil }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.setValue("Mozilla/5.0", forHTTPHeaderField: "User-Agent")
        guard let (data, r) = try? await URLSession.shared.data(for: req), (r as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let result = ((json["chart"] as? [String: Any])?["result"] as? [[String: Any]])?.first,
              let meta = result["meta"] as? [String: Any],
              let price = meta["regularMarketPrice"] as? Double else { return nil }
        let prev = (meta["chartPreviousClose"] as? Double) ?? (meta["previousClose"] as? Double) ?? price
        let closes = ((((result["indicators"] as? [String: Any])?["quote"] as? [[String: Any]])?.first)?["close"] as? [Double?])?.compactMap { $0 } ?? []
        return Quote(price: price, change: prev > 0 ? (price - prev) / prev * 100 : 0, points: closes, currency: meta["currency"] as? String ?? "USD")
    }
}

struct MarketsView: View {
    @StateObject private var model = MarketsModel.shared
    @State private var newSymbol = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Add a stock (AAPL) or coin (BTC)", text: $newSymbol)
                    .textFieldStyle(.roundedBorder).font(.system(size: 12))
                    .onSubmit { model.add(newSymbol); newSymbol = "" }
                Button("Add") { model.add(newSymbol); newSymbol = "" }.buttonStyle(PurpleButtonStyle()).disabled(newSymbol.isEmpty)
                IconButton(systemImage: "arrow.clockwise", help: "Refresh") { model.refreshIfDue(force: true) }
            }
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 210), spacing: 8)], spacing: 8) {
                    ForEach(model.symbols, id: \.self) { s in row(s) }
                }
            }
            Text("Crypto from CoinGecko, stocks from Yahoo Finance (may be delayed). Click the pin to show one beside the notch.")
                .font(.system(size: 10)).foregroundStyle(Theme.textSecondary)
        }
        .onAppear { model.viewing = true }
        .onDisappear { model.viewing = false }
    }

    private func row(_ s: String) -> some View {
        let q = model.quotes[s]
        let up = (q?.change ?? 0) >= 0
        return HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(s.uppercased()).font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                if let q {
                    Text(q.currency == "USD" ? "$\(MarketsModel.short(q.price))" : "\(MarketsModel.short(q.price)) \(q.currency)").font(.system(size: 12, design: .rounded)).monospacedDigit().foregroundStyle(.white)
                    Text(String(format: "%@%.2f%%", up ? "+" : "−", abs(q.change))).font(.system(size: 11, weight: .semibold)).monospacedDigit()
                        .foregroundStyle(up ? .green : .red)
                } else if model.failed.contains(s) {
                    Text("Not found").font(.system(size: 11)).foregroundStyle(.orange)
                } else {
                    ProgressView().controlSize(.small)
                }
            }
            Spacer(minLength: 4)
            if let q, q.points.count > 2 { Sparkline(points: q.points, up: up).frame(width: 70, height: 28) }
            VStack(spacing: 2) {
                IconButton(systemImage: model.pinned == s ? "pin.fill" : "pin", help: model.pinned == s ? "Unpin from the notch" : "Show beside the notch") { model.togglePin(s) }
                IconButton(systemImage: "xmark", help: "Remove") { model.remove(s) }
            }
        }
        .padding(8)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(q.map { "\(s), \(MarketsModel.short($0.price)), \(up ? "up" : "down") \(String(format: "%.2f", abs($0.change))) percent" } ?? s)
    }
}

private struct Sparkline: View {
    let points: [Double]
    let up: Bool
    var body: some View {
        GeometryReader { g in
            let lo = points.min() ?? 0, hi = points.max() ?? 1, span = max(hi - lo, 0.0001)
            Path { p in
                for (i, v) in points.enumerated() {
                    let pt = CGPoint(x: g.size.width * CGFloat(i) / CGFloat(points.count - 1), y: g.size.height * (1 - CGFloat((v - lo) / span)))
                    i == 0 ? p.move(to: pt) : p.addLine(to: pt)
                }
            }
            .stroke(up ? Color.green : Color.red, style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
        }
        .accessibilityHidden(true)
    }
}
