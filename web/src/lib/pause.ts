export type PauseKey = "period" | "comma" | "hyphen" | "longHyphen" | "parens" | "header" | "ellipsis";

export type PauseMultipliers = Record<PauseKey, number>;

export const DEFAULT_PAUSE_MULTIPLIERS: PauseMultipliers = {
  period: 2.0,
  comma: 1.5,
  hyphen: 1.2,
  longHyphen: 2.5,
  parens: 1.5,
  header: 3.0,
  ellipsis: 3.0,
};

export const PAUSE_LABELS: Record<PauseKey, string> = {
  period: "Sentence (. ? !)",
  comma: "Comma (, : ;)",
  hyphen: "Short Hyphen (-)",
  longHyphen: "Long Hyphen (\u2014)",
  parens: "Parentheses ( )",
  header: "Header (ALL CAPS)",
  ellipsis: "Ellipsis (...)",
};

export const PAUSE_ORDER: PauseKey[] = [
  "period",
  "comma",
  "hyphen",
  "longHyphen",
  "parens",
  "header",
  "ellipsis",
];

function isHeader(word: string): boolean {
  if (!word || word !== word.toUpperCase()) {
    return false;
  }
  const coreWord = Array.from(word)
    .filter((char) => /\p{L}/u.test(char))
    .join("");
  if (coreWord.length === 0) {
    return false;
  }
  return coreWord !== "I" && coreWord !== "A";
}

export function getPauseMultiplier(currentWord: string, multipliers: PauseMultipliers): number {
  const cleanWord = currentWord.replace(/["'\u201D\u2019)\]}]+$/u, "");
  const lastChar = cleanWord.length > 0 ? cleanWord[cleanWord.length - 1] : "";

  // Priority order mirrors desktop schedule_next_word.
  if (isHeader(currentWord)) {
    return multipliers.header;
  }
  if (currentWord.includes("...") || currentWord.includes("\u2026")) {
    return multipliers.ellipsis;
  }
  if (cleanWord.includes("\u2014")) {
    return multipliers.longHyphen;
  }
  if (currentWord.includes("(") || currentWord.includes(")")) {
    return multipliers.parens;
  }
  if (lastChar === "." || lastChar === "?" || lastChar === "!") {
    return multipliers.period;
  }
  if (lastChar === "," || lastChar === ":" || lastChar === ";") {
    return multipliers.comma;
  }
  if (currentWord.includes("-")) {
    return multipliers.hyphen;
  }

  return 1.0;
}
