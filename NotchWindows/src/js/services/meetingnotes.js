// A note started from a calendar event (Pro). The same rules and test vectors as the Mac's MeetingNotesLogic.swift.

/// "Standup · Wed 7 Oct". The title is trimmed to one line of at most 60 characters with no leading #.
export function heading(title, day) {
  let t = String(title ?? '').split(/\r?\n/)[0].replace(/^[#\s]+|[#\s]+$/g, '');
  if (!t) t = 'Meeting';
  return `${t.slice(0, 60)} · ${day}`;
}

export const template = (title, day, time) => `# ${heading(title, day)}\n${time}\n\n## Agenda\n- \n\n## Notes\n\n\n## Actions\n- [ ] \n`;

/// Index of a note that already starts with this meeting's heading, or -1.
export const existing = (notes, title, day) => notes.findIndex((n) => String(n).split(/\r?\n/)[0].trim() === `# ${heading(title, day)}`);
