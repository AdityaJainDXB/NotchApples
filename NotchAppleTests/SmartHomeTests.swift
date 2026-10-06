//
//  SmartHomeTests.swift
//  Notch apple tests
//
//  The Smart Home rules: reading Home Assistant's device list, tidying the server address and picking the right service.
//

import XCTest

final class SmartHomeTests: XCTestCase {
    private let sample = #"""
    [
     {"entity_id":"light.kitchen","state":"on","attributes":{"friendly_name":"Kitchen","brightness":128}},
     {"entity_id":"light.desk","state":"off","attributes":{"friendly_name":"Desk lamp"}},
     {"entity_id":"switch.fan_plug","state":"on","attributes":{"friendly_name":"Fan plug"}},
     {"entity_id":"scene.movie","state":"scening","attributes":{"friendly_name":"Movie night"}},
     {"entity_id":"cover.garage","state":"closed","attributes":{"friendly_name":"Garage"}},
     {"entity_id":"sensor.temperature","state":"21","attributes":{"friendly_name":"Temp"}},
     {"entity_id":"light.hidden","state":"on","attributes":{"hidden":true}},
     {"entity_id":"light.no_name","state":"unavailable","attributes":{}}
    ]
    """#

    func testShowsOnlyDevicesYouCanControlSortedByKindThenName() {
        let list = SmartHomeLogic.parse(Data(sample.utf8))
        XCTAssertEqual(list.map(\.id), ["light.desk", "light.kitchen", "light.no_name", "switch.fan_plug", "cover.garage", "scene.movie"])
        XCTAssertFalse(list.contains { $0.domain == "sensor" })
        XCTAssertFalse(list.contains { $0.id == "light.hidden" })
    }

    func testNamesFallBackToTheIDWords() {
        let list = SmartHomeLogic.parse(Data(sample.utf8))
        XCTAssertEqual(list.first { $0.id == "light.no_name" }?.name, "No Name")
    }

    func testOnOffAndAvailability() {
        let list = SmartHomeLogic.parse(Data(sample.utf8))
        XCTAssertTrue(list.first { $0.id == "light.kitchen" }!.isOn)
        XCTAssertFalse(list.first { $0.id == "light.desk" }!.isOn)
        XCTAssertTrue(list.first { $0.id == "scene.movie" }!.isButton)
        XCTAssertFalse(list.first { $0.id == "light.no_name" }!.isAvailable)
    }

    func testBrightnessPercentOnlyForDimmableLights() {
        let list = SmartHomeLogic.parse(Data(sample.utf8))
        XCTAssertEqual(SmartHomeLogic.brightnessPercent(list.first { $0.id == "light.kitchen" }!), 50)
        XCTAssertNil(SmartHomeLogic.brightnessPercent(list.first { $0.id == "light.desk" }!))
        XCTAssertNil(SmartHomeLogic.brightnessPercent(list.first { $0.id == "switch.fan_plug" }!))
    }

    func testServiceForEachKind() {
        let list = SmartHomeLogic.parse(Data(sample.utf8))
        func svc(_ id: String) -> String { let s = SmartHomeLogic.service(for: list.first { $0.id == id }!); return "\(s.domain).\(s.service)" }
        XCTAssertEqual(svc("light.desk"), "homeassistant.toggle")
        XCTAssertEqual(svc("scene.movie"), "scene.turn_on")
        XCTAssertEqual(svc("cover.garage"), "cover.open_cover")
    }

    func testBrightnessBodyStaysInRange() {
        XCTAssertEqual(SmartHomeLogic.brightnessBody(entity: "light.a", percent: 0)["brightness_pct"] as? Int, 1)
        XCTAssertEqual(SmartHomeLogic.brightnessBody(entity: "light.a", percent: 250)["brightness_pct"] as? Int, 100)
    }

    func testServerAddresses() {
        XCTAssertEqual(SmartHomeLogic.normalize("homeassistant.local")?.absoluteString, "http://homeassistant.local:8123")
        XCTAssertEqual(SmartHomeLogic.normalize("  192.168.1.20:8123/ ")?.absoluteString, "http://192.168.1.20:8123")
        XCTAssertEqual(SmartHomeLogic.normalize("https://ha.example.com/api/states")?.absoluteString, "https://ha.example.com")
        XCTAssertEqual(SmartHomeLogic.normalize("http://ha.local:9000")?.absoluteString, "http://ha.local:9000")
        XCTAssertNil(SmartHomeLogic.normalize(""))
        XCTAssertNil(SmartHomeLogic.normalize("ftp://nope"))
    }

    func testSummary() {
        let list = SmartHomeLogic.parse(Data(sample.utf8))
        XCTAssertEqual(SmartHomeLogic.summary(list), "2 on")
        XCTAssertEqual(SmartHomeLogic.summary([]), "Everything is off")
    }
}
