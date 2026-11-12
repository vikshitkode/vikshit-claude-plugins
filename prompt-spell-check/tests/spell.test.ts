import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type {
  On,
  PromptAutocompleteInput,
  PromptAutocompleteResult,
  PromptBox,
  PromptEditInput,
  PromptEditResult,
  PromptSubmitInput,
  PromptSubmitResult,
} from 'claude-code'

import { advance, cycleTarget, parseVerdicts, proseWords, rowsOf } from '../hooks/spell'
import type { Lexicon } from '../hooks/spell'

// What the helper answers: `bad` (or `part` for a word that begins a longer
// one), then macOS's guesses, best first.
const HELPER: Record<string, string> = {
  achiev: 'part\tachieve',
  acheive: 'bad\tachieve',
  aceive: 'bad\tactive\tachieve',
  pstack: 'bad\tstack',
  asdfgh: 'bad\t',
  teh: 'bad\tthe\ttbh\tten',
  tets: 'bad\tlets\ttest\tgets',
}

type Stored = Record<string, unknown>

// The test runner has timers; the mod's typings leave them out.
declare const setTimeout: (run: (value?: unknown) => void, ms: number) => unknown

// `isHelperLate`: each check answers only once the test calls `answer()`,
// after the typing wait has run out.
const engine = (on: On, hasHelper = true, isHelperLate = false) => {
  const stored: Stored = {}
  const spawned: string[][] = []
  let answer = (): void => {}
  const answered = new Promise<void>(resolve => {
    answer = resolve
  })
  on('clock.sleep', () =>
    isHelperLate ? { value: undefined } : new Promise<never>(() => {}),
  )
  // The box as the editor holds it: a test sets it to what an edit answered.
  const screen: { box: PromptBox } = { box: { text: '', cursor: 0 } }
  on('command.register', () => ({ value: { command: 'prompt-spell-check' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.exists', () => ({ value: hasHelper }))
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: screen.box }))
  on('prompt.fill', (_, e) => {
    screen.box = { text: e.text, cursor: e.cursor ?? e.text.length }

    return { isFilled: true }
  })
  on('prompt.autocomplete', () => ({ suggestions: [] }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.paint', () => ({
    value: { isPainted: true, text: '', cursor: 0 },
  }))
  on('process.run', async (_, e) => {
    spawned.push([...e.argv])
    if (isHelperLate && e.argv[0] !== 'swiftc') await answered
    const words = (e.init?.stdin ?? '').split('\n')
    const stdout = words
      .map(word => `${word}\t${HELPER[word] ?? 'ok'}\n`)
      .join('')

    return {
      value: {
        exitCode: 0,
        stdout,
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('prompt.edit', (_, e) => {
    screen.box = {
      text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
      cursor: e.start + e.inputText.length,
    }

    return screen.box
  })

  return { stored, spawned, screen, answer }
}

// The engine raises `prompt.edit` on the test's `$`, but this build's typings
// for a test's `$.prompt` do not list it yet.
type RaiseEdit = { edit: (e: PromptEditInput) => Promise<PromptEditResult> }

const edit = ($: Engine, e: PromptEditInput): Promise<PromptEditResult> =>
  ($.prompt as unknown as RaiseEdit).edit(e)

// The same for the typeahead's question and for the person's own Enter.
type RaisePrompt = {
  autocomplete: (e: PromptAutocompleteInput) => Promise<PromptAutocompleteResult>
  submit: (e: PromptSubmitInput) => Promise<PromptSubmitResult>
}

const rows = async ($: Engine, text: string): Promise<string[]> => {
  const start = text.search(/\S+$/)
  const asked = await ($.prompt as unknown as RaisePrompt).autocomplete({
    text,
    cursor: text.length,
    token: text.slice(start),
    start,
  })

  return asked.suggestions.map(row => row.text)
}

const enter = ($: Engine, text: string): Promise<PromptSubmitResult> =>
  ($.prompt as unknown as RaisePrompt).submit({
    text,
    wait: false,
    origin: { kind: 'composer' },
  })

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const ORIGIN = { kind: 'composer' } as const

const type = (text: string, inputText: string) => ({
  origin: ORIGIN,
  text,
  cursor: text.length,
  start: text.length,
  end: text.length,
  inputText,
})

const backspace = (text: string) => ({
  origin: ORIGIN,
  text,
  cursor: text.length,
  start: text.length - 1,
  end: text.length,
  inputText: '',
})

test('prose words leave out code, and the word being typed is not complete', () => {
  const text =
    'Fix teh `acheive` in utils.ts for myVar and JSON at /usr/bin then acheive'
  const words = proseWords({ text, cursor: text.length })

  expect(words.map(word => word.text)).toEqual([
    'Fix',
    'teh',
    'in',
    'for',
    'and',
    'at',
    'then',
    'acheive',
  ])
  expect(words.at(-1)?.isComplete).toBe(false)
  expect(words[1]?.isComplete).toBe(true)
})

test('a slash command line and a shell line have no prose words', () => {
  expect(proseWords({ text: '/prompt-spell-check add acheive ', cursor: 0 })).toEqual([])
  expect(proseWords({ text: '!gti stauts ', cursor: 0 })).toEqual([])
})

test('a name in the middle of a sentence is left alone', () => {
  const words = proseWords({ text: 'Ask Vikshit about it. Teh end ', cursor: 30 })

  expect(words.map(word => word.text)).toEqual([
    'Ask',
    'about',
    'it',
    'Teh',
    'end',
  ])
})

test('a sure typo is fixed when the word is finished', async ($, on) => {
  engine(on)
  await $.session.start(START)

  const box = await edit($, type('you can acheive', ' '))

  expect(box.text).toBe('you can achieve ')
  expect(box.cursor).toBe(16)
})

test('a sure typo whose check answers late is fixed at the next key', async ($, on) => {
  const { answer } = engine(on, true, true)
  await $.session.start(START)

  const finished = await edit($, type('you can acheive', ' '))
  expect(finished.text).toBe('you can acheive ')

  answer()
  await new Promise(resolve => setTimeout(resolve, 0))
  const next = await edit($, type(finished.text, 'i'))
  expect(next.text).toBe('you can achieve i')
  expect(next.cursor).toBe(17)
})

test('a late fix waits for a typed key, not a Backspace', async ($, on) => {
  const { answer } = engine(on, true, true)
  await $.session.start(START)

  const finished = await edit($, type('you can acheive', ' '))
  answer()
  const erased = await edit($, backspace(finished.text))
  expect(erased.text).toBe('you can acheive')
})

test('a typo with several guesses is underlined, not replaced', async ($, on) => {
  engine(on)
  await $.session.start(START)

  const box = await edit($, type('you can aceive', ' '))

  expect(box.text).toBe('you can aceive ')
  expect(box.decorations).toEqual([
    { start: 8, end: 14, underline: true, color: 'error' },
  ])
})

test('the first guess is not taken when another is as likely', async ($, on) => {
  engine(on)
  await $.session.start(START)

  const box = await edit($, type('run the tets', ' '))

  expect(box.text).toBe('run the tets ')
})

test('the fix is sure with one guess, or a first guess that swaps two letters', () => {
  const fixes = Object.fromEntries(
    parseVerdicts(
      [
        'acheive\tbad\tachieve',
        'aceive\tbad\tactive\tachieve',
        'recieve\tbad\treceive\trelieve',
        'Teh\tbad\tThe\tTbh',
        'tets\tbad\tlets\ttest',
        'wich\tbad\twith\twish\twhich',
        'asdfgh\tbad\t',
        'fine\tok',
      ].join('\n'),
    ).map(([word, verdict]) => [
      word,
      verdict.kind === 'ok' ? 'ok' : verdict.fix,
    ]),
  )

  expect(fixes).toEqual({
    acheive: 'achieve',
    aceive: null,
    recieve: 'receive',
    Teh: 'The',
    tets: null,
    wich: null,
    asdfgh: null,
    fine: 'ok',
  })
})

test('a typo is not touched while the word is still being typed', async ($, on) => {
  engine(on)
  await $.session.start(START)

  const box = await edit($, type('you can acheiv', 'e'))

  expect(box.text).toBe('you can acheive')
  expect(box.decorations ?? []).toEqual([])
})

test('a word with no sure fix is underlined and kept', async ($, on) => {
  engine(on)
  await $.session.start(START)

  const box = await edit($, type('run asdfgh', ' '))

  expect(box.text).toBe('run asdfgh ')
  expect(box.decorations).toEqual([
    { start: 4, end: 10, underline: true, color: 'error' },
  ])
})

test('trailing punctuation stays where it was', async ($, on) => {
  engine(on)
  await $.session.start(START)

  const box = await edit($, type('is it teh?', ' '))

  expect(box.text).toBe('is it the? ')
})

test('Backspace right after a fix puts the word back and keeps it for good', async ($, on) => {
  const { stored } = engine(on)
  await $.session.start(START)

  const fixed = await edit($, type('use pstack', ' '))
  expect(fixed.text).toBe('use stack ')

  const undone = await edit($, backspace(fixed.text))
  expect(undone.text).toBe('use pstack ')
  expect(undone.cursor).toBe(11)
  expect(undone.decorations ?? []).toEqual([])
  expect(stored.ignored).toEqual(['pstack'])

  const again = await edit($, type('use pstack and pstack', ' '))
  expect(again.text).toBe('use pstack and pstack ')
})

test('a Backspace later on is an ordinary Backspace', async ($, on) => {
  engine(on)
  await $.session.start(START)

  const fixed = await edit($, type('acheive', ' '))
  const more = await edit($, type(fixed.text, 'x'))
  const erased = await edit($, backspace(more.text))

  expect(erased.text).toBe('achieve ')
})

test('a pasted block is never rewritten', async ($, on) => {
  engine(on)
  await $.session.start(START)

  const box = await edit($, 
    type('', 'this pasted note says acheive twice, acheive '),
  )

  expect(box.text).toBe('this pasted note says acheive twice, acheive ')
})

test('/prompt-spell-check off stops both the fixes and the underlines', async ($, on) => {
  const { stored } = engine(on)
  await $.session.start(START)

  await $.command.run({
    command: 'prompt-spell-check',
    args: 'off',
    origin: ORIGIN,
    presentation: { isFullscreen: false, columns: 80 },
  })
  const box = await edit($, type('acheive', ' '))

  expect(box.text).toBe('acheive ')
  expect(box.decorations ?? []).toEqual([])
  expect(stored.isEnabled).toBe(false)
})

test('a word added with /prompt-spell-check add is never flagged', async ($, on) => {
  engine(on)
  await $.session.start(START)

  await $.command.run({
    command: 'prompt-spell-check',
    args: 'add Asdfgh',
    origin: ORIGIN,
    presentation: { isFullscreen: false, columns: 80 },
  })
  const box = await edit($, type('run asdfgh', ' '))

  expect(box.decorations ?? []).toEqual([])
})

test('the helper is built once when it is missing', async ($, on) => {
  const { spawned } = engine(on, false)
  await $.session.start(START)
  await edit($, type('acheive', ' '))

  expect(spawned.some(argv => argv[0] === 'swiftc')).toBe(true)
})

const BAND = {
  plugin: 'prompt-spell-check',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const lexiconOf = (lines: string[]): Lexicon => ({
  verdicts: new Map(parseVerdicts(lines.join('\n'))),
  ignored: new Set(),
})

test('the helper\'s guesses are kept with the verdict', () => {
  expect(parseVerdicts('aceive\tbad\tactive\tachieve\nasdfgh\tbad\t')).toEqual([
    [
      'aceive',
      { kind: 'misspelled', fix: null, guesses: ['active', 'achieve'], isPartial: false },
    ],
    ['asdfgh', { kind: 'misspelled', fix: null, guesses: [], isPartial: false }],
  ])
})

test('a misspelled word that begins a longer one is marked partial', () => {
  expect(parseVerdicts('achiev\tpart\tachieve')).toEqual([
    ['achiev', { kind: 'misspelled', fix: 'achieve', guesses: ['achieve'], isPartial: true }],
  ])
})

test('the typeahead rows put the next choice first, then what was typed', () => {
  const cycle = { start: 0, original: 'tets', guesses: ['lets', 'test', 'gets'], index: -1 }

  expect(rowsOf(cycle)).toEqual(['lets', 'test', 'gets'])
  expect(rowsOf({ ...cycle, index: 0 })).toEqual(['test', 'gets', 'tets'])
  expect(rowsOf({ ...cycle, index: 2 })).toEqual(['tets', 'lets', 'test'])
})

test('the typeahead offers guesses for the misspelled word at the cursor', async ($, on) => {
  engine(on)
  await $.session.start(START)

  expect(await rows($, 'you can aceive')).toEqual(['active', 'achieve'])
  expect(await rows($, 'you can (aceive')).toEqual(['(active', '(achieve'])
  expect(await rows($, 'you can achieve')).toEqual([])
  expect(await rows($, 'you can achiev')).toEqual([])
  expect(await rows($, 'see `aceive')).toEqual([])
})

test('each Tab takes the next guess, and after the last what was typed', async ($, on) => {
  engine(on)
  await $.session.start(START)

  expect(await rows($, 'you can aceive')).toEqual(['active', 'achieve'])
  expect(await rows($, 'you can active')).toEqual(['achieve', 'aceive'])
  expect(await rows($, 'you can achieve')).toEqual(['aceive', 'active'])
  expect(await rows($, 'you can aceive')).toEqual(['active', 'achieve'])
})

test('Enter after taking a guess keeps it, and the next Enter sends', async ($, on) => {
  engine(on)
  await $.session.start(START)

  await rows($, 'you can aceive')
  await rows($, 'you can achieve')

  expect(await enter($, 'you can achieve')).toEqual({
    drop: 'Kept "achieve". Press Enter again to send.',
  })
  expect(await enter($, 'you can achieve')).toEqual({ text: 'you can achieve' })
})

test('Enter sends when the guesses were shown but none was taken', async ($, on) => {
  engine(on)
  await $.session.start(START)

  await rows($, 'you can aceive')

  expect(await enter($, 'you can aceive')).toEqual({ text: 'you can aceive' })
})

test('a word typed by hand is not taken for a picked guess', async ($, on) => {
  engine(on)
  await $.session.start(START)

  await rows($, 'you can aceive')
  await edit($, backspace('you can aceive'))
  await rows($, 'you can active')

  expect(await enter($, 'you can active')).toEqual({ text: 'you can active' })
})

test('Enter after a step with the band\'s button keeps the word', async ($, on) => {
  const { screen } = engine(on)
  await $.session.start(START)

  screen.box = await edit($, type('you can aceive', ' '))
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'next-guess' })

  expect(await enter($, screen.box.text)).toEqual({
    drop: 'Kept "active". Press Enter again to send.',
  })
  await ui.unmount()
})

test('the word to step is the underlined one nearest before the cursor', () => {
  const lexicon = lexiconOf([
    'tets\tbad\tlets\ttest',
    'aceive\tbad\tactive\tachieve',
    'asdfgh\tbad\t',
  ])
  const text = 'run tets to aceive asdfgh now '
  const at = (cursor: number) =>
    cycleTarget({ text, cursor }, proseWords({ text, cursor }), lexicon, null)

  expect(at(text.length)?.original).toBe('aceive')
  expect(at(9)?.original).toBe('tets')
  expect(at(0)?.original).toBe('tets')
  expect(at(text.length)).toEqual({
    start: 12,
    original: 'aceive',
    guesses: ['active', 'achieve'],
    index: -1,
  })
})

test('a word with no guesses is never the word to step', () => {
  const text = 'run asdfgh now '
  const box = { text, cursor: text.length }

  expect(
    cycleTarget(box, proseWords(box), lexiconOf(['asdfgh\tbad\t']), null),
  ).toBe(null)
})

test('stepping goes through each guess and back to what was typed', () => {
  const lexicon = lexiconOf(['aceive\tbad\tactive\tachieve'])
  const typed = { text: 'you can aceive now ', cursor: 19 }
  const start = cycleTarget(typed, proseWords(typed), lexicon, null)
  if (start === null) throw new Error('no word to step')

  const first = advance(typed, start)
  expect(first.box).toEqual({ text: 'you can active now ', cursor: 19 })

  const second = advance(first.box, first.cycle)
  expect(second.box).toEqual({ text: 'you can achieve now ', cursor: 20 })

  const third = advance(second.box, second.cycle)
  expect(third.box).toEqual(typed)
  expect(third.cycle.index).toBe(-1)
})

test('the band\'s button steps the underlined word through the guesses', async ($, on) => {
  const { screen } = engine(on)
  await $.session.start(START)

  screen.box = await edit($, type('you can aceive', ' '))
  expect(screen.box.text).toBe('you can aceive ')

  const ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /aceive/ }))?.text).toBe('aceive: ')
  expect((await ui.find({ type: 'Text', text: /achieve/ }))?.text).toBe(
    'active  achieve  ',
  )

  await ui.press({ key: 'next-guess' })
  expect(screen.box).toEqual({ text: 'you can active ', cursor: 15 })

  await ui.press({ key: 'next-guess' })
  expect(screen.box).toEqual({ text: 'you can achieve ', cursor: 16 })

  await ui.press({ key: 'next-guess' })
  expect(screen.box).toEqual({ text: 'you can aceive ', cursor: 15 })
  await ui.unmount()
})

test('the band draws nothing of the mod\'s while no word can be stepped', async ($, on) => {
  const { screen } = engine(on)
  await $.session.start(START)

  screen.box = await edit($, type('you can achieve', ' '))
  const ui = await $.ui.mount(BAND)

  expect(await ui.find({ type: 'Button', key: 'next-guess' })).toBe(undefined)
  await ui.unmount()
})

test('typing after a step settles the word', async ($, on) => {
  const { screen } = engine(on)
  await $.session.start(START)

  screen.box = await edit($, type('you can aceive', ' '))
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'next-guess' })
  await ui.press({ key: 'next-guess' })
  screen.box = await edit($, type(screen.box.text, 'm'))
  await ui.redraw()

  expect(screen.box.text).toBe('you can achieve m')
  expect(await ui.find({ type: 'Button', key: 'next-guess' })).toBe(undefined)
  await ui.unmount()
})
