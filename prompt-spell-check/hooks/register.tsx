import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  PromptBox,
  PromptDecoration,
  PromptEditInput,
  Register,
} from 'claude-code'

import type { Target } from '../types'
import {
  advance,
  applyFix,
  cycleTarget,
  finishedWord,
  follow,
  offer,
  parseVerdicts,
  proseWords,
  rowsOf,
  shownWord,
  unchecked,
  underlines,
  undoFix,
  wordAtCursor,
} from './spell'
import type { Cycle, Fix, Lexicon, Range, Verdict, Word } from './spell'

type Settings = { isEnabled: boolean; ignored: Set<string> }

/** What one load of the module remembers. A reload starts it over. */
type Session = {
  verdicts: Map<string, Verdict>
  settings: Promise<Settings> | null
  helper: Promise<void> | null
  isHelperReady: boolean
  /** Set when a check outlasted a key press, so typing stops waiting on it. */
  isHelperSlow: boolean
  /** A word finished before its check answered: the next key fixes it. */
  pending: Word | null
  lastFix: { fix: Fix; box: PromptBox } | null
  /** The word being stepped through its guesses, until the text is edited. */
  cycle: Cycle | null
  /** The word whose guesses the typeahead shows, before one is taken. */
  offered: Cycle | null
  /** What the band was last told to draw, so it is told only of a change. */
  banded: string
}

// What the band above the prompt draws: the word a step would change.
const target = atom({ plugin: 'prompt-spell-check', key: 'target' } as const, null)

// A mod has no key of its own in the prompt box. The band's Button borrows
// this engine action, so the chord bound to it (ctrl+x b unless rebound)
// presses the Button from the prompt. The action itself only runs in the
// diff panel.
const STEP_ACTION = 'app:cycleDiffBase'
const STEP_CHORD = 'ctrl+x b'
// Tab reaches only the typeahead, which asks about the word at the cursor.
const TAB_HINT = '· cursor to its end, then Tab · or '

// Bump when helper/spellcheck.swift changes, so the old binary is not reused.
const HELPER = 'bin/spellcheck-3'
// Longer inserts are pastes: they are underlined, never rewritten.
const LONGEST_TYPED = 16
// A check runs in about 20 ms. Past this the key stops waiting for it.
const TYPING_WAIT_MS = 250
const BACKGROUND_WAIT_MS = 5000
const MOST_WORDS_PER_CHECK = 500

const USAGE = [
  '/prompt-spell-check                show whether it is on',
  '/prompt-spell-check on | off       turn the spell check on or off',
  '/prompt-spell-check add <word>     never flag or fix this word',
  '/prompt-spell-check remove <word>  check this word again',
  '/prompt-spell-check list           the words you added',
].join('\n')

const loadSettings = async ($: EngineInterface): Promise<Settings> => {
  const [isEnabled, ignored] = await Promise.all([
    $.store.get('isEnabled'),
    $.store.get('ignored'),
  ])

  return {
    isEnabled: isEnabled !== false,
    ignored: new Set(
      Array.isArray(ignored)
        ? ignored.filter(word => typeof word === 'string')
        : [],
    ),
  }
}

const settingsOf = ($: EngineInterface, session: Session): Promise<Settings> =>
  (session.settings ??= loadSettings($))

const buildHelper = async (
  $: EngineInterface,
  session: Session,
): Promise<void> => {
  const binary = `${$.plugin.root}/${HELPER}`
  try {
    if (!(await $.fs.exists(binary))) {
      await $.process.run(['mkdir', '-p', `${$.plugin.root}/bin`])
      const built = await $.process.run(
        ['swiftc', '-O', `${$.plugin.root}/helper/spellcheck.swift`, '-o', binary],
        { timeoutMs: 180_000 },
      )
      if (built.exitCode !== 0) throw new Error(built.stderr.slice(0, 200))
    }
    session.isHelperReady = true
  } catch {
    $.ui.toast(
      'Spell check is off: its helper did not build. It needs macOS with the Xcode command line tools.',
    )
  }
}

