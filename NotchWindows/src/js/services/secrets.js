// "Protect secrets" for the clipboard: spots copied text that looks like a secret (an API key or token, a private key, a
// JWT, a one-time code or a card number) so it can be kept out of the clipboard history and cleared from the clipboard a few
// seconds later. A best guess from the shape of the text, not a promise; nothing is sent anywhere. The same rules as the
// Mac's SecretLogic.swift, with the same test cases.

const test = (s, re) => re.test(s);

/// 13-19 digits (spaces and dashes allowed) that pass the Luhn check, the test every card number passes.
export function isCardNumber(s) {
  if (!test(s, /^[0-9][0-9 -]{11,22}[0-9]$/)) return false;
  const digits = [...s].filter((c) => c >= '0' && c <= '9').map(Number);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  digits.reverse().forEach((d, i) => { sum += i % 2 === 1 ? (d * 2 > 9 ? d * 2 - 9 : d * 2) : d; });
  return sum % 10 === 0;
}

export function looksSecret(text) {
  const t = String(text ?? '').trim();
  if (!t || t.length > 8000) return false;
  if (t.includes('-----BEGIN') && t.includes('PRIVATE KEY')) return true;
  if (test(t, /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/)) return true;                                   // a JWT
  if (test(t, /^(sk|pk|rk)[-_][A-Za-z0-9_-]{16,}$/)) return true;                                                      // sk-… style keys
  if (test(t, /^(ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abprs]|AKIA|ASIA|AIza)[-_A-Za-z0-9]{16,}$/)) return true;     // GitHub, GitLab, Slack, AWS, Google
  if (test(t, /^[0-9]{6}$/)) return true;                                                                              // a one-time code
  if (isCardNumber(t)) return true;
  // A long unbroken run of letters and digits (and a few symbols) with both kinds in it: a token or a password hash.
  return test(t, /^[A-Za-z0-9_\-+/=.]{32,}$/) && /[0-9]/.test(t) && /[A-Za-z]/.test(t);
}
