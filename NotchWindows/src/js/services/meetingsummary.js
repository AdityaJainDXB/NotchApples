// Meeting summaries (Ultimate): Voice Notes started from a calendar event. The same request and note text as the Mac's
// MeetingSummaryLogic.swift, with the same test vectors.

/// What to tell people before recording. Laws differ by place; the safe habit is to ask everyone.
export const CONSENT = "Tell everyone you're recording. Some places need everyone's OK.";

/// The AI request. The title is cut to one short line so it can't smuggle in extra instructions.
export function prompt(title, transcript) {
  const t = String(title ?? '').split(/\r?\n/)[0].trim();
  const name = t ? t.slice(0, 80) : 'Meeting';
  return `This is the transcript of a meeting called "${name}". Reply with these sections, in this order, using only what was said:
Summary: 3 to 5 short bullet points.
Decisions: what was agreed (or "none").
Action items: who does what, and by when if it was said (or "none").
Open questions: anything left unresolved (or "none").
Do not invent names, dates or decisions.

${transcript}`;
}

/// The text added to the meeting's note: a Summary heading, then the AI's reply.
export const noteSection = (summary) => `\n\n## Summary (recorded)\n${String(summary).trim()}\n`;
