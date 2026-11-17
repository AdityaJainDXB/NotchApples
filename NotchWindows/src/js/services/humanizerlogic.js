// The Humanizer's rules, the same as NotchApple/Core/HumanizerLogic.swift (the Swift tests are the specification).
// It rewrites text so it reads like a person wrote it. The checklist is the Humanizer skill (github.com/AdityaJainDXB/humanizer, CC BY-SA 4.0),
// which describes the patterns on Wikipedia's "Signs of AI writing" guide (WikiProject AI Cleanup, CC BY-SA 4.0) in its own words.
//   most words in one go:  Free 500, Pro 1,000, Ultimate no limit
//   words a month:         Free 3,000, Pro 15,000, Ultimate 40,000
//   extra words bought:    1 USD = 50,000, never run out with the month, used after the month's words

export const WORDS_PER_DOLLAR = 50000;
/** The Whop page that sells extra words. */
export const TOP_UP_URL = 'https://whop.com/notch-bcc9/humanizer-top-up/';
/** Most words in one request for a tier (0 Free, 1 Pro, 2 Ultimate); null for no limit. */
export const perRequestLimit = (tier) => (tier >= 2 ? null : tier === 1 ? 1000 : 500);
export const monthlyAllowance = (tier) => (tier >= 3 ? Number.MAX_SAFE_INTEGER : tier === 2 ? 40000 : tier === 1 ? 15000 : 3000);
export const wordCount = (text) => String(text || '').split(/\s+/).filter(Boolean).length;
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Usage as of `now`: a new month starts the monthly count again, and credits carry over. */
export function current(stored, now = new Date()) {
  const month = monthKey(now);
  const u = stored && Number.isFinite(stored.used) ? stored : { month, used: 0, credits: 0 };
  return { month, used: u.month === month ? u.used : 0, credits: Math.max(0, Number(u.credits) || 0) };
}
export const monthlyLeft = (u, tier) => Math.max(0, monthlyAllowance(tier) - u.used);
export const totalLeft = (u, tier) => monthlyLeft(u, tier) + u.credits;

/** Whether `words` words may be humanized now: { kind: 'allowed', fromMonth, fromCredits } | 'tooLong' | 'outOfWords' | 'empty'. */
export function decide(words, tier, usage) {
  if (words <= 0) return { kind: 'empty' };
  const limit = perRequestLimit(tier);
  if (limit !== null && words > limit) return { kind: 'tooLong', limit, words };
  const month = monthlyLeft(usage, tier);
  if (words <= month) return { kind: 'allowed', fromMonth: words, fromCredits: 0 };
  const extra = words - month;
  if (extra <= usage.credits) return { kind: 'allowed', fromMonth: month, fromCredits: extra };
  return { kind: 'outOfWords', needed: words, left: month + usage.credits };
}

export function applying(d, u) {
  if (d.kind !== 'allowed') return u;
  return { ...u, used: u.used + d.fromMonth, credits: Math.max(0, u.credits - d.fromCredits) };
}

export function message(d, tier) {
  if (d.kind === 'empty') return 'Paste or type some text first.';
  if (d.kind === 'tooLong') return `That is ${d.words} words. ${tier === 0 ? 'Free' : 'Pro'} humanizes up to ${d.limit} at a time${tier === 0 ? ', Pro 1,000, Ultimate as many as you like' : ', Ultimate as many as you like'}. Try a shorter piece.`;
  if (d.kind === 'outOfWords') return `You need ${d.needed} words but have ${d.left} left. Your monthly words start again on the 1st, or you can buy extra words (they never run out).`;
  return null;
}

export const dollars = (words) => Math.ceil((words / WORDS_PER_DOLLAR) * 100) / 100;

/** `style`: a sample of the person's own writing, used to match their sentence length and word choice (optional). */
export function userMessage(text, style = '') {
  let m = 'Rewrite the text between the markers so it reads like a person wrote it. Keep the meaning, the facts, the names, the numbers and any structure the task needs. Keep it about the same length. Reply with the rewritten text only: no preface, no notes, no markers.';
  const s = String(style || '').trim();
  if (s) m += `\n\nThe writer's own style, to copy (sentence length, how formal, the words they use, how they punctuate). Do not copy its subject:\n<<<STYLE\n${s.slice(0, 2000)}\nSTYLE>>>`;
  return `${m}\n\n<<<TEXT\n${text}\nTEXT>>>`;
}

