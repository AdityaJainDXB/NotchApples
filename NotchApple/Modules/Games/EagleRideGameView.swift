//
//  EagleRideGameView.swift
//  NotchApple
//
//  Eagle Ride: glide over a valley as an eagle, steer around trees and rocks and grab gems. The game is a web page shared with the
//  Windows app (eagle-ride.js and eagle-ride-logic.js), shown here in a web view. ← → or A D steer (or move the mouse), Space starts,
//  P pauses. It pauses when you switch to another game or close the notch, and it follows the Games Sound switch.
//

import SwiftUI

struct EagleRideGameView: View {
    var body: some View {
        WebScriptGameView(page: "EagleRideGame", global: "NotchEagleGame", title: "Eagle Ride", usesSound: true)
    }
}
