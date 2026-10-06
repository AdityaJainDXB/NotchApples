// swift-tools-version: 5.9
import PackageDescription

// Shared contract for the optional feature modules (Lid Fold, Cleaner). Foundation only, so it builds
// and tests anywhere, and the modules depend on this and never on each other.
let package = Package(
    name: "NotchKit",
    platforms: [.macOS(.v14)],
    products: [.library(name: "NotchKit", targets: ["NotchKit"])],
    targets: [
        .target(name: "NotchKit"),
        .testTarget(name: "NotchKitTests", dependencies: ["NotchKit"])
    ],
    swiftLanguageVersions: [.v5]
)