/** The second pass: fix only the habits a check still found in the first rewrite. */
export const editMessage = (draft, habits) => `Edit the draft between the markers. These habits are still in it: ${habits}. Rewrite only the sentences that have them, in plain words, and leave every other sentence as it is. Keep the meaning, names and numbers. Reply with the full text only: no preface, no notes, no markers.\n\n<<<TEXT\n${draft}\nTEXT>>>`;

export const clean = (reply) => ['<<<TEXT', 'TEXT>>>', '<<<STYLE', 'STYLE>>>'].reduce((t, mk) => t.replaceAll(mk, ''), String(reply || '').trim()).trim();

export const SYSTEM = `You are a writing editor. You rewrite text so it sounds like a person wrote it and a reader would never suspect a chatbot. The patterns to remove come from Wikipedia's "Signs of AI writing" guide.

How to work: work out who the reader is and match the register (school and work stay formal and keep the structure the task needs; personal writing stays plain and natural). Use plain, specific words. If a sentence could fit any topic, cut it or replace it with a concrete fact. Keep the writer's meaning and the phrases that already sound natural. Keep technical facts accurate. Mix short and long sentences. Contractions are fine outside formal work.

Remove these patterns:
- Puffing up importance: "plays a vital/pivotal/crucial role", "stands as a symbol of", "leaves a lasting legacy", tying small details to big themes.
- Trailing "-ing" analysis: "..., highlighting its importance", "..., underscoring the need for", "valuable insights".
- Promotional tone: nestled, renowned, showcasing, vibrant, rich heritage, breathtaking.
- Vague authorities: "experts argue", "studies show", "many believe". Name the source or drop the claim.
- Formulaic endings: "Despite its success, X faces several challenges... Looking ahead, the future is bright."
- AI vocabulary: delve, tapestry, testament, underscore, pivotal, crucial, intricate, landscape (figurative), realm, foster, garner, navigate (figurative), multifaceted, seamless, robust, elevate, embark, journey (figurative), "Additionally" starting sentences.
- "serves as"/"stands as" instead of "is"; "boasts"/"features" instead of "has".
- Negative parallelisms: "not only X but also Y", "it's not just X, it's Y".
- Lists of three adjectives or phrases added to sound complete. Use two, four, or one good one.
- Calling the same thing by a new name each sentence. Repeat the plain name.
- Title Case Headings (use sentence case), scattered bold, lists that start every item with a bold label and colon, emoji in formal text, small tables that could be a sentence, curly quotes where straight ones are used.
- Em dashes used for drama. Prefer commas, full stops or brackets. One is fine; several is a tell.
- Chatbot leftovers: "Certainly!", "Great question", "I hope this helps", "Let me know if you'd like", knowledge-cutoff talk, placeholders like [Name] or XX, Markdown symbols in plain text, made-up citations.

Examples of the change (copy the move, not the words):
Before: "Our platform serves as a testament to innovation, offering seamless, robust, and intuitive solutions that empower teams."
After: "The app lets a team share files and tasks in one place. It's quick to set up and doesn't need training."
Before: "It's not just a phone, it's a gateway to a world of possibilities. Additionally, it boasts an impressive camera."
After: "It's a good phone. The camera is the best part: photos at night come out sharper than on my old one."
Before: "In conclusion, remote work plays a pivotal role in modern business — highlighting the importance of flexibility."
After: "Remote work matters because people can fit work around their lives. Most teams I know have kept at least some of it."
Before: "Climate change is a multifaceted challenge. Experts argue that urgent action is crucial."
After: "Climate change has many causes, and the IPCC's 2023 report says emissions must fall by about half by 2030."

Do not swap one tell for a fancier synonym: rewrite the sentence. Do not remove structure a school or work task requires. Do not add facts. Return only the rewritten text.`;
