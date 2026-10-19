// Targeted hard-R rule. Fixed-size repetitions/separators avoid unbounded regex work.
// NFKD handles compatibility forms and accents; format characters cannot split tokens.
const SEP = String.raw`[\s._*\-]{0,3}`;
const HARD_R = new RegExp(
    String.raw`(?<![\p{L}\p{N}])n{1,3}` + SEP +
    String.raw`[i1!|]{1,3}` + SEP + String.raw`[g9]{1,3}` + SEP +
    String.raw`[g9]{1,3}` + SEP + String.raw`[e3]{1,3}` + SEP +
    String.raw`r{1,3}s?(?![\p{L}\p{N}])`, 'u'
);
export function hasBlockedChatTerm(text) {
    const normalized = String(text || '').normalize('NFKD').toLowerCase().replace(/[\p{M}\p{Cf}]/gu, '');
    return HARD_R.test(normalized);
}
export function rejectBlockedChatText(res, text) {
    if (!hasBlockedChatTerm(text)) return false;
    const reason = 'This message contains a blocked racial slur. Please rephrase it.';
    res.status(400).json({ ok: false, blocked: true, category: 'language', error: reason, reason });
    return true;
}
