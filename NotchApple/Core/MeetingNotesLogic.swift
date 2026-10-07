//
//  MeetingNotesLogic.swift
//  Notch apple
//
//  A note started from a calendar event (Pro): the title and time at the top, then Agenda, Notes and Actions.
//  Asking again for the same meeting on the same day opens the note you already made. No screens, so it can be
//  tested; the Windows app (meetingnotes.js) runs the same vectors.
//

import Foundation

enum MeetingNotesLogic {
    /// "Standup · Wed 7 Oct". The title is trimmed to one line of at most 60 characters with no leading #.
    static func heading(title: String, day: String) -> String {
        var t = title.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        t = t.trimmingCharacters(in: CharacterSet(charactersIn: "# ").union(.whitespaces))
        if t.isEmpty { t = "Meeting" }
        return "\(String(t.prefix(60))) · \(day)"
    }

    static func template(title: String, day: String, time: String) -> String {
        "# \(heading(title: title, day: day))\n\(time)\n\n## Agenda\n- \n\n## Notes\n\n\n## Actions\n- [ ] \n"
    }

    /// Index of a note that already starts with this meeting's heading.
    static func existing(in notes: [String], title: String, day: String) -> Int? {
        let first = "# " + heading(title: title, day: day)
        return notes.firstIndex { $0.split(whereSeparator: \.isNewline).first.map { String($0).trimmingCharacters(in: .whitespaces) } == first }
    }
}
