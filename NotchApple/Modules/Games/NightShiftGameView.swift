//
//  NightShiftGameView.swift
//  Notch Apple
//
//  Night Shift at Tinker's Toy Emporium: an original night-guard horror game. Watch the wind-up toys on the cameras, shut the doors
//  when one is outside, and keep the power up until 6 AM. The game is a web page shared with the Windows app (nightshift.js and
//  nightshift-logic.js), shown here in a web view. Q / A left door and light, E / D right, Space cameras, ← → look, P pause.
//  It pauses when you switch to another game or close the notch, and it follows the Games Sound switch.
//

import SwiftUI

struct NightShiftGameView: View {
    var body: some View {
        WebScriptGameView(page: "NightShiftGame", global: "NotchNightShift", title: "Night Shift", usesSound: true)
    }
}
