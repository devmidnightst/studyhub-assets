export const OBF_OPTS = {
    compact: true,
    identifierNamesGenerator: "mangled",
    renameGlobals: false,
    // stringArray is DISABLED. Its index can desync on these ES-module files,
    // which either threw (undefined.charAt in the base64 decoder) or, worse,
    // silently returned the wrong string literal - that made dock.js's
    // shouldIntercept("href") read the wrong attribute, so internal-page links
    // navigated the whole page instead of opening a tab. Identifier mangling +
    // compaction still scramble the code without that fragility.
    stringArray: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: false,
    debugProtection: false,
    numbersToExpressions: false,
    simplify: true,
    splitStrings: false,
    transformObjectKeys: false,
    unicodeEscapeSequence: false
};
