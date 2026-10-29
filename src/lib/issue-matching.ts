/**
 * Deterministic multilingual issue matching.
 *
 * Given the appliance the customer picked and the description they typed, this
 * module suggests **one of the issues already in the catalogue**
 * (`src/lib/appliance-issues.ts`). It is a reviewed keyword/synonym lookup — not
 * an AI model, not a translation API, and not a diagnosis:
 *
 *   * nothing is matched that is not in the catalogue for the selected appliance;
 *   * nothing is matched unless an approved phrase actually appears in the text;
 *   * a match is only ever a *suggestion* the customer must confirm.
 *
 * ## Adding synonyms (the part a future developer needs)
 *
 * Add or extend an entry in `ISSUE_PHRASE_MAPPINGS` below:
 *
 * ```ts
 * {
 *   issueId: "not-draining",                 // MUST exist in appliance-issues.ts
 *   english: ["not draining", "won't drain"],
 *   tagalog: ["hindi naglalabas ng tubig"],
 *   bisaya: ["dili mogawas ang tubig"],
 *   mixed: ["hindi na drain", "dili mo drain"],
 * }
 * ```
 *
 * Rules the tests enforce:
 *   * every `issueId` must exist in the catalogue;
 *   * phrases are normalised (case, accents, apostrophes, spacing) — write them
 *     naturally, e.g. "won't drain", and the matcher normalises both sides;
 *   * a phrase must be at least two words, unless it is listed in
 *     `DISTINCTIVE_SINGLE_WORDS` (single generic words are never matched);
 *   * phrases match on word boundaries, so "cooling" cannot match inside another
 *     word, and a negated occurrence ("hindi tumutulo") is rejected.
 *
 * Coverage is exactly the reviewed phrases below — it is deliberately not a claim
 * to understand every English, Tagalog or Bisaya phrasing.
 */

import { getApplianceIssues } from "./appliance-issues.ts";

export type PhraseLanguage = "english" | "tagalog" | "bisaya" | "mixed";

/** The outcome the customer can report after trying the preliminary checks. */
export type TroubleshootingOutcome = "resolved" | "unresolved" | "skipped";

export interface IssuePhraseMapping {
  /** Canonical issue id — must exist in `APPLIANCE_ISSUES`. */
  issueId: string;
  english: string[];
  tagalog: string[];
  bisaya: string[];
  /** Approved mixed-language variations (e.g. Bisaya + English loanword). */
  mixed: string[];
}

export type IssueMatchResult =
  | {
      kind: "match";
      issueId: string;
      /** The approved phrase that matched, for transparency in the UI. */
      matchedPhrase: string;
      language: PhraseLanguage;
      /** Specificity: the number of words in the matched phrase. */
      score: number;
    }
  | {
      kind: "ambiguous";
      /** Equally specific matches — the customer chooses, nothing is guessed. */
      candidates: {
        issueId: string;
        matchedPhrase: string;
        language: PhraseLanguage;
        score: number;
      }[];
    }
  | { kind: "none" };

/**
 * Words distinctive enough to match on their own (each names one fault and
 * nothing else). Anything not listed here must be part of a two-word phrase, which
 * is what keeps generic words like "problem", "sira", "guba" or "saba" (also
 * Bisaya for "banana") out of the matcher.
 */
export const DISTINCTIVE_SINGLE_WORDS = [
  "leaking",
  "dripping",
  "noisy",
  "rattling",
  "vibrating",
  "flickering",
  "maingay",
  "umiingay",
  "nagsaba",
  "tumutunog",
  "tumutulo",
  "nagtulo",
  "nagtatagas",
  "nagyeyelo",
  "nagkayelo",
  "kumikislap",
  "nagkidlap",
];

