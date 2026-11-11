import type { PromptBox, PromptDecoration } from 'claude-code'

export type Verdict = { kind: 'ok' } | { kind: 'misspelled'; fix: string | null }

export type Lexicon = {
  verdicts: ReadonlyMap<string, Verdict>
  /** Lower-case words the person told the mod to leave alone. */
  ignored: ReadonlySet<string>
}

export type Word = {
  start: number
  end: number
  text: string
  /** False while the cursor still touches the word's chunk. */
  isComplete: boolean
  /** Where the whitespace-delimited chunk holding the word ends. */
  chunkEnd: number
}

export type Fix = { start: number; original: string; fixed: string }

export type Range = { start: number; end: number }

// An unclosed backtick guards the rest of its line: the person is mid-code.
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*(?:`|$)/gm
const CHUNK = /\S+/g
const OPENERS = /^[("'“‘[]+/
const CLOSERS = /[.,;:!?)"'”’\]]+$/
const LETTERS = /^\p{L}+(?:['’]\p{L}+)*$/u
const HAS_INNER_CAPITAL = /^.+\p{Lu}/u
const STARTS_CAPITAL = /^\p{Lu}/u
const SENTENCE_END = /(?:^|[.!?]|\n\s*)$/

const codeRanges = (text: string): Range[] =>
  [...text.matchAll(CODE)].map(match => ({
    start: match.index,
    end: match.index + match[0].length,
  }))

/**
 * The words of a draft that are ordinary prose. Paths, identifiers, acronyms,
 * names, backticked code, slash commands and shell lines are left out.
 */
export const proseWords = ({ text, cursor }: PromptBox): Word[] => {
  if (text.startsWith('/') || text.startsWith('!')) return []

  const code = codeRanges(text)
  const words: Word[] = []

  for (const match of text.matchAll(CHUNK)) {
    const chunk = match[0]
    const chunkStart = match.index
    const chunkEnd = chunkStart + chunk.length
    if (code.some(range => chunkStart < range.end && chunkEnd > range.start)) {
      continue
    }

    const lead = OPENERS.exec(chunk)?.[0].length ?? 0
    const core = chunk.slice(lead).replace(CLOSERS, '')
    if (core.length < 2 || !LETTERS.test(core)) continue
    if (HAS_INNER_CAPITAL.test(core)) continue

    const before = text.slice(0, chunkStart).replace(/[ \t]+$/, '')
    if (STARTS_CAPITAL.test(core) && !SENTENCE_END.test(before)) continue

    words.push({
      start: chunkStart + lead,
      end: chunkStart + lead + core.length,
      text: core,
      isComplete: cursor < chunkStart || cursor > chunkEnd,
      chunkEnd,
    })
  }

  return words
}

const verdictOf = (word: Word, lexicon: Lexicon): Verdict | undefined =>
  lexicon.ignored.has(word.text.toLowerCase())
    ? { kind: 'ok' }
    : lexicon.verdicts.get(word.text)

/** The finished words nobody has a verdict for yet, each once. */
export const unchecked = (words: readonly Word[], lexicon: Lexicon): string[] => [
  ...new Set(
    words
      .filter(word => word.isComplete && verdictOf(word, lexicon) === undefined)
      .map(word => word.text),
  ),
]

export const underlines = (
  words: readonly Word[],
  lexicon: Lexicon,
): PromptDecoration[] =>
  words
    .filter(
      word => word.isComplete && verdictOf(word, lexicon)?.kind === 'misspelled',
    )
    .map(word => ({
      start: word.start,
      end: word.end,
      underline: true,
      color: 'error',
    }))

/**
 * The word the person just finished by typing whitespace after it, when it is
 * the last such word in what they typed.
 */
export const finishedWord = (
  words: readonly Word[],
  typed: Range,
): Word | undefined =>
  words.findLast(
    word =>
      word.isComplete && word.chunkEnd >= typed.start && word.chunkEnd < typed.end,
  )

/** Replaces a finished word by its sure fix, moving the cursor with the text. */
export const applyFix = (
  box: PromptBox,
  word: Word,
  lexicon: Lexicon,
): { box: PromptBox; fix: Fix } | null => {
  const verdict = verdictOf(word, lexicon)
  if (verdict?.kind !== 'misspelled' || verdict.fix === null) return null

  const fix: Fix = { start: word.start, original: word.text, fixed: verdict.fix }

  return { box: swap(box, fix.start, fix.original, fix.fixed), fix }
}

export const undoFix = (box: PromptBox, fix: Fix): PromptBox =>
  swap(box, fix.start, fix.fixed, fix.original)

const swap = (
  box: PromptBox,
  start: number,
  from: string,
  to: string,
): PromptBox => {
  const end = start + from.length

  return {
    text: box.text.slice(0, start) + to + box.text.slice(end),
    cursor: box.cursor >= end ? box.cursor + to.length - from.length : box.cursor,
  }
}

/** True when `fixed` is `word` with two neighbouring letters swapped. */
const isSwap = (word: string, fixed: string): boolean => {
  if (word.length !== fixed.length) return false

  const at = [...word].findIndex((_, index) => word[index] !== fixed[index])

  return (
    at >= 0 &&
    word[at] === fixed[at + 1] &&
    word[at + 1] === fixed[at] &&
    word.slice(at + 2) === fixed.slice(at + 2)
  )
}

/**
 * The one guess worth typing for the person: the only guess there is, or a
 * first guess that swaps two letters back. Anything else is a coin toss
 * (`aceive` is `active` or `achieve`) and is left underlined.
 */
const sureFix = (word: string, guesses: readonly string[]): string | null => {
  const [first, second] = guesses.filter(guess => guess !== '')
  if (first === undefined) return null

  return second === undefined || isSwap(word, first) ? first : null
}

/** Parses the helper's lines: `<word>\tok` or `<word>\tbad\t<guess>\t<guess>...`. */
export const parseVerdicts = (stdout: string): [string, Verdict][] =>
  stdout.split('\n').flatMap((line): [string, Verdict][] => {
    const [word, state, ...guesses] = line.split('\t')
    if (!word) return []
    if (state === 'ok') return [[word, { kind: 'ok' }]]
    if (state === 'bad') {
      return [[word, { kind: 'misspelled', fix: sureFix(word, guesses) }]]
    }

    return []
  })
