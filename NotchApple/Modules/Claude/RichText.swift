//
//  RichText.swift
//  Notch apple
//
//  Renders AI answers instead of dumping raw Markdown/LaTeX (parsing is in MathText.swift):
//   • headings, lists, bold/italic/inline code and links (Markdown)
//   • fenced code blocks in a monospaced box with a Copy button
//   • Markdown tables as a grid
//   • LaTeX turned into readable math: \frac{a}{b} → a⁄b, x^{2} → x², \sqrt{x} → √x,
//     \alpha → α, \le → ≤ …; display math ($$…$$, \[…\]) gets its own centred line.
//

import AppKit
import SwiftUI

struct RichTextView: View {
    let markdown: String
    var fontSize: CGFloat = 13

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(RichBlocks.parse(markdown).enumerated()), id: \.offset) { _, block in
                switch block {
                case .text(let t):
                    Text(Self.attributed(t)).font(.system(size: fontSize)).foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                case .heading(let t, let level):
                    Text(Self.attributed(t)).font(.system(size: fontSize + (level == 1 ? 4 : level == 2 ? 2 : 1), weight: .bold))
                        .foregroundStyle(.white)
                case .math(let m):
                    Text(m).font(.system(size: fontSize + 2, design: .serif)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 6)
                        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                        .accessibilityLabel("Equation: \(m)")
                case .code(let c, let lang):
                    CodeBlock(code: c, language: lang)
                case .table(let rows):
                    Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                        ForEach(Array(rows.enumerated()), id: \.offset) { i, row in
                            GridRow {
                                ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                                    Text(Self.attributed(cell)).font(.system(size: fontSize - 1, weight: i == 0 ? .semibold : .regular))
                                        .foregroundStyle(.white)
                                }
                            }
                            if i == 0 { Divider().overlay(Color.white.opacity(0.2)) }
                        }
                    }
                    .padding(8).background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .textSelection(.enabled)
    }

    static func attributed(_ s: String) -> AttributedString {
        (try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s)
    }
}

private struct CodeBlock: View {
    let code: String
    let language: String
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language.isEmpty ? "Code" : language).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.textSecondary)
                Spacer()
                Button(copied ? "Copied" : "Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(code, forType: .string)
                    copied = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { copied = false }
                }
                .buttonStyle(.plain).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.accentBright)
                .accessibilityLabel("Copy code")
            }
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Color.white.opacity(0.06))
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code).font(.system(size: 12, design: .monospaced)).foregroundStyle(.white).padding(10)
            }
        }
        .background(Color.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.white.opacity(0.08)))
    }
}