/** Negations. A phrase preceded by one of these is NOT a match for its issue. */
const NEGATORS = new Set([
  "hindi",
  "hinde",
  "di",
  "dili",
  "ayaw",
  "wala",
  "walang",
  "no",
  "not",
  "never",
  "doesnt",
  "dont",
  "isnt",
  "arent",
  "wont",
  "cant",
  "cannot",
]);

/**
 * Particles that may sit between a negation and the phrase it negates
 * ("hindi **na** tumutulo"). The negation guard looks through these.
 */
const BRIDGE_PARTICLES = new Set([
  "na",
  "ng",
  "nga",
  "kaayo",
  "jud",
  "gid",
  "pa",
  "lang",
  "man",
  "sad",
  "pod",
]);

/**
 * Reviewed spelling/abbreviation variants, applied to BOTH the description and
 * the phrases so the two always agree. Word-boundary anchored.
 */
const SPELLING_VARIANTS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\bref\b|\bfridge\b/g, replacement: "refrigerator" },
  { pattern: /\baircon\b|\bair con\b/g, replacement: "air conditioner" },
  { pattern: /\btv\b|\btele\b/g, replacement: "television" },
  { pattern: /\bwasher\b/g, replacement: "washing machine" },
  { pattern: /\bdryer\b/g, replacement: "clothes dryer" },
  { pattern: /\bmicrowave\b/g, replacement: "microwave oven" },
  // Common misspellings of the fault words themselves.
  { pattern: /\bcoling\b|\bcoolin\b|\bcoooling\b/g, replacement: "cooling" },
  { pattern: /\bdraning\b|\bdrainning\b/g, replacement: "draining" },
  { pattern: /\bspining\b|\bspinnin\b/g, replacement: "spinning" },
  { pattern: /\bleeking\b|\bleakin\b/g, replacement: "leaking" },
  { pattern: /\bheatting\b|\bheatin\b/g, replacement: "heating" },
];

/**
 * Normalises a description or an approved phrase: lower case, accents and
 * apostrophes removed ("won't" → "wont"), punctuation to spaces, whitespace
 * collapsed, then the reviewed spelling variants applied. Pure — it never touches
 * the customer's original text, which is stored and displayed unchanged.
 */
