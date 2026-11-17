// Finds the habits that make writing read like a chatbot (the patterns on Wikipedia's "Signs of AI writing" guide, in the Humanizer
// skill's checklist) and fixes the safe ones. Runs on this PC with no model and no network. The same rules as
// NotchApple/Core/AITellChecker.swift (the Swift tests are the specification). A rough guide to writing habits, not a detector like
// ZeroGPT's: plenty of people write this way, and a clean score proves nothing.

import { wordCount } from './humanizerlogic.js';

export const RULES = [
  { label: "AI vocabulary", re: /\b(delves?|delved|delving|tapestry|testament|underscor(?:e|es|ed|ing)|pivotal|intricate|multifaceted|seamless(?:ly)?|garner(?:s|ed|ing)?|embark(?:s|ed|ing)?|elevat(?:e|es|ed|ing)|fosters?|fostered|fostering)\b/gi, weight: 2 },
  { label: "Promotional words", re: /\b(nestled|renowned|showcas(?:e|es|ed|ing)|vibrant|breathtaking|rich heritage|rich tapestry|world-class|state-of-the-art)\b/gi, weight: 2 },
  { label: "Puffed-up importance", re: /\b(plays? an? (?:vital|pivotal|crucial|key|significant) role|stands? as a|serves? as a|a testament to|leaves? a lasting|lasting legacy|in the realm of|navigat(?:e|es|ing) the (?:complexities|landscape))\b/gi, weight: 3 },
  { label: "Trailing analysis", re: /,\s*(?:highlighting|underscoring|showcasing|emphasizing|reflecting|demonstrating) (?:the|its|their|how)\b|valuable insights?/gi, weight: 2 },
  { label: "Negative parallelism", re: /\bnot only\b[^.!?]{3,80}\bbut also\b|\b(?:it'?s|it is|this is|that'?s|that is) not (?:just|only|merely) [^.!?]{2,60}[,;—-] ?(?:it'?s|but)/gi, weight: 3 },
  { label: "Stock transitions", re: /(?:^|[.!?]\s+)(?:Additionally|Moreover|Furthermore|In conclusion|In summary|Overall|Ultimately|Notably),/gi, weight: 1.5 },
  { label: "Vague authorities", re: /\b(?:experts (?:argue|say|believe)|studies (?:show|suggest|indicate)|many (?:believe|argue)|some critics|researchers say)\b/gi, weight: 2 },
  { label: "Formulaic ending", re: /\b(?:the future (?:is|looks) bright|looking ahead|despite (?:its|these) (?:success|challenges)|faces several challenges)\b/gi, weight: 2 },
  { label: "Chatbot leftovers", re: /\b(?:certainly!|great question|i hope this helps|let me know if you'?d like|feel free to|as of my last (?:update|knowledge)|based on (?:the )?available information)/gi, weight: 4 },
  { label: "Left-in placeholders", re: /\[(?:Name|Date|Company|Your [A-Za-z ]+)\]|\bXX+\b/gi, weight: 4 },
  { label: "Bold label bullets", re: /^\s*(?:[-*•]|\d+\.)\s+\*\*[^*\n]+\*\*\s*:/gim, weight: 2 },
  { label: "Markdown bold", re: /\*\*[^*\n]+\*\*/gi, weight: 1 },
  { label: "Curly quotes", re: /[“”‘’]/gi, weight: 0.5 },
];

const count = (re, text) => (text.match(re) || []).length;

export function sentenceLengths(text) {
  return String(text || '').split(/[.!?\n]/).map(wordCount).filter((n) => n > 0);
}

export function isUniform(lengths) {
  if (lengths.length < 5) return false;
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (mean <= 0) return false;
  const variance = lengths.reduce((a, n) => a + (n - mean) ** 2, 0) / lengths.length;
  return Math.sqrt(variance) / mean < 0.3;
}

/** { words, tells: [{label, count}], total, score 0-100, uniformRhythm }. A rough guide, not proof of anything. */
export function report(text) {
  text = String(text || '');
  const words = wordCount(text);
  const tells = [];
  let weighted = 0;
  for (const r of RULES) {
    const n = count(r.re, text);
    if (n > 0) { tells.push({ label: r.label, count: n }); weighted += n * r.weight; }
  }
  const dashes = [...text].filter((c) => c === '\u2014').length;
  if (dashes > 1) { tells.push({ label: 'Em dashes', count: dashes - 1 }); weighted += (dashes - 1) * 1.5; }
  const emoji = (text.match(/\p{Emoji_Presentation}/gu) || []).length;
  if (emoji > 0) { tells.push({ label: 'Emoji', count: emoji }); weighted += emoji; }
  const uniformRhythm = isUniform(sentenceLengths(text));
  const per100 = words > 0 ? (weighted / words) * 100 : 0;
  const score = words === 0 ? 0 : Math.min(100, Math.round(per100 * 10) + (uniformRhythm ? 12 : 0));
  tells.sort((a, b) => b.count - a.count);
  return { words, tells, total: tells.reduce((a, t) => a + t.count, 0), score, uniformRhythm };
}

export function verdict(score) {
  return score < 15 ? 'Reads like a person' : score < 40 ? 'A few AI habits' : score < 70 ? 'Reads like a chatbot in places' : 'Reads like a chatbot';
}

/** Fixes that cannot change the meaning: stock phrases, dashes, quotes and Markdown symbols. Everything else is left to a rewrite. */
export function autoFix(text) {
  let t = String(text || '');
  t = t.replaceAll('\u201c', '"').replaceAll('\u201d', '"').replaceAll('\u2018', "'").replaceAll('\u2019', "'");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  t = t.replace(/^\s*(Certainly|Sure|Absolutely|Of course)[!.,]\s*/gim, '');
  t = t.replace(/^\s*(Great question[!.]?|I hope this helps[!.]?|Let me know if you'?d like[^.\n]*[.!]?|Feel free to [^.\n]*[.!]?)\s*$/gim, '');
  t = t.replace(/\s*\b(?:Certainly!|Great question[!.]?|I hope this helps[!.]?)/gi, '');
  t = t.replace(/\b(serves?|stands?) as (an?|the)\b/gi, 'is $2');
  t = t.replace(/\bboasts\b/gi, 'has');
  t = t.replace(/(^|[.!?]\s+)(Additionally|Moreover|Furthermore),\s+([a-z])/g, (_, a, __, c) => a + c.toUpperCase());
  const i = t.indexOf('\u2014');
  if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\s*\u2014\s*/g, ', ');
  return t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** The tells still in a text, as one line for a second editing pass. Empty when there is nothing to fix. */
export function remainingHint(text) {
  return report(text).tells.filter((t) => t.label !== 'Curly quotes').map((t) => `${t.label} (${t.count})`).join(', ');
}
