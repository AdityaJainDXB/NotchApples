//
//  RocketGameView.swift
//  Notch Apple
//
//  Rocket League: side-on car soccer against computer players or a friend online. The game is a web page shared with the
//  Windows app (rocket.js and rocket-logic.js), shown in a web view. Friend chats and rooms open the same page already
//  pointed at an online room (see RocketMatchView in PlayCards.swift).
//

import SwiftUI

struct RocketGameView: View {
    var body: some View {
        WebScriptGameView(page: "RocketGame", global: "NotchRocketGame", title: "Rocket League")
    }
}

/// A Rocket League match against a friend or a room member, shown in the chat above the messages. Both players open the same page
/// pointed at the same online room (the first six characters of the game's id), and the one who invited plays Blue and runs the match.
struct RocketMatchView: View {
    let gid: String
    let host: Bool

    private var query: String {
        let name = String(MessengerIdentity.shared.handle.prefix(14))
        let code = String(gid.prefix(6)).uppercased()
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "Player"
        return "room=\(code)&host=\(host ? 1 : 0)&name=\(encoded)"
    }

    var body: some View {
        WebScriptGameView(page: "RocketGame", global: "NotchRocketGame", title: "Rocket League", query: query)
            .frame(maxWidth: .infinity).frame(height: 350)
    }
}