export function normalizeDescription(text: string): string {
  let value = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2019\u2018`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const variant of SPELLING_VARIANTS) {
    value = value.replace(variant.pattern, variant.replacement);
  }

  return value.replace(/\s+/g, " ").trim();
}

function tokenize(normalized: string): string[] {
  return normalized ? normalized.split(" ") : [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when the tokens immediately before `startIndex` negate the phrase. Looks
 * through bridge particles ("hindi na tumutulo"), and stops at the first content
 * word so "hindi lumalamig kaya tumutulo" is still read as "tumutulo".
 */
function isNegatedBefore(tokens: string[], startIndex: number): boolean {
  let index = startIndex - 1;
  while (index >= 0) {
    const token = tokens[index];
    if (NEGATORS.has(token)) return true;
    if (BRIDGE_PARTICLES.has(token)) {
      index -= 1;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * The approved multilingual synonyms.
 *
 * Keyed by canonical issue id. Appliance scoping is implicit: a phrase can only
 * ever match an appliance whose catalogue contains that issue, so the same phrase
 * may safely serve several appliances (e.g. "dili mogawas ang tubig" is *not
 * draining* for a washing machine and *not dispensing* for a water dispenser).
 *
 * Written naturally — normalisation handles case, accents and apostrophes.
 */
export const ISSUE_PHRASE_MAPPINGS: IssuePhraseMapping[] = [
  {
    // Refrigerator, Air Conditioner
    issueId: "not-cooling",
    english: [
      "not cooling",
      "isn't cooling",
      "stopped cooling",
      "not getting cold",
      "won't get cold",
      "not cold enough",
      "no cold air",
      "warmer than usual",
    ],
    tagalog: [
      "hindi lumalamig",
      "hindi na lumalamig",
      "di lumalamig",
      "hindi malamig",
      "wala nang lamig",
      "hindi gumiginaw",
    ],
    bisaya: [
      "dili bugnaw",
      "dili na bugnaw",
      "wala nay bugnaw",
      "dili mobugnaw",
      "dili kaayo bugnaw",
      "dili bugnaw bisan nagdagan",
    ],
    mixed: [
      "dili cooling",
      "dili na cooling",
      "hindi cooling",
      "hindi na cooling",
      "walang cooling",
      "no lamig",
      "dili na cold",
      "hindi na cold",
      "not cooling bisan gaandar",
      "not cooling kahit umaandar",
    ],
  },
  {
    // every appliance
    issueId: "not-turning-on",
    english: [
      "not turning on",
      "doesn't turn on",
      "does not turn on",
      "won't turn on",
      "not powering on",
      "won't power on",
      "no power",
      "not starting",
      "won't start",
    ],
    tagalog: [
      "hindi bumubukas",
      "hindi na bumubukas",
      "ayaw bumukas",
      "hindi umiilaw",
      "walang kuryente",
      "ayaw mag on",
      "hindi na nagbubukas",
    ],
    bisaya: [
      "dili mo on",
      "dili na mo on",
      "dili mobukas",
      "walay kuryente",
      "dili moandar",
      "dili na moandar",
      "dili mosiga",
    ],
    mixed: ["walang power", "dili mo power on", "hindi na mag on", "ayaw mo on", "no power gyud"],
  },
  {
    // Refrigerator / Freezer
    issueId: "leaking-water",
    english: [
      "leaking water",
      "water leaking",
      "leaking",
      "water coming out",
      "dripping water",
      "puddle under",
      "water on the floor",
    ],
    tagalog: [
      "naglalabas ng tubig",
      "tumutulo",
      "may tumutulo",
      "umaagos ang tubig",
      "nagtatagas",
      "may tagas",
    ],
    bisaya: ["nagtulo", "nagtulo ang tubig", "naay nagtulo", "naay tubig sa salog"],
    mixed: ["may leak", "may leaking", "naay leak", "tubig leaking", "may tumutulo na tubig"],
  },
  {
    // Washing Machine, Rice Cooker, Water Dispenser, Electric Kettle, Water Heater
    issueId: "leaking",
    english: [
      "leaking",
      "water leaking",
      "leaking water",
      "water coming out",
      "dripping water",
      "water on the floor",
    ],
    tagalog: ["naglalabas ng tubig", "tumutulo", "may tumutulo", "nagtatagas", "may tagas"],
    bisaya: ["nagtulo", "nagtulo ang tubig", "naay nagtulo", "naay tubig sa salog"],
    mixed: ["may leak", "may leaking", "naay leak", "tubig leaking"],
  },
  {
    // Refrigerator, Air Conditioner
    issueId: "making-unusual-noise",
    english: [
      "making noise",
      "unusual noise",
      "loud noise",
      "strange noise",
      "weird noise",
      "noisy",
      "rattling",
      "grinding noise",
      "buzzing noise",
    ],
    tagalog: ["maingay", "umiingay", "may ingay", "sobrang ingay", "kakaibang ingay", "tumutunog"],
    bisaya: [
      "nagsaba",
      "saba kaayo",
      "naay saba",
      "naay tingog",
      "kusog nga tingog",
      "katingad-an nga tingog",
    ],
    mixed: [
      "noisy kaayo",
      "may noise",
      "naay noise",
      "saba kaayo",
      "loud kaayo",
      "may weird na sound",
    ],
  },
  {
    // Air Conditioner, Washing Machine, Electric Fan, Microwave, Vacuum, Freezer
    issueId: "making-noise",
    english: [
      "making noise",
      "unusual noise",
      "loud noise",
      "strange noise",
      "noisy",
      "rattling",
      "grinding noise",
      "vibrating",
    ],
    tagalog: ["maingay", "umiingay", "may ingay", "sobrang ingay", "kakaibang ingay", "tumutunog"],
    bisaya: ["nagsaba", "saba kaayo", "naay saba", "naay tingog", "kusog nga tingog"],
    mixed: ["noisy kaayo", "may noise", "naay noise", "saba kaayo", "loud kaayo"],
  },
  {
    // every appliance
    issueId: "error-code",
    english: [
      "error code",
      "showing an error",
      "displays an error",
      "flashing code",
      "blinking code",
      "fault code",
    ],
    tagalog: ["may error", "may error code", "nagpapakita ng error", "may code na lumalabas"],
    bisaya: ["naay error", "naay error code", "naay code", "nagpakita og error"],
    mixed: ["may error code", "naay error code", "error code lumalabas", "may code"],
  },
  {
    // Air Conditioner, Electric Fan
    issueId: "weak-airflow",
    english: [
      "weak airflow",
      "weak air",
      "low airflow",
      "barely blowing",
      "not blowing strong",
      "airflow is weak",
    ],
    tagalog: [
      "mahina ang hangin",
      "mahina ang buga",
      "hindi malakas ang hangin",
      "mahina na ang hangin",
    ],
    bisaya: ["hinay ang hangin", "hinay kaayo ang hangin", "dili kusog ang hangin", "hinay ang buga"],
    mixed: ["weak ang hangin", "hinay ang airflow", "mahina airflow", "weak kaayo ang hangin"],
  },
  {
    // Washing Machine, Electric Fan, Clothes Dryer
    issueId: "not-spinning",
    english: ["not spinning", "won't spin", "doesn't spin", "drum not turning", "not rotating"],
    tagalog: ["hindi umiikot", "hindi na umiikot", "ayaw umikot", "hindi umiikot ang drum"],
    bisaya: ["dili motuyok", "dili na motuyok", "dili motuyok ang drum", "dili moikot"],
    mixed: ["not spinning ang drum", "hindi na spin", "dili mo spin"],
  },
  {
    // Washing Machine, Clothes Dryer
    issueId: "not-draining",
    english: [
      "not draining",
      "won't drain",
      "doesn't drain",
      "water not draining",
      "standing water",
      "water stays in the drum",
    ],
    tagalog: [
      "hindi naglalabas ng tubig",
      "hindi umaagos ang tubig",
      "hindi natatanggal ang tubig",
      "ayaw labasan ng tubig",
      "may tubig pa rin sa drum",
    ],
    bisaya: [
      "dili mogawas ang tubig",
      "dili mugawas ang tubig",
      "dili mo drain",
      "naay tubig nga nahabilin",
    ],
    mixed: ["hindi na drain", "dili mo drain", "hindi draining", "water dili mogawas"],
  },
  {
    // Washing Machine
    issueId: "not-filling",
    english: ["not filling", "won't fill", "no water going in", "doesn't fill with water"],
    tagalog: [
      "hindi pumapasok ang tubig",
      "walang tubig na pumapasok",
      "hindi umaagos ang tubig papasok",
    ],
    bisaya: ["dili mosulod ang tubig", "walay tubig nga mosulod", "wala mosulod ang tubig"],
    mixed: ["hindi filling", "dili mo fill", "walay tubig nga mosulod"],
  },
  {
    // Microwave, Electric Stove, Induction Cooker, Electric Kettle, Clothes Dryer, Water Heater
    issueId: "not-heating",
    english: ["not heating", "won't heat", "doesn't heat", "not getting hot", "stays cold", "no heat"],
    tagalog: ["hindi umiinit", "hindi na umiinit", "ayaw uminit", "walang init", "hindi nag-iinit"],
    bisaya: ["dili moinit", "dili na moinit", "walay init", "dili moinit bisan gi on"],
    mixed: ["hindi na heat", "dili mo heat", "walang heat", "dili moinit bisan naka on"],
  },
  {
    // Freezer
    issueId: "not-freezing",
    english: ["not freezing", "not getting frozen", "freezer is not cold", "food not freezing"],
    tagalog: ["hindi nagyeyelo", "hindi nagyeyelo ang freezer", "walang yelo"],
    bisaya: ["dili mo yelo", "dili nagyelo ang freezer", "dili bugnaw ang freezer"],
    mixed: ["freezer dili bugnaw", "freezer hindi nagyeyelo", "not freezing ang freezer"],
  },
  {
    // Refrigerator
    issueId: "freezer-not-freezing",
    english: [
      "freezer not freezing",
      "freezer is not cold",
      "freezer not getting cold",
      "not freezing",
    ],
    tagalog: [
      "hindi nagyeyelo ang freezer",
      "walang yelo ang freezer",
      "hindi malamig ang freezer",
    ],
    bisaya: ["dili bugnaw ang freezer", "walay yelo ang freezer", "dili mo yelo ang freezer"],
    mixed: ["freezer dili bugnaw", "freezer hindi nagyeyelo", "walang ice ang freezer"],
  },
  {
    // Refrigerator
    issueId: "over-freezing",
    english: ["over freezing", "too cold", "freezing the food", "food is freezing"],
    tagalog: ["sobrang lamig", "sobrang yelo", "namumuo ang yelo"],
    bisaya: ["subra ang bugnaw", "sobra ka bugnaw", "nag yelo ang gulay"],
    mixed: ["sobrang cold", "subra ka cold", "over freezing ang gulay"],
  },
  {
    // Refrigerator
    issueId: "not-defrosting",
    english: ["not defrosting", "frost buildup inside", "ice buildup inside", "thick ice inside"],
    tagalog: ["hindi nagdedefrost", "may yelo sa loob", "makapal ang yelo sa loob"],
    bisaya: ["dili mo defrost", "naay yelo sa sulod", "baga ang yelo sa sulod"],
    mixed: ["hindi na defrost", "dili mo defrost", "ice buildup sa loob"],
  },
  {
    // Refrigerator
    issueId: "not-making-ice",
    english: ["not making ice", "ice maker not working", "no ice"],
    tagalog: ["hindi gumagawa ng yelo", "walang yelo na nagagawa"],
    bisaya: ["dili mohimo og yelo", "walay ice nga mugawas"],
    mixed: ["hindi na gumawa ng ice", "dili mo himo og ice", "walang ice"],
  },
  {
    // Air Conditioner
    issueId: "ice-frost-formation",
    english: ["ice formation", "frost buildup", "ice on the unit", "frozen coils"],
    tagalog: ["nagyeyelo", "may yelo", "namumuo ang yelo"],
    bisaya: ["naay yelo", "nag ice", "nagkayelo"],
    mixed: ["may ice ang unit", "ice buildup", "nag ice ang unit"],
  },
  {
    // Television, Air Conditioner
    issueId: "remote-not-working",
    english: [
      "remote not working",
      "remote doesn't work",
      "remote is dead",
      "remote not responding",
    ],
    tagalog: ["hindi gumagana ang remote", "ayaw gumana ng remote", "walang reaksyon ang remote"],
    bisaya: ["dili mogana ang remote", "dili moandar ang remote", "walay response ang remote"],
    mixed: ["remote dili mogana", "remote hindi gumagana", "remote not working gyud"],
  },
  {
    // Television
    issueId: "no-display",
    english: ["no display", "black screen", "screen is black", "no picture", "display not working"],
    tagalog: ["walang display", "itim ang screen", "hindi lumalabas ang picture"],
    bisaya: ["walay display", "itom ang screen", "dili mogawas ang picture"],
    mixed: ["no display gyud", "black screen ang television"],
  },
  {
    // Television
    issueId: "no-sound",
    english: ["no sound", "no audio", "sound not working", "audio not working"],
    tagalog: ["walang tunog", "walang sound", "hindi lumalabas ang tunog"],
    bisaya: ["walay tingog", "walay sound", "dili mogawas ang tingog"],
    mixed: ["no sound gyud", "walang sound", "walay sound gyud"],
  },
  {
    // Television
    issueId: "screen-flickering",
    english: [
      "screen flickering",
      "flickering screen",
      "screen keeps flickering",
      "blinking screen",
      "flickering",
    ],
    tagalog: ["kumikislap ang screen", "kumikislap", "nagkukutitap ang screen"],
    bisaya: ["nagkidlap ang screen", "nagkidlap", "naga kidlap ang screen"],
    mixed: ["screen nagkidlap", "flickering ang screen", "kumikislap ang television"],
  },
  {
    // Television
    issueId: "lines-on-screen",
    english: ["lines on screen", "vertical lines", "horizontal lines", "lines across the screen"],
    tagalog: ["may linya sa screen", "may guhit sa screen", "may linya"],
    bisaya: ["naay linya sa screen", "naay linya", "naay guhit"],
    mixed: ["may lines sa screen", "naay lines sa screen", "may linya ang television"],
  },
  {
    // Vacuum Cleaner
    issueId: "weak-suction",
    english: ["weak suction", "no suction", "not sucking", "lost suction"],
    tagalog: ["mahina ang sipsip", "hindi sumisipsip", "walang sipsip"],
    bisaya: ["hinay ang suyop", "dili mosuyop", "walay suyop"],
    mixed: ["weak ang suction", "hinay ang suction", "mahina ang suction"],
  },
  {
    // Water Dispenser
    issueId: "not-dispensing",
    english: ["not dispensing", "no water coming out", "water not coming out", "won't dispense"],
    tagalog: ["hindi lumalabas ang tubig", "walang tubig na lumalabas", "hindi tumutulo ang tubig"],
    bisaya: ["dili mogawas ang tubig", "walay tubig mogawas", "dili mo dispense"],
    mixed: ["walang tubig na lumalabas", "dili mogawas ang water"],
  },
  {
    // Water Dispenser
    issueId: "not-cooling-heating",
    english: [
      "not cooling or heating",
      "not cooling",
      "not heating",
      "no hot water",
      "no cold water",
    ],
    tagalog: [
      "hindi lumalamig o umiinit",
      "hindi lumalamig",
      "hindi umiinit",
      "walang mainit na tubig",
      "walang malamig na tubig",
    ],
    bisaya: [
      "dili mobugnaw o moinit",
      "dili mobugnaw",
      "dili moinit",
      "walay init nga tubig",
      "walay bugnaw nga tubig",
    ],
    mixed: [
      "hindi cooling o heating",
      "dili cooling o heating",
      "walang hot water",
      "walay hot water",
    ],
  },
  {
    // Rice Cooker
    issueId: "not-cooking",
    english: ["not cooking", "rice not cooking", "doesn't cook the rice", "not cooking the rice"],
    tagalog: ["hindi nagluluto", "hindi naluluto ang kanin", "hindi niluluto ang bigas"],
    bisaya: ["dili moluto", "dili maluto ang bugas", "dili moluto sa bugas"],
    mixed: ["hindi na cook ang rice", "dili mo cook ang rice", "hindi naluto ang rice"],
  },
];
export interface IndexedPhrase {
  issueId: string;
  language: PhraseLanguage;
  /** The phrase as written in the mapping (shown to the customer for context). */
  phrase: string;
  tokens: string[];
  regex: RegExp;
}

function buildPhraseIndex(): IndexedPhrase[] {
  const index: IndexedPhrase[] = [];

  for (const mapping of ISSUE_PHRASE_MAPPINGS) {
    const buckets: [PhraseLanguage, string[]][] = [
      ["english", mapping.english],
      ["tagalog", mapping.tagalog],
      ["bisaya", mapping.bisaya],
      ["mixed", mapping.mixed],
    ];

    for (const [language, phrases] of buckets) {
      for (const phrase of phrases) {
        const normalized = normalizeDescription(phrase);
        const tokens = tokenize(normalized);
        if (!tokens.length) continue;

        // A one-word phrase is only allowed when it is explicitly distinctive.
        if (tokens.length < MIN_PHRASE_TOKENS && !DISTINCTIVE_SINGLE_WORDS.includes(normalized)) {
          continue;
        }

        index.push({
          issueId: mapping.issueId,
          language,
          phrase,
          tokens,
          regex: new RegExp(`\\b${escapeRegExp(normalized)}\\b`, "g"),
        });
      }
    }
  }

  return index;
}

/** A phrase must be at least this many words, unless it is explicitly distinctive. */
export const MIN_PHRASE_TOKENS = 2;

export const PHRASE_INDEX: IndexedPhrase[] = buildPhraseIndex();

/** At most this many choices are offered when a description is ambiguous. */
export const MAX_AMBIGUOUS_CANDIDATES = 3;

/**
 * Matches a description against **the issues of the selected appliance only**.
 *
 * Returns:
 *   * `match`     — exactly one issue has the most specific approved phrase in
 *                   the text. This is a SUGGESTION: the customer must confirm it
 *                   before any troubleshooting step is shown.
 *   * `ambiguous` — two or more issues are equally specific. Nothing is chosen
 *                   for the customer; the caller shows the list.
 *   * `none`      — nothing recognisable. The description is kept as written and
 *                   the customer can pick an issue manually or continue without
 *                   troubleshooting.
 *
 * Pure and synchronous: no network, no AI model, no database round trip, so the
 * form never has to render a loading or stale state for it.
 */
export function matchIssue(params: {
  applianceType: string;
  description: string;
}): IssueMatchResult {
  const { applianceType, description } = params;

  const issues = getApplianceIssues(applianceType);
  if (!issues.length) return { kind: "none" };

  const normalized = normalizeDescription(description);
  if (!normalized) return { kind: "none" };

  // Appliance scoping: only issues this appliance actually has can be matched.
  // "Other" is never matched — it is not a fault, so it cannot be inferred.
  const candidateIds = new Set(
    issues.filter((issue) => issue.id !== "other").map((issue) => issue.id)
  );

  const tokens = tokenize(normalized);
  const best = new Map<
    string,
    { issueId: string; matchedPhrase: string; language: PhraseLanguage; score: number }
  >();

  for (const entry of PHRASE_INDEX) {
    if (!candidateIds.has(entry.issueId)) continue;

    // The regex is shared and stateful (`g`), so reset it before each scan.
    entry.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = entry.regex.exec(normalized)) !== null) {
      // Token position of the match, used by the negation guard. The prefix is
      // trimmed first: `"but "` must count as ONE token, not two — otherwise the
      // index lands on the phrase's own first word and a phrase that legitimately
      // starts with a negator ("not cooling") negates itself.
      const prefix = normalized.slice(0, match.index).trim();
      const startToken = prefix ? prefix.split(" ").length : 0;

      if (!isNegatedBefore(tokens, startToken)) {
        const score = entry.tokens.length;
        const current = best.get(entry.issueId);
        if (!current || score > current.score) {
          best.set(entry.issueId, {
            issueId: entry.issueId,
            matchedPhrase: entry.phrase,
            language: entry.language,
            score,
          });
        }
        // One non-negated occurrence is enough for this phrase.
        break;
      }

      // Defensive: never loop forever on a zero-width match.
      if (entry.regex.lastIndex === match.index) entry.regex.lastIndex += 1;
    }
  }

  if (!best.size) return { kind: "none" };

  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const tied = ranked.filter((candidate) => candidate.score === top.score);

  if (tied.length > 1) {
    return { kind: "ambiguous", candidates: tied.slice(0, MAX_AMBIGUOUS_CANDIDATES) };
  }

  return { kind: "match", ...top };
}

