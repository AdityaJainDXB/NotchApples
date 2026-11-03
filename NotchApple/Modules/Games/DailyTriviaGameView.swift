//
//  DailyTriviaGameView.swift
//  Notch Apple
//
//  Daily Trivia: one multiple-choice question a day (the same for everyone on the same date, chosen from a bundled list of
//  questions, no network), with a streak, a result copied to the clipboard and a Practice mode of five random questions.
//  The game is a web page shared with the Windows app (trivia.js, trivia-logic.js and trivia-questions.js), shown here in a web view.
//

import SwiftUI

struct DailyTriviaGameView: View {
    var body: some View {
        WebScriptGameView(page: "DailyTriviaGame", global: "NotchTriviaGame", title: "Daily Trivia")
    }
}
