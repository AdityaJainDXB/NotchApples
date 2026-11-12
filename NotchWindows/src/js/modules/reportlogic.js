// Settings → Report: a bug, an idea or a question as a GitHub issue that already says Windows, the version and the plan.
// Nothing is sent by the app: the issue form opens in the browser and the person reviews and submits it. No token is stored.
// The same rules as the Mac's ReportLogic.swift.

export const REPO = 'AdityaJainDXB/NotchApples';
export const KINDS = {
  bug: { title: 'Bug', label: 'bug', prompt: 'What happened, and what did you expect? Steps to repeat it help.' },
  idea: { title: 'Idea', label: 'enhancement', prompt: 'What would you like Notch Apple to do?' },
  question: { title: 'Question', label: 'question', prompt: 'What would you like to know?' },
};
export const MAX_DESCRIPTION = 4000;
const MAX_TITLE_TEXT = 70;

/// "[Windows][Pro] Bug: the first line…"
export function title(kind, platform, tier, text) {
  const first = String(text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  const short = first.length > MAX_TITLE_TEXT ? `${first.slice(0, MAX_TITLE_TEXT).trim()}…` : first;
  return `[${platform}][${tier}] ${KINDS[kind].title}: ${short || '(no summary)'}`;
}

export const labels = (kind, platform) => `${KINDS[kind].label},${platform.toLowerCase()}`;

export function environment({ platform, version, tier, system }) {
  return [`Platform: ${platform}`, `Notch Apple version: ${version}`, `Plan: ${tier}`, `System: ${system}`];
}

export function body(description, env) {
  const d = String(description || '').trim();
  const text = d.length > MAX_DESCRIPTION ? `${d.slice(0, MAX_DESCRIPTION)}\n(cut: it was very long)` : d;
  return `**Details**\n${text || '(nothing written)'}\n\n**About this install**\n${env.map((l) => `- ${l}`).join('\n')}`;
}

export function issueUrl(kind, info, description) {
  const q = new URLSearchParams({
    title: title(kind, info.platform, info.tier, description),
    labels: labels(kind, info.platform),
    body: body(description, environment(info)),
  });
  return `https://github.com/${REPO}/issues/new?${q.toString().replace(/\+/g, '%20')}`;
}

export const isReady = (description) => String(description || '').trim().length >= 10;
