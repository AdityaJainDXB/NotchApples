//
//  DailyWordGameView.swift
//  Notch Apple
//
//  Daily Word: a five-letter word puzzle, six guesses, one new word each day (the same for everyone on the same date, chosen
//  from a list inside the app, no network), with a streak, a share grid copied to the clipboard and a Practice mode. The game
//  is a web page shared with the Windows app (wordle.js, wordle-logic.js and wordle-words.js), shown here in a web view.
//

import SwiftUI

struct DailyWordGameView: View {
    var body: some View {
        WebScriptGameView(page: "DailyWordGame", global: "NotchWordleGame", title: "Daily Word", fetchesNYTPuzzle: true)
    }
}
