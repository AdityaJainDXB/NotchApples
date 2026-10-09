//
//  MagneticDrop.swift
//  Notch apple
//
//  A drop target that leans towards the pointer, like a magnet: the content shifts a few points and grows slightly
//  towards a dragged file, a soft glow follows the pointer, and a small label says what happens on release.
//  Use `.magneticDrop(of:isTargeted:perform:)` wherever `.onDrop(of:isTargeted:perform:)` took files.
//

import SwiftUI
import UniformTypeIdentifiers

private struct MagnetDelegate: DropDelegate {
    let types: [UTType]
    @Binding var location: CGPoint?
    var targeted: Binding<Bool>?
    let perform: ([NSItemProvider]) -> Bool

    func validateDrop(info: DropInfo) -> Bool { info.hasItemsConforming(to: types) }
    func dropEntered(info: DropInfo) { location = info.location; targeted?.wrappedValue = true }
    func dropUpdated(info: DropInfo) -> DropProposal? { location = info.location; return DropProposal(operation: .copy) }
    func dropExited(info: DropInfo) { location = nil; targeted?.wrappedValue = false }
    func performDrop(info: DropInfo) -> Bool {
        location = nil; targeted?.wrappedValue = false
        return perform(info.itemProviders(for: types))
    }
}

struct MagneticDropModifier: ViewModifier {
    let types: [UTType]
    var isTargeted: Binding<Bool>?
    var label: String
    let perform: ([NSItemProvider]) -> Bool

    @State private var location: CGPoint?
    @State private var size: CGSize = .zero
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// How far, and which way, the content leans: at most 8 points, towards the pointer.
    private var pull: CGSize {
        guard let p = location, !reduceMotion, size.width > 0, size.height > 0 else { return .zero }
        let dx = p.x - size.width / 2, dy = p.y - size.height / 2
        let d = max(hypot(dx, dy), 1)
        let strength = min(d / (min(size.width, size.height) / 2), 1) * 8
        return CGSize(width: dx / d * strength, height: dy / d * strength)
    }

    func body(content: Content) -> some View {
        content
            .offset(pull)
            .scaleEffect(location != nil && !reduceMotion ? 1.012 : 1)
            .overlay {
                if let p = location {
                    ZStack {
                        Circle().fill(Theme.accent.opacity(0.35)).frame(width: 130, height: 130).blur(radius: 28)
                            .position(x: p.x, y: p.y)
                        Text(label)
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Capsule().fill(Theme.accent))
                            .position(x: size.width / 2, y: max(size.height - 22, 14))
                    }
                    .allowsHitTesting(false).transition(.opacity)
                }
            }
            .animation(reduceMotion ? nil : .interpolatingSpring(stiffness: 280, damping: 24), value: location == nil)
            .animation(reduceMotion ? nil : .interpolatingSpring(stiffness: 280, damping: 24), value: pull.width)
            .animation(reduceMotion ? nil : .interpolatingSpring(stiffness: 280, damping: 24), value: pull.height)
            .background(GeometryReader { geo in
                Color.clear.onAppear { size = geo.size }.onChange(of: geo.size) { _, new in size = new }
            })
            .onDrop(of: types, delegate: MagnetDelegate(types: types, location: $location, targeted: isTargeted, perform: perform))
    }
}

extension View {
    /// A file drop target that leans towards the pointer. `perform` gets the dropped items, like `onDrop`.
    func magneticDrop(of types: [UTType], label: String = "Let go to add it", isTargeted: Binding<Bool>? = nil,
                      perform: @escaping ([NSItemProvider]) -> Bool) -> some View {
        modifier(MagneticDropModifier(types: types, isTargeted: isTargeted, label: label, perform: perform))
    }
}
