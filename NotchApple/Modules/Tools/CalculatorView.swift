//
//  CalculatorView.swift
//  Notch apple
//
//  The calculator page of Tools: type one line or many. Each line is worked out in order, so later lines can use
//  earlier ones (a = 5, then 2a + 1), and equations, systems, factoring and derivatives work too (see MathEngine).
//  Percent phrases ("12% of 80") and unit or currency conversions keep working line by line.
//

import SwiftUI

struct CalculatorView: View {
    @AppStorage("tools.calcInput") private var input = ""
    @FocusState private var focused: Bool
    @State private var copied = false

    private struct Row: Identifiable {
        let id: Int
        let input: String
        let output: [String]
        let kind: MathLine.Kind
        let conversion: Converter.Query?
    }

    private var rows: [Row] {
        var session = MathSession()
        var out: [Row] = []
        for (i, raw) in input.split(whereSeparator: \.isNewline).map({ String($0).trimmingCharacters(in: .whitespaces) }).filter({ !$0.isEmpty }).enumerated() {
            if let p = QuickAnswerLogic.percent(raw.lowercased()) {
                out.append(Row(id: i, input: raw, output: [p.text], kind: .value, conversion: nil)); continue
            }
            if let q = Converter.parse(raw) {
                out.append(Row(id: i, input: raw, output: [], kind: .value, conversion: q)); continue
            }
            let line = session.runLine(raw)
            out.append(Row(id: i, input: raw, output: line.output, kind: line.kind, conversion: nil))
        }
        return out
    }

    var body: some View {
        let rows = rows
        HStack(alignment: .top, spacing: Theme.gap) {
            GlassCard {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Label("Calculator", systemImage: "plusminus").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                        Spacer()
                        if !input.isEmpty { IconButton(systemImage: "trash", help: "Clear") { input = "" } }
                    }
                    TextEditor(text: $input)
                        .font(.system(size: 14, design: .monospaced)).scrollContentBackground(.hidden)
                        .padding(6).background(Theme.surface, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .focused($focused)
                    Text("One step per line: a = 5, then 2a + 1. Try 2x + 3 = 11, x^2 - 5x + 6 = 0, factor(x^2 - 1), diff(x^3, x).")
                        .font(.system(size: 10)).foregroundStyle(Theme.textSecondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxHeight: .infinity)
            GlassCard {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Answers").sectionTitle()
                        Spacer()
                        if let last = rows.last(where: { $0.kind != .error && !$0.output.isEmpty }) {
                            Button { copy(last) } label: { Label(copied ? "Copied" : "Copy last", systemImage: copied ? "checkmark" : "doc.on.doc").font(.system(size: 11, weight: .semibold)) }
                                .buttonStyle(.plain).foregroundStyle(Theme.accentBright)
                        }
                    }
                    if rows.isEmpty {
                        Text("Answers appear here as you type.").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    }
                    ScrollView {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(rows) { row in
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(row.input).font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.textSecondary).lineLimit(1)
                                    if let q = row.conversion {
                                        ConversionLine(query: q)
                                    } else {
                                        ForEach(Array(row.output.enumerated()), id: \.offset) { _, line in
                                            Text(row.kind == .value ? "= " + line : line)
                                                .font(.system(size: row.kind == .value ? 20 : 14, weight: .semibold, design: .rounded))
                                                .foregroundStyle(row.kind == .error ? Color.orange : .white)
                                                .textSelection(.enabled).lineLimit(3).minimumScaleFactor(0.6)
                                        }
                                    }
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .frame(maxHeight: .infinity)
        }
        .onAppear { focused = true }
    }

    private func copy(_ row: Row) {
        let text = row.output.first?.replacingOccurrences(of: #"^\w+ = "#, with: "", options: .regularExpression) ?? ""
        ColorPickerModel.shared.copy(text)
        copied = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
    }
}