const prepareHelper = ($: EngineInterface, session: Session): Promise<void> =>
  (session.helper ??= buildHelper($, session))

const check = async (
  $: EngineInterface,
  session: Session,
  words: readonly string[],
  timeoutMs: number,
): Promise<void> => {
  const fresh = words
    .filter(word => !session.verdicts.has(word))
    .slice(0, MOST_WORDS_PER_CHECK)
  if (fresh.length === 0 || !session.isHelperReady) return

  const ran = await $.process.run([`${$.plugin.root}/${HELPER}`], {
    stdin: fresh.join('\n'),
    timeoutMs,
  })
  if (ran.exitCode !== 0) return

  for (const [word, verdict] of parseVerdicts(ran.stdout)) {
    session.verdicts.set(word, verdict)
  }
}

const lexiconOf = (session: Session, settings: Settings): Lexicon => ({
  verdicts: session.verdicts,
  ignored: settings.ignored,
})

/** Tells the band which word a step would change in this box, if any. */
const syncBand = async (
  $: EngineInterface,
  session: Session,
  settings: Settings,
  box: PromptBox,
): Promise<void> => {
  const cycle = settings.isEnabled
    ? cycleTarget(box, proseWords(box), lexiconOf(session, settings), session.cycle)
    : null
  const shown: Target | null = cycle && {
    word: cycle.original,
    guesses: [...cycle.guesses],
    index: cycle.index,
  }
  const banded = JSON.stringify(shown)
  if (banded === session.banded) return

  session.banded = banded
  await update($, target, () => shown)
}

const repaint = async ($: EngineInterface, session: Session): Promise<void> => {
  const settings = await settingsOf($, session)
  const box = await $.prompt.read()
  const decorations = settings.isEnabled
    ? underlines(proseWords(box), lexiconOf(session, settings))
    : []
  await $.prompt.paint({ text: box.text, decorations })
  await syncBand($, session, settings, box)
}

/** One press of the band's Button: the next guess, written into the box. */
const step = async ($: EngineInterface, session: Session): Promise<void> => {
  const settings = await settingsOf($, session)
  const box = await $.prompt.read()
  const lexicon = lexiconOf(session, settings)
  const cycle = cycleTarget(box, proseWords(box), lexicon, session.cycle)
  if (!settings.isEnabled || cycle === null) return

  const stepped = advance(box, cycle)
  session.cycle = stepped.cycle
  session.lastFix = null
  await $.prompt.fill({
    text: stepped.box.text,
    mode: 'replace',
    cursor: stepped.box.cursor,
    decorations: underlines(proseWords(stepped.box), lexicon),
  })
  await syncBand($, session, settings, stepped.box)
}

const checkThenRepaint = async (
  $: EngineInterface,
  session: Session,
  words: readonly string[],
): Promise<void> => {
  try {
    await check($, session, words, BACKGROUND_WAIT_MS)
    session.isHelperSlow = false
    await repaint($, session)
  } catch {
    // The words stay unchecked and are asked about again at the next edit.
  }
}

/**
 * Waits for a word's check as long as a key may. A slower check is not
 * killed: its answer is kept for the pending fix.
 */
const checkWhileTyping = async (
  $: EngineInterface,
  session: Session,
  word: string,
): Promise<void> => {
  const checked = check($, session, [word], BACKGROUND_WAIT_MS).then(
    () => true,
    () => true,
  )
  const timedOut = $.clock.sleep(TYPING_WAIT_MS).then(() => false)
  if (!(await Promise.race([checked, timedOut]))) session.isHelperSlow = true
}

const keepWord = async (
  $: EngineInterface,
  settings: Settings,
  word: string,
): Promise<void> => {
  settings.ignored.add(word.toLowerCase())
  await $.store.set('ignored', [...settings.ignored])
  $.ui.toast(`Kept "${word}". /prompt-spell-check remove ${word} checks it again.`)
}

