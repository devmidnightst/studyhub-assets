// Profanity handling for chat:
//   - hate slurs  -> the whole message is blocked
//   - cuss words  -> masked (e.g. "shit" -> "s***") so the raw word isn't posted
// Matching tolerates letter-repeats and common leetspeak substitutions, and uses
// letter boundaries so innocent words ("class", "pass", "assignment") are safe.

const SUBS = { a: "a@4", b: "b8", c: "c(", e: "e3", g: "g9", i: "i1!|", l: "l1|", o: "o0", s: "s$5", t: "t+7", u: "uv", z: "z2" };

function charClass(ch) {
    const set = SUBS[ch];
    if (set) return "[" + set.replace(/[\]\\^-]/g, "\\$&") + "]";
    return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// each letter may be repeated (fuuuck) and substituted (f@ck); bounded by non-letters
function wordPattern(word) {
    return word.split("").map(c => charClass(c) + "+").join("");
}

function build(words, flags) {
    const body = words.map(wordPattern).join("|");
    return new RegExp("(?<![a-z0-9])(?:" + body + ")(?![a-z0-9])", flags);
}

// Hate slurs / always-offensive terms -> block the message entirely.
const SLURS = [
    "nigger", "nigga", "faggot", "fag", "kike", "chink", "spic", "gook",
    "wetback", "coon", "tranny", "retard", "retarded"
];

// General profanity -> masked, not blocked.
const PROFANITY = [
    "motherfucker", "fuck", "fucker", "fucking", "fucked", "fuk", "fck", "phuck",
    "shit", "bullshit", "bitch", "asshole", "dumbass", "jackass", "ass",
    "dick", "cock", "pussy", "cunt", "twat", "bastard", "douche",
    "slut", "whore", "prick", "wank", "bollocks", "piss", "damn", "goddamn"
];

const SLUR_RE = build(SLURS, "i");
const PROFANITY_RE = build(PROFANITY, "gi");

function maskWord(m) {
    if (m.length <= 1) return "*";
    return m[0] + "*".repeat(m.length - 1);
}

// Returns { clean, masked, blocked, reason }.
//   opts.mask        - mask cuss words (default true)
//   opts.blockSlurs  - block the message on slurs/hate (default true)
export function filterProfanity(text, opts = {}) {
    const { mask = true, blockSlurs = true } = opts;
    const t = String(text || "");
    if (blockSlurs) {
        SLUR_RE.lastIndex = 0;
        if (SLUR_RE.test(t)) {
            return {
                clean: t,
                masked: false,
                blocked: true,
                reason: "That word isn't allowed here. Slurs and hate speech are blocked - please keep it respectful."
            };
        }
    }
    if (!mask) return { clean: t, masked: false, blocked: false, reason: "" };
    let masked = false;
    const clean = t.replace(PROFANITY_RE, m => { masked = true; return maskWord(m); });
    return { clean, masked, blocked: false, reason: "" };
}
