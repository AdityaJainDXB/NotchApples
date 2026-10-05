//
//  CacheCleanerView.swift
//  Notch apple
//
//  The Cache Cleaner tab (Ultimate; other tiers see the unlock card from ActivationModalView):
//  a storage bar split by category, a tick for each, the space freed so far, and one Clean button.
//

import SwiftUI

struct CacheCleanerView: View {
    @ObservedObject private var cleaner = CacheCleanerManager.shared

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 12) {
                header
                storageBar
                ForEach(CacheKind.allCases) { kind in row(kind) }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)

            VStack(spacing: 12) {
                freedCard
                action
                Spacer(minLength: 0)
            }
            .frame(width: 210)
        }
        .padding(.top, 4)
        .onAppear { if cleaner.phase == .idle { cleaner.scan() } }
    }

    // MARK: Left: what's there

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Storage Saver").font(.title3.bold()).foregroundStyle(.white)
                Text(subtitle).font(.caption).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Button { cleaner.scan() } label: { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.textSecondary)
                .disabled(cleaner.phase == .scanning || cleaner.phase == .cleaning)
                .help("Scan again")
        }
    }

    private var subtitle: String {
        switch cleaner.phase {
        case .idle: "Looking for space to give back…"
        case .scanning: "Scanning…"
        case .ready: cleaner.scannedBytes == 0 ? "Nothing to clean right now." : "\(CacheRules.format(cleaner.scannedBytes)) can be cleared."
        case .cleaning: "Cleaning…"
        case .done: "Done. Scan again any time."
        }
    }

    private var storageBar: some View {
        GeometryReader { geo in
            let total = max(cleaner.scannedBytes, 1)
            HStack(spacing: 2) {
                ForEach(CacheKind.allCases) { kind in
                    let share = CGFloat(cleaner.bytes(kind)) / CGFloat(total)
                    if share > 0 {
                        RoundedRectangle(cornerRadius: 4).fill(kind.color.gradient)
                            .frame(width: max(4, (geo.size.width - 6) * share))
                            .opacity(cleaner.included.contains(kind) ? 1 : 0.3)
                    }
                }
                if cleaner.scannedBytes == 0 { RoundedRectangle(cornerRadius: 4).fill(Theme.surface) }
            }
            .animation(.snappy, value: cleaner.items)
        }
        .frame(height: 14)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func row(_ kind: CacheKind) -> some View {
        let on = cleaner.included.contains(kind)
        return Button {
            if on { cleaner.included.remove(kind) } else { cleaner.included.insert(kind) }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: kind.symbol).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(kind.color.gradient, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(kind.title).foregroundStyle(.white)
                    Text(kind.detail).font(.caption2).foregroundStyle(Theme.textSecondary).lineLimit(1)
                }
                Spacer()
                Text(cleaner.phase == .scanning ? "…" : CacheRules.format(cleaner.bytes(kind)))
                    .monospacedDigit().foregroundStyle(Theme.textSecondary)
                Image(systemName: on ? "checkmark.circle.fill" : "circle").foregroundStyle(on ? Theme.accent : Color.secondary)
            }
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(on ? 0.08 : 0.03)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(kind.title)
        .accessibilityValue(on ? "Included" : "Not included")
    }

    // MARK: Right: freed and the button

    private var freedCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Space freed").font(.caption).foregroundStyle(Theme.textSecondary)
            Text(CacheRules.format(cleaner.totalFreed))
                .font(.system(size: 30, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(.white)
                .contentTransition(.numericText())
                .animation(.snappy, value: cleaner.totalFreed)
            if case .done(let freed) = cleaner.phase {
                Label("Just now: \(CacheRules.format(freed))", systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.semibold)).foregroundStyle(.green)
                if cleaner.failed > 0 {
                    Text("\(cleaner.failed) item\(cleaner.failed == 1 ? " was" : "s were") in use and skipped.")
                        .font(.caption2).foregroundStyle(Theme.textSecondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 14).fill(Theme.surface))
    }

    private var action: some View {
        VStack(spacing: 6) {
            Button {
                cleaner.clean()
            } label: {
                HStack {
                    if cleaner.phase == .cleaning || cleaner.phase == .scanning { ProgressView().controlSize(.small) }
                    Text(cleaner.phase == .cleaning ? "Cleaning…" : "Clean \(CacheRules.format(cleaner.selectedBytes))")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(PurpleButtonStyle())
            .disabled(cleaner.phase != .ready || cleaner.selectedBytes == 0)
            Text("Only caches, derived data, logs and old temporary files in your own folders. Nothing else is touched.")
                .font(.caption2).foregroundStyle(Theme.textSecondary).multilineTextAlignment(.center)
        }
    }
}