const runCommand = async (
  $: EngineInterface,
  session: Session,
  args: string,
): Promise<string> => {
  const settings = await settingsOf($, session)
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const word = rest.join(' ').toLowerCase()

  if (verb === '') {
    return `Spell check is ${settings.isEnabled ? 'on' : 'off'}.\n${USAGE}`
  }

  if (verb === 'on' || verb === 'off') {
    settings.isEnabled = verb === 'on'
    await $.store.set('isEnabled', settings.isEnabled)
    await repaint($, session)

    return `Spell check is ${verb}.`
  }

  if (verb === 'list') {
    const words = [...settings.ignored].sort()

    return words.length > 0 ? words.join('\n') : 'You have added no words.'
  }

  if ((verb === 'add' || verb === 'remove') && word !== '') {
    if (verb === 'add') settings.ignored.add(word)
    else settings.ignored.delete(word)
    await $.store.set('ignored', [...settings.ignored])
    await repaint($, session)

    return verb === 'add'
      ? `"${word}" will not be flagged or fixed.`
      : `"${word}" is checked again.`
  }

  return USAGE
}

/** The span the person just typed, when the box holds exactly that edit. */
const typedRange = (e: PromptEditInput, box: PromptBox): Range | null => {
  const length = e.inputText.length
  if (length === 0 || length > LONGEST_TYPED) return null

  const expected = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
  if (box.text !== expected) return null

  return { start: e.start, end: e.start + length }
}

const isBackspaceAt = (e: PromptEditInput, box: PromptBox): boolean =>
  e.text === box.text &&
  e.cursor === box.cursor &&
  e.inputText === '' &&
  e.end === e.cursor &&
  e.start === e.cursor - 1

