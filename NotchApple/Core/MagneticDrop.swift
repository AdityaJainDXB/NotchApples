//
//  MagneticDrop.swift
//  Notch apple
//
//  A file drop target with a little feedback: while a dragged file is over it the content grows slightly, a soft glow
//  sits behind it and a small label says what happens on release. It uses SwiftUI's standard
//  `.onDrop(of:isTargeted:perform:)`, which is the path that works inside the notch's panel (a custom DropDelegate
//  stopped drops from registering in 2.0.37).
//

import SwiftUI
import UniformTypeIdentifiers

struct MagneticDropModifier: ViewModifier {
    let types: [UTType]
    var isTargeted: Binding<Bool>?
    var label: String
    let perform: ([NSItemProvider]) -> Bool

    @State private var over = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .scaleEffect(over && !reduceMotion ? 1.012 : 1)
            .overlay {
                if over {
                    ZStack {
                        Circle().fill(Theme.accent.opacity(0.28)).blur(radius: 40).padding(30)
                        VStack {
                            Spacer()
                            Text(label)
                                .font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(Capsule().fill(Theme.accent))
                                .padding(.bottom, 10)
                        }
                    }
                    .allowsHitTesting(false).transition(.opacity)
                }
            }
            .animation(reduceMotion ? nil : .interpolatingSpring(stiffness: 280, damping: 24), value: over)
            .onDrop(of: types, isTargeted: Binding(get: { over }, set: { over = $0; isTargeted?.wrappedValue = $0 }), perform: perform)
    }
}

extension View {
    /// A file drop target with feedback. `perform` gets the dropped items, like `onDrop`.
    func magneticDrop(of types: [UTType], label: String = "Let go to add it", isTargeted: Binding<Bool>? = nil,
                      perform: @escaping ([NSItemProvider]) -> Bool) -> some View {
        modifier(MagneticDropModifier(types: types, isTargeted: isTargeted, label: label, perform: perform))
    }
}
