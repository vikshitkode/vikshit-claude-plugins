import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptEditInput, PromptEditResult } from 'claude-code'

import { parseVerdicts, proseWords } from '../hooks/spell'

// What the helper answers: `bad`, then macOS's guesses, best first.
const HELPER: Record<string, string> = {
  acheive: 'bad\tachieve',
  aceive: 'bad\tactive\tachieve',
  pstack: 'bad\tstack',
  asdfgh: 'bad\t',
  teh: 'bad\tthe\ttbh\tten',
  tets: 'bad\tlets\ttest\tgets',
}

type Stored = Record<string, unknown>

const engine = (on: On, hasHelper = true) => {
  const stored: Stored = {}
  const spawned: string[][] = []
  on('command.register', () => ({ value: { command: 'prompt-spell-check' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.exists', () => ({ value: hasHelper }))
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  on('store.set', (_, e) => {
    stored[e.key] = e.value

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.paint', () => ({
    value: { isPainted: true, text: '', cursor: 0 },
  }))
  on('process.run', (_, e) => {
    spawned.push([...e.argv])
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
  on('prompt.edit', (_, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))

  return { stored, spawned }
}

// The engine raises `prompt.edit` on the test's `$`, but this build's typings
// for a test's `$.prompt` do not list it yet.
type RaiseEdit = { edit: (e: PromptEditInput) => Promise<PromptEditResult> }

const edit = ($: Engine, e: PromptEditInput): Promise<PromptEditResult> =>
  ($.prompt as unknown as RaiseEdit).edit(e)

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
