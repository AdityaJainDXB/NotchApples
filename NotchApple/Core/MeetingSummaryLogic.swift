//
//  MeetingSummaryLogic.swift
//  Notch apple
//
//  Meeting summaries (Ultimate): Voice Notes started from a calendar event. This builds the request sent to the
//  AI you chose (the transcript only, never the audio) and the note text that is saved to the meeting's note.
//  No screens, so it can be tested; the Windows app (meetingsummary.js) runs the same vectors.
//

import Foundation

enum MeetingSummaryLogic {
    /// What to tell people before recording. Laws differ by place; the safe habit is to ask everyone.
    static let consentReminder = "Tell everyone you're recording. Some places need everyone's OK."

    /// The AI request. The title is cut to one short line so it can't smuggle in extra instructions.
    static func prompt(title: String, transcript: String) -> String {
        let t = (title.split(whereSeparator: \.isNewline).first.map(String.init) ?? "").trimmingCharacters(in: .whitespaces)
        let name = t.isEmpty ? "Meeting" : String(t.prefix(80))
        return """
        This is the transcript of a meeting called "\(name)". Reply with these sections, in this order, using only what was said:
        Summary: 3 to 5 short bullet points.
        Decisions: what was agreed (or "none").
        Action items: who does what, and by when if it was said (or "none").
        Open questions: anything left unresolved (or "none").
        Do not invent names, dates or decisions.

        \(transcript)
        """
    }

    /// The text added to the meeting's note: a Summary heading, then the AI's reply.
    static func noteSection(summary: String) -> String {
        "\n\n## Summary (recorded)\n" + summary.trimmingCharacters(in: .whitespacesAndNewlines) + "\n"
    }
}
