//! Pronunciation lines for non-Latin scripts.
//!
//! `any_ascii` alone is not good enough for this: it renders Mandarin as
//! run-together CamelCase ("NiHao") and drops Devanagari vowel signs entirely
//! ("नमस्ते" becomes "nmste" rather than "namaste"). Devanagari is therefore
//! transliterated directly here, and Mandarin pinyin is split back into words.

/// A readable Latin reading of `text`, or empty when it is already Latin.
pub fn latin(text: &str) -> String {
    let out = if text.chars().any(is_devanagari) {
        devanagari(text)
    } else {
        split_pinyin(&any_ascii::any_ascii(text))
    };
    if out.trim() == text.trim() || out.trim().is_empty() {
        String::new()
    } else {
        out
    }
}

fn is_devanagari(c: char) -> bool {
    ('\u{0900}'..='\u{097F}').contains(&c)
}

/// "NiHao, NiZenMeYang?" -> "ni hao, ni zen me yang?"
/// any_ascii emits one capitalised syllable per Han character, so a capital
/// letter marks the start of the next syllable.
fn split_pinyin(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() && i > 0 && !out.ends_with(' ') {
            out.push(' ');
        }
        out.extend(c.to_lowercase());
    }
    // Tidy the spacing around punctuation that the split pushed apart.
    out.replace(" ,", ",").replace(" .", ".").replace(" ?", "?").replace(" !", "!")
        .replace(" ;", ";").replace(" :", ":").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Devanagari to Latin, keeping the vowels. Consonants carry an inherent "a"
/// unless a vowel sign (matra) or virama follows, which is the rule any_ascii misses.
fn devanagari(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];

        if let Some(mut consonant) = consonant(c) {
            // A nukta right after the consonant changes which sound it is.
            if chars.get(i + 1) == Some(&'\u{093C}') {
                if let Some(modified) = with_nukta(c) {
                    consonant = modified;
                }
                i += 1;
            }
            out.push_str(consonant);
            // Look at what follows to decide whether the inherent "a" is spoken.
            match chars.get(i + 1) {
                Some('\u{094D}') => i += 1,                       // virama: no vowel at all
                Some(&next) if matra(next).is_some() => {
                    out.push_str(matra(next).unwrap());
                    i += 1;
                }
                _ => out.push('a'),                               // inherent vowel
            }
        } else if let Some(vowel) = independent_vowel(c) {
            out.push_str(vowel);
        } else if c == '\u{0902}' || c == '\u{0901}' {
            out.push('n'); // anusvara / candrabindu
        } else if c == '\u{0903}' {
            out.push('h'); // visarga
        } else if ('\u{0966}'..='\u{096F}').contains(&c) {
            out.push((b'0' + (c as u32 - 0x0966) as u8) as char); // Devanagari digits
        } else if c == '\u{0964}' || c == '\u{0965}' {
            out.push('.'); // danda
        } else if !is_devanagari(c) {
            out.push(c); // spaces, Latin, punctuation pass through
        }
        i += 1;
    }
    out
}

fn consonant(c: char) -> Option<&'static str> {
    Some(match c {
        'क' => "k", 'ख' => "kh", 'ग' => "g", 'घ' => "gh", 'ङ' => "ng",
        'च' => "ch", 'छ' => "chh", 'ज' => "j", 'झ' => "jh", 'ञ' => "ny",
        'ट' => "t", 'ठ' => "th", 'ड' => "d", 'ढ' => "dh", 'ण' => "n",
        'त' => "t", 'थ' => "th", 'द' => "d", 'ध' => "dh", 'न' => "n",
        'प' => "p", 'फ' => "ph", 'ब' => "b", 'भ' => "bh", 'म' => "m",
        'य' => "y", 'र' => "r", 'ल' => "l", 'व' => "v",
        'श' => "sh", 'ष' => "sh", 'स' => "s", 'ह' => "h",
        'ळ' => "l",
        _ => return None,
    })
}

/// A nukta (U+093C) after a consonant changes its sound: क़ = q, ज़ = z, फ़ = f.
fn with_nukta(c: char) -> Option<&'static str> {
    Some(match c {
        'क' => "q", 'ख' => "kh", 'ग' => "gh", 'ज' => "z",
        'ड' => "r", 'ढ' => "rh", 'फ' => "f",
        _ => return None,
    })
}

fn matra(c: char) -> Option<&'static str> {
    Some(match c {
        // Long vowels are doubled so they match the independent forms (आ = aa, ई = ee, ऊ = oo)
        // and stay distinguishable from the short ones in a pronunciation hint.
        '\u{093E}' => "aa", '\u{093F}' => "i",  '\u{0940}' => "ee",
        '\u{0941}' => "u",  '\u{0942}' => "oo", '\u{0943}' => "ri",
        '\u{0947}' => "e",  '\u{0948}' => "ai", '\u{094B}' => "o",
        '\u{094C}' => "au", '\u{0945}' => "e",  '\u{0949}' => "o",
        _ => return None,
    })
}

fn independent_vowel(c: char) -> Option<&'static str> {
    Some(match c {
        'अ' => "a", 'आ' => "aa", 'इ' => "i", 'ई' => "ee", 'उ' => "u", 'ऊ' => "oo",
        'ऋ' => "ri", 'ए' => "e", 'ऐ' => "ai", 'ओ' => "o", 'औ' => "au",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::latin;

    #[test]
    fn hindi_keeps_its_vowels() {
        // any_ascii gives "nmste" for this; the vowels matter for pronunciation.
        assert_eq!(latin("नमस्ते"), "namaste");
        assert_eq!(latin("आप कैसे हैं"), "aapa kaise hain");
        assert_eq!(latin("धन्यवाद"), "dhanyavaada");
    }

    #[test]
    fn mandarin_is_split_into_syllables() {
        assert_eq!(latin("你好"), "ni hao");
        assert_eq!(latin("你好，你怎么样？"), "ni hao, ni zen me yang?");
    }

    #[test]
    fn arabic_still_works() {
        let out = latin("صباح الخير");
        assert!(!out.is_empty() && out.is_ascii(), "got {out:?}");
    }

    #[test]
    fn latin_text_produces_nothing() {
        assert_eq!(latin("hello there"), "");
        assert_eq!(latin("   "), "");
    }
}
