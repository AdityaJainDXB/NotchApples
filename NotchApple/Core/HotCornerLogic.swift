//
//  HotCornerLogic.swift
//  Notch apple
//
//  The pure parts of hot corners (no AppKit state), so the unit tests can compile them on their own:
//  the four corners, which corner a point is in, and how typed text becomes a web address.
//

import CoreGraphics
import Foundation

enum HotCorner: String, CaseIterable, Identifiable {
    case topLeft, topRight, bottomLeft, bottomRight
    var id: String { rawValue }
    var title: String {
        switch self {
        case .topLeft: "Top left"
        case .topRight: "Top right"
        case .bottomLeft: "Bottom left"
        case .bottomRight: "Bottom right"
        }
    }
}

enum HotCornerGeometry {
    /// Which corner of which screen a point is in (within 3 pt of both edges), or nil. Corners where two
    /// displays meet are ignored, since the pointer passes through them on the way across.
    static func corner(at p: CGPoint, screens: [CGRect], inset: CGFloat = 3) -> HotCorner? {
        for (i, f) in screens.enumerated() where f.insetBy(dx: -1, dy: -1).contains(p) {
            let nearLeft = p.x <= f.minX + inset, nearRight = p.x >= f.maxX - inset
            let nearBottom = p.y <= f.minY + inset, nearTop = p.y >= f.maxY - inset
            guard (nearLeft || nearRight) && (nearBottom || nearTop) else { return nil }
            let shared = screens.enumerated().contains { j, g in j != i && g.insetBy(dx: -4, dy: -4).contains(p) }
            if shared { return nil }
            switch (nearTop, nearLeft) {
            case (true, true): return .topLeft
            case (true, false): return .topRight
            case (false, true): return .bottomLeft
            case (false, false): return .bottomRight
            }
        }
        return nil
    }
}

enum HotCornerURL {
    /// "apple.com" becomes https://apple.com; anything with a scheme is kept; nil if it isn't a web address.
    static func url(from text: String) -> URL? {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !t.contains(" ") else { return nil }
        let withScheme = t.contains("://") ? t : "https://\(t)"
        guard let u = URL(string: withScheme), let host = u.host, !host.isEmpty,
              ["http", "https"].contains(u.scheme?.lowercased() ?? "") else { return nil }
        return u
    }

}
