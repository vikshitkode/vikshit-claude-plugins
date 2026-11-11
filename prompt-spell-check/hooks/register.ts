import type {
  EngineInterface,
  PromptBox,
  PromptDecoration,
  PromptEditInput,
  Register,
} from 'claude-code'

import {
  applyFix,
  finishedWord,
  parseVerdicts,
  proseWords,
  unchecked,
  underlines,
  undoFix,
} from './spell'
import type { Fix, Lexicon, Range, Verdict } from './spell'

type Settings = { isEnabled: boolean; ignored: Set<string> }

/** What one load of the module remembers. A reload starts it over. */
type Session = {
  verdicts: Map<string, Verdict>
  settings: Promise<Settings> | null
  helper: Promise<void> | null
  isHelperReady: boolean
  /** Set when a check outlasted a key press, so typing stops waiting on it. */
  isHelperSlow: boolean
  lastFix: { fix: Fix; box: PromptBox } | null
}

// Bump when helper/spellcheck.swift changes, so the old binary is not reused.
const HELPER = 'bin/spellcheck-2'
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

const repaint = async ($: EngineInterface, session: Session): Promise<void> => {
  const settings = await settingsOf($, session)
  const box = await $.prompt.read()
  const decorations = settings.isEnabled
    ? underlines(proseWords(box), lexiconOf(session, settings))
    : []
  await $.prompt.paint({ text: box.text, decorations })
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

const checkWhileTyping = async (
  $: EngineInterface,
  session: Session,
  word: string,
): Promise<void> => {
  try {
    await check($, session, [word], TYPING_WAIT_MS)
  } catch {
    session.isHelperSlow = true
  }
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
    lastFix: null,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prompt-spell-check',
      description: 'Spell check for the prompt box',
      argumentHint: 'on | off | add <word> | remove <word> | list',
    })
    void prepareHelper($, session)

    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const settings = await settingsOf($, session)
    const undoable = session.lastFix
    session.lastFix = null

    if (settings.isEnabled && undoable && isBackspaceAt(e, undoable.box)) {
      await keepWord($, settings, undoable.fix.original)
      const box = undoFix(undoable.box, undoable.fix)

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

    const applied = finished ? applyFix(box, finished, lexicon) : null
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

  on('command.run', { command: 'prompt-spell-check' }, async ($, e) => ({
    text: await runCommand($, session, e.args),
  }))
}
