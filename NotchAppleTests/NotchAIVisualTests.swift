//
//  NotchAIVisualTests.swift
//  Notch Apple tests
//
//  Illustration specs: what is accepted, and every kind of thing that is refused.
//

import SceneKit
import XCTest

final class NotchAIVisualTests: XCTestCase {
    private let good = """
    Here is the model:
    ```json
    {"title":"Water molecule","explanation":"Two hydrogens bond to one oxygen.","parts":[
      {"name":"Oxygen","shape":"sphere","position":[0,0,0],"size":[1.0],"color":"#E53935","info":"The central atom."},
      {"name":"Hydrogen A","shape":"sphere","position":[1.2,0.8,0],"size":[0.5],"color":"#FFFFFF"},
      {"name":"Bond","shape":"cylinder","position":[0.6,0.4,0],"size":[0.1,1.4],"color":"#888888"}]}
    ```
    """

    private func spec(_ parts: String) -> String { "{\"title\":\"T\",\"parts\":[\(parts)]}" }
    private func part(name: String = "A", shape: String = "sphere", pos: String = "[0,0,0]", size: String = "[1]", color: String = "#FF0000") -> String {
        "{\"name\":\"\(name)\",\"shape\":\"\(shape)\",\"position\":\(pos),\"size\":\(size),\"color\":\"\(color)\"}"
    }
    private func problems(_ json: String) -> [String] {
        if case .failure(.invalid(let p)) = VisualLogic.parse(json) { return p }
        return []
    }

    func testAGoodSpecIsAccepted() {
        guard case .success(let s) = VisualLogic.parse(good) else { return XCTFail() }
        XCTAssertEqual(s.title, "Water molecule")
        XCTAssertEqual(s.parts.map(\.name), ["Oxygen", "Hydrogen A", "Bond"])
        XCTAssertEqual(s.parts[2].shape, .cylinder)
        XCTAssertEqual(s.parts[0].info, "The central atom.")
        XCTAssertEqual(s.parts[1].info, "")
    }

    func testNoJSONIsAnError() {
        XCTAssertEqual(VisualLogic.parse("I can't draw that"), .failure(.noJSON))
        XCTAssertEqual(VisualLogic.parse("{\"title\":\"x\"}"), .failure(.noJSON))
    }

    func testEveryKindOfBadPartIsRefusedWithAReason() {
        XCTAssertTrue(problems(spec(part(shape: "pyramid"))).first!.contains("unknown shape"))
        XCTAssertTrue(problems(spec(part(pos: "[0,0]"))).first!.contains("position"))
        XCTAssertTrue(problems(spec(part(pos: "[0,0,99]"))).first!.contains("position"))
        XCTAssertTrue(problems(spec(part(size: "[1,2]"))).first!.contains("needs 1 size"))
        XCTAssertTrue(problems(spec(part(shape: "box", size: "[1,1]"))).first!.contains("needs 3 size"))
        XCTAssertTrue(problems(spec(part(size: "[500]"))).first!.contains("between"))
        XCTAssertTrue(problems(spec(part(size: "[0]"))).first!.contains("between"))
        XCTAssertTrue(problems(spec(part(color: "red"))).first!.contains("colour"))
        XCTAssertTrue(problems(spec(part(name: " "))).first!.contains("no name"))
        XCTAssertTrue(problems(spec(part(name: "A") + "," + part(name: "a"))).first!.contains("used twice"))
        XCTAssertTrue(problems(spec("")).first!.contains("no parts"))
    }

    func testTooManyPartsIsRefused() {
        let many = (0..<41).map { part(name: "p\($0)") }.joined(separator: ",")
        XCTAssertTrue(problems(spec(many)).first!.contains("Too many"))
        XCTAssertEqual(VisualLogic.parse(spec((0..<40).map { part(name: "p\($0)") }.joined(separator: ","))).isSuccess, true)
    }

    func testAllProblemsAreReportedAtOnce() {
        XCTAssertEqual(problems(spec(part(shape: "pyramid") + "," + part(name: "B", color: "x"))).count, 2)
    }

    func testColours() {
        let c = VisualLogic.rgb(fromHex: "#E53935")!
        XCTAssertEqual(c.r, 229 / 255, accuracy: 0.001)
        XCTAssertNotNil(VisualLogic.rgb(fromHex: "22C55E"))
        XCTAssertNil(VisualLogic.rgb(fromHex: "#FFF"))
        XCTAssertNil(VisualLogic.rgb(fromHex: "#GGGGGG"))
    }

    func testTheCameraSitsFartherForBiggerScenes() {
        guard case .success(let small) = VisualLogic.parse(spec(part())), case .success(let big) = VisualLogic.parse(spec(part(pos: "[15,0,0]", size: "[3]"))) else { return XCTFail() }
        XCTAssertGreaterThan(VisualLogic.cameraDistance(for: big), VisualLogic.cameraDistance(for: small))
        XCTAssertGreaterThanOrEqual(VisualLogic.cameraDistance(for: small), 4)
    }

    func testThePartQuestionAsksForAccuracyAndNamesTheSketchsClaim() {
        guard case .success(let s) = VisualLogic.parse(good) else { return XCTFail() }
        let q = VisualLogic.partQuestion(part: s.parts[0], in: s)
        XCTAssertTrue(q.contains("Oxygen")); XCTAssertTrue(q.contains("Water molecule")); XCTAssertTrue(q.contains("The central atom."))
        XCTAssertTrue(q.contains("simplifies or gets anything wrong"))
    }

    func testTheSceneHasOneNamedNodePerPartAndACamera() {
        guard case .success(let spec) = VisualLogic.parse(good) else { return XCTFail() }
        let scene = VisualSceneBuilder.scene(for: spec)
        for part in spec.parts {
            let node = scene.rootNode.childNode(withName: part.name, recursively: false)
            XCTAssertNotNil(node, part.name)
            XCTAssertEqual(Double(node!.position.x), part.position[0], accuracy: 0.0001)
        }
        XCTAssertNotNil(scene.rootNode.childNode(withName: "camera", recursively: false))
        XCTAssertEqual(Double(scene.rootNode.childNode(withName: "camera", recursively: false)!.position.z), VisualLogic.cameraDistance(for: spec), accuracy: 0.0001)
    }

    func testEveryShapeBuildsAGeometry() {
        let shapes = [("sphere", "[1]"), ("box", "[1,2,3]"), ("cylinder", "[1,2]"), ("cone", "[1,2]"), ("torus", "[1,0.2]"), ("capsule", "[0.5,2]")]
        let parts = shapes.enumerated().map { part(name: "p\($0.offset)", shape: $0.element.0, size: $0.element.1) }.joined(separator: ",")
        guard case .success(let spec) = VisualLogic.parse(spec(parts)) else { return XCTFail() }
        let scene = VisualSceneBuilder.scene(for: spec)
        for i in 0..<6 { XCTAssertNotNil(scene.rootNode.childNode(withName: "p\(i)", recursively: false)?.geometry) }
    }

    func testThePromptStatesTheLimits() {
        let p = VisualLogic.prompt(topic: "a heart")
        XCTAssertTrue(p.contains("a heart")); XCTAssertTrue(p.contains("at most 40 parts")); XCTAssertTrue(p.contains("ONLY JSON"))
    }
}

private extension Result { var isSuccess: Bool { if case .success = self { true } else { false } } }
