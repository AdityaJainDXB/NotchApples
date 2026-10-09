//
//  RadarLogicTests.swift
//  Notch apple
//
//  The same vectors as NotchWindows/src/js/services/radarlogic.js (see dev/selftest or the node check in CI).
//

import XCTest

final class RadarLogicTests: XCTestCase {
    func testDistanceAndBearingKnownPoints() {
        // Dubai to Abu Dhabi, about 66 nm south-west.
        let d = RadarLogic.distanceNM(lat1: 25.2048, lon1: 55.2708, lat2: 24.4539, lon2: 54.3773)
        XCTAssertEqual(d, 66.4, accuracy: 1.5)
        let b = RadarLogic.bearing(lat1: 25.2048, lon1: 55.2708, lat2: 24.4539, lon2: 54.3773)
        XCTAssertEqual(b, 227.2, accuracy: 2)
        XCTAssertEqual(RadarLogic.bearing(lat1: 0, lon1: 0, lat2: 1, lon2: 0), 0, accuracy: 0.01)
        XCTAssertEqual(RadarLogic.bearing(lat1: 0, lon1: 0, lat2: 0, lon2: 1), 90, accuracy: 0.01)
        XCTAssertEqual(RadarLogic.distanceNM(lat1: 10, lon1: 10, lat2: 10, lon2: 10), 0, accuracy: 0.0001)
    }

    func testParsesTheFeedNearestFirstAndSkipsTheLost() {
        let json = """
        {"ac":[
          {"hex":"4ca123","flight":"EZY123  ","t":"A320","r":"G-EZAB","alt_baro":35000,"gs":450.4,"track":87.2,"baro_rate":-64,"lat":25.30,"lon":55.40},
          {"hex":"aabbcc","flight":"","r":"N12345","t":"C172","alt_baro":"ground","gs":0,"lat":25.21,"lon":55.28},
          {"hex":"deadbe","flight":"NOPOS"}
        ]}
        """
        let list = RadarLogic.parse(Data(json.utf8), lat: 25.2048, lon: 55.2708)
        XCTAssertEqual(list.count, 2)
        XCTAssertEqual(list[0].id, "aabbcc")                 // nearest first
        XCTAssertTrue(list[0].onGround)
        XCTAssertNil(list[0].altitudeFt)
        XCTAssertEqual(list[0].callsign, "N12345")           // no callsign: the registration
        XCTAssertEqual(list[1].callsign, "EZY123")           // trailing spaces trimmed
        XCTAssertEqual(list[1].altitudeFt, 35000)
        XCTAssertEqual(list[1].speedKt, 450)
        XCTAssertEqual(list[1].climbFpm, -64)
    }

    func testBadDataGivesAnEmptyList() {
        XCTAssertEqual(RadarLogic.parse(Data("nonsense".utf8), lat: 0, lon: 0), [])
        XCTAssertEqual(RadarLogic.parse(Data("{}".utf8), lat: 0, lon: 0), [])
    }

    func testRadarPositionPutsNorthUp() {
        let n = RadarLogic.position(distanceNM: 50, bearing: 0, rangeNM: 100)
        XCTAssertEqual(n.x, 0, accuracy: 1e-9); XCTAssertEqual(n.y, -0.5, accuracy: 1e-9)
        let e = RadarLogic.position(distanceNM: 100, bearing: 90, rangeNM: 100)
        XCTAssertEqual(e.x, 1, accuracy: 1e-9); XCTAssertEqual(e.y, 0, accuracy: 1e-9)
        // Past the edge it is held just outside it.
        XCTAssertEqual(RadarLogic.position(distanceNM: 500, bearing: 180, rangeNM: 100).y, 1.05, accuracy: 1e-9)
    }

    func testAltitudeWordsAndBands() {
        XCTAssertEqual(RadarLogic.altitudeLabel(35000, onGround: false), "FL350")
        XCTAssertEqual(RadarLogic.altitudeLabel(18000, onGround: false), "FL180")
        XCTAssertEqual(RadarLogic.altitudeLabel(4500, onGround: false), "4,500 ft")
        XCTAssertEqual(RadarLogic.altitudeLabel(nil, onGround: true), "ground")
        XCTAssertEqual(RadarLogic.band(nil, onGround: true), .ground)
        XCTAssertEqual(RadarLogic.band(3000, onGround: false), .low)
        XCTAssertEqual(RadarLogic.band(12000, onGround: false), .mid)
        XCTAssertEqual(RadarLogic.band(35000, onGround: false), .high)
    }

    func testTypeNamesAndCompass() {
        XCTAssertEqual(RadarLogic.typeName("a388"), "Airbus A380-800")
        XCTAssertEqual(RadarLogic.typeName("ZZZZ"), "ZZZZ")
        XCTAssertEqual(RadarLogic.typeName(""), "Unknown type")
        XCTAssertEqual(RadarLogic.compass(0), "N"); XCTAssertEqual(RadarLogic.compass(95), "E")
        XCTAssertEqual(RadarLogic.compass(227), "SW"); XCTAssertEqual(RadarLogic.compass(359), "N")
    }

    func testUrlIsRoundedAndCapped() {
        XCTAssertEqual(RadarLogic.url(lat: 25.204812, lon: 55.270839, rangeNM: 400)?.absoluteString, "https://api.adsb.lol/v2/point/25.20/55.27/250")
        XCTAssertEqual(RadarLogic.url(lat: -33.8688, lon: 151.2093, rangeNM: 50)?.absoluteString, "https://api.adsb.lol/v2/point/-33.87/151.21/50")
    }
}