export const register: Register = on => {
  const session: Session = {
    verdicts: new Map(),
    settings: null,
    helper: null,
    isHelperReady: false,
    isHelperSlow: false,
    pending: null,
    lastFix: null,
    cycle: null,
    offered: null,
    banded: 'null',
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prompt-spell-check',
      description: 'Spell check for the prompt box',
      argumentHint: 'on | off | add <word> | remove <word> | list',
    })
    void prepareHelper($, session)
    // A reload keeps the session's state: start with no word on the band.
    await update($, target, () => null)

    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const settings = await settingsOf($, session)
    const undoable = session.lastFix
    session.lastFix = null
    // A step is over once the text changes; moving the cursor keeps it.
    if (e.inputText !== '' || e.end > e.start) {
      session.cycle = null
      session.offered = null
    }

    if (settings.isEnabled && undoable && isBackspaceAt(e, undoable.box)) {
      await keepWord($, settings, undoable.fix.original)
      const box = undoFix(undoable.box, undoable.fix)
      await syncBand($, session, settings, box)

      return {
        ...box,
        decorations: underlines(proseWords(box), lexiconOf(session, settings)),
      }
    }

    const box = await next(e)
    if (!settings.isEnabled) return box

    const lexicon = lexiconOf(session, settings)
    const words = proseWords(box)
    const typed = typedRange(e, box)
    const finished = typed ? finishedWord(words, typed) : undefined

    if (
      finished &&
      !session.isHelperSlow &&
      unchecked([finished], lexicon).length > 0
    ) {
      await checkWhileTyping($, session, finished.text)
    }
    const unknown = unchecked(words, lexicon)
    if (unknown.length > 0) void checkThenRepaint($, session, unknown)

    // A late fix waits for a typed key, so a Backspace right after it still
    // means "put my word back".
    const pending = session.pending
    const candidate =
      finished ??
      (typed
        ? words.find(
            word =>
              word.isComplete &&
              word.start === pending?.start &&
              word.text === pending.text,
          )
        : undefined)
    if (typed) {
      session.pending =
        candidate && unchecked([candidate], lexicon).length > 0 ? candidate : null
    }
    const applied = candidate ? applyFix(box, candidate, lexicon) : null
    await syncBand($, session, settings, applied?.box ?? box)
    if (applied === null) {
      return {
        ...box,
        decorations: [...(box.decorations ?? []), ...underlines(words, lexicon)],
      }
    }

    session.lastFix = applied
    const flash: PromptDecoration = {
      start: applied.fix.start,
      end: applied.fix.start + applied.fix.fixed.length,
      color: 'success',
    }

    return {
      ...applied.box,
      decorations: [...underlines(proseWords(applied.box), lexicon), flash],
    }
  })

  on('prompt.change', async ($, e, next) => {
    session.lastFix = null
    const settings = await settingsOf($, session)
    // The mod's own step lands here too and is still in the box; a recalled
    // or cleared draft is not, and `cycleTarget` then starts over.
    await syncBand($, session, settings, e)
    if (settings.isEnabled) {
      const words = proseWords(e)
      void checkThenRepaint(
        $,
        session,
        unchecked(words, lexiconOf(session, settings)),
      )
    }

    return next(e)
  })

  // Taking a row writes it over the token and asks again for the new token,
  // so answering the next choice first lets each Tab step the word on.
  on('prompt.autocomplete', async ($, e, next) => {
    const rows = await next(e)
    const settings = await settingsOf($, session)
    const box = { text: e.text, cursor: e.cursor }
    const word = settings.isEnabled ? wordAtCursor(box, e.start) : undefined
    if (word === undefined) return rows

    const taken = follow(session.offered, word)
    let cycle =
      follow(session.cycle, word) ?? (taken !== null && taken.index >= 0 ? taken : null)
    if (cycle !== null) {
      session.cycle = cycle
      session.offered = null
      await syncBand($, session, settings, box)
    } else {
      if (!session.isHelperSlow) await checkWhileTyping($, session, word.text)
      cycle = offer(word, lexiconOf(session, settings))
      session.offered = cycle
    }
    if (cycle === null) return rows

    const lead = e.text.slice(e.start, word.start)

    return {
      suggestions: [
        ...rows.suggestions,
        ...rowsOf(cycle).map(choice => ({
          text: lead + choice,
          label: choice,
          description: choice === cycle.original ? 'as you typed it' : 'spelling',
        })),
      ],
    }
  })

  // Enter right after picking a guess keeps it in the box instead of sending.
  on('prompt.submit', async ($, e, next) => {
    const cycle = session.cycle
    if (
      e.origin.kind !== 'composer' ||
      e.command !== undefined ||
      cycle === null ||
      !e.text.startsWith(shownWord(cycle), cycle.start)
    ) {
      return next(e)
    }

    session.cycle = null
    session.offered = null
    const settings = await settingsOf($, session)
    await syncBand($, session, settings, { text: e.text, cursor: e.text.length })

    return { drop: `Kept "${shownWord(cycle)}". Press Enter again to send.` }
  })

  on('command.run', { command: 'prompt-spell-check' }, async ($, e) => ({
    text: await runCommand($, session, e.args),
  }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, target)
    if (e.props.hasSurvey || shown === null) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const row = (guesses: readonly string[]): string =>
      guesses.map(guess => `${guess}  `).join('')
    const current = shown.guesses[shown.index]
    const before = row(shown.guesses.slice(0, Math.max(shown.index, 0)))
    const after = row(shown.guesses.slice(shown.index + 1))

    return (
      <Box>
        <Text dimColor>{`${shown.word}: ${before}`}</Text>
        {current === undefined ? [] : [<Text color="success">{`${current}  `}</Text>]}
        {after === '' ? [] : [<Text dimColor>{after}</Text>]}
        <Text dimColor>{TAB_HINT}</Text>
        <Button
          key="next-guess"
          label="next guess"
          action={STEP_ACTION}
          onPress={() => step($, session)}
        />
        <Text dimColor>{` ${STEP_CHORD}`}</Text>
      </Box>
    )
  })
}
