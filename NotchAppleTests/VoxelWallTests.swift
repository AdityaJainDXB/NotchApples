import XCTest

final class VoxelWallTests: XCTestCase {
    func testDrawOrderCoversEveryCubeBackToFront() {
        let order = VoxelWallLogic.drawOrder
        XCTAssertEqual(order.count, VoxelWallLogic.grid * VoxelWallLogic.grid)
        XCTAssertEqual(order.first.map { $0.0 + $0.1 }, 0)
        XCTAssertEqual(order.last.map { $0.0 + $0.1 }, 2 * (VoxelWallLogic.grid - 1))
        for (a, b) in zip(order, order.dropFirst()) { XCTAssertLessThanOrEqual(a.0 + a.1, b.0 + b.1) }
    }

    func testBassInTheMiddleHighsAtTheEdges() {
        let levels = [1.0, 0.0, 0.0, 0.0]
        XCTAssertEqual(VoxelWallLogic.level(at: 0, levels: levels), 1, accuracy: 1e-9)
        XCTAssertEqual(VoxelWallLogic.level(at: 1, levels: levels), 0, accuracy: 1e-9)
        XCTAssertEqual(VoxelWallLogic.level(at: 1, levels: [0, 0, 0, 0.8]), 0.8, accuracy: 1e-9)
        XCTAssertEqual(VoxelWallLogic.distance(0, 0), 1, accuracy: 1e-9)
    }

    func testLouderMusicMeansTallerCubesAndHeightsStayInRange() {
        let quiet = VoxelWallLogic.heights(levels: [0, 0, 0, 0], time: 3)
        let loud = VoxelWallLogic.heights(levels: [1, 1, 1, 1], time: 3)
        XCTAssertGreaterThan(loud.reduce(0, +), quiet.reduce(0, +) * 3)
        XCTAssertTrue(loud.allSatisfy { $0 >= 0 && $0 <= 1.3 })
    }

    func testPausedMusicIsAlmostStillAndEasingGlides() {
        XCTAssertTrue(VoxelWallLogic.simulatedLevels(time: 1, playing: false).allSatisfy { $0 < 0.05 })
        XCTAssertGreaterThan(VoxelWallLogic.simulatedLevels(time: 0.125, playing: true)[0], 0.5)
        XCTAssertEqual(VoxelWallLogic.ease([0], toward: [1]), [0.35])
        XCTAssertEqual(VoxelWallLogic.ease([], toward: [1, 2]), [1, 2])
    }

    func testVerseShowsWordsOneByOneAcrossTheLine() {
        XCTAssertEqual(VoxelWallLogic.wordsShown(lineStart: 10, nextStart: 14, position: 10, wordCount: 4), 1)
        XCTAssertEqual(VoxelWallLogic.wordsShown(lineStart: 10, nextStart: 14, position: 11.8, wordCount: 4), 3)
        XCTAssertEqual(VoxelWallLogic.wordsShown(lineStart: 10, nextStart: 14, position: 20, wordCount: 4), 4)
        XCTAssertEqual(VoxelWallLogic.wordsShown(lineStart: 10, nextStart: nil, position: 9, wordCount: 3), 1, "never fewer than one word once the line starts")
        XCTAssertEqual(VoxelWallLogic.stack(["a", "b", "c", "d"], shown: 4), ["b", "c", "d"])
        XCTAssertEqual(VoxelWallLogic.stack(["a", "b"], shown: 1), ["a"])
    }

    func testBandsJumpUpAndSettleSlowly() {
        let up = VoxelWallLogic.easeBands([0, 0, 0, 0], toward: [1, 1, 1, 1])
        XCTAssertEqual(up[0], 0.6, accuracy: 1e-9)
        let down = VoxelWallLogic.easeBands([1, 1, 1, 1], toward: [0, 0, 0, 0])
        XCTAssertEqual(down[0], 0.88, accuracy: 1e-9)
    }
}
