//
//  ScribbleGameView.swift
//  Notch Apple
//
//  Scribble: draw a word for the others to guess, and guess what they draw. Up to 10 players, with computer players if you like, alone
//  or online. The game is a web page shared with the Windows app (scribble.js and scribble-logic.js), shown in a web view. Friend chats
//  and rooms open the same page already pointed at an online room (see ScribbleMatchView).
//

import SwiftUI

struct ScribbleGameView: View {
    var body: some View {
        WebScriptGameView(page: "ScribbleGame", global: "NotchScribbleGame", title: "Scribble")
    }
}

/// A Scribble game with a friend or a room, shown in the chat above the messages. Everybody opens the same page pointed at the same online
/// room (the first six characters of the game's id); the one who invited is the host and starts the game, everyone else joins as a guest.
struct ScribbleMatchView: View {
    let gid: String
    let host: Bool

    private var query: String {
        let name = String(MessengerIdentity.shared.handle.prefix(14))
        let code = String(gid.prefix(6)).uppercased()
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "Player"
        return "room=\(code)&host=\(host ? 1 : 0)&name=\(encoded)"
    }

    var body: some View {
        WebScriptGameView(page: "ScribbleGame", global: "NotchScribbleGame", title: "Scribble", query: query)
            .frame(maxWidth: .infinity).frame(height: 460)
    }
}
