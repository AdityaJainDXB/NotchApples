//
//  TetrisGameView.swift
//  Notch Apple
//
//  Tetris: the classic falling blocks with a 7-piece bag, hold, a three-piece preview, a ghost piece, line-clear scoring and
//  levels. The game is a web page shared with the Windows app (tetris.js and tetris-logic.js), shown here in a web view.
//  Arrow keys or A / D / S move, ↑ or W rotates, Space drops, C holds, P pauses. It pauses when you switch to another game
//  or close the notch, and it follows the Games Sound switch.
//

import SwiftUI

struct TetrisGameView: View {
    var body: some View {
        WebScriptGameView(page: "TetrisGame", global: "NotchTetrisGame", title: "Tetris", usesSound: true)
    }
}
