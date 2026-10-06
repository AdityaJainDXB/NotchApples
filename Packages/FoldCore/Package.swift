// swift-tools-version: 5.9
import PackageDescription

// Lid Fold's pure logic: projection math, gesture state, lid-sensor protocol, fail-safe rules.
// Foundation only, so it builds and tests anywhere. No UI, no IOKit, no Metal.
let package = Package(
    name: "FoldCore",
    platforms: [.macOS(.v14)],
    products: [.library(name: "FoldCore", targets: ["FoldCore"])],
    targets: [
        .target(name: "FoldCore"),
        .testTarget(name: "FoldCoreTests", dependencies: ["FoldCore"])
    ],
    swiftLanguageVersions: [.v5]
)
