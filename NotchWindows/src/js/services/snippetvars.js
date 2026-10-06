// Placeholders in snippets: {date}, {time}, {datetime}, {weekday}, {year}, {clipboard} and {uuid} become today's values
// when the snippet is pasted or expanded. Anything else in braces is left exactly as typed. The same rule as the Mac's
// SnippetVariables.swift, with the same test cases.

/// Replaces each {name} with values[name] (names are matched in lower case); unknown ones stay as they were.
export function expand(text, values) {
  return String(text).replace(/\{([A-Za-z]+)\}/g, (whole, name) => (Object.hasOwn(values, name.toLowerCase()) ? values[name.toLowerCase()] : whole));
}

/// The values for right now. {clipboard} is read only if the snippet uses it.
export async function valuesFor(text, now = new Date()) {
  const v = {
    date: now.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }),
    time: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    datetime: now.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
    weekday: now.toLocaleDateString([], { weekday: 'long' }),
    year: String(now.getFullYear()),
    uuid: crypto.randomUUID(),
  };
  if (/\{clipboard\}/i.test(text)) { try { v.clipboard = await navigator.clipboard.readText(); } catch { v.clipboard = ''; } }
  return v;
}

export async function render(text) { return expand(text, await valuesFor(text)); }
