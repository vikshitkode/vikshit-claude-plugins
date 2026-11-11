import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const READ = {
  type: 'text',
  file: {
    filePath: '/repo/file',
    content: 'x',
    numLines: 1,
    startLine: 1,
    totalLines: 1,
  },
} as const

// The hooks here stand for the engine: a file of `size` bytes, and a Read
// that always answers.
const engine = (on: On, size: number) => {
  on('fs.stat', () => ({
    value: { kind: 'file', size, mtimeMs: 0, isLink: false },
  }))
  on('tool.call', () => ({ result: READ }))
}

test('a small source file is read', async ($, on) => {
  engine(on, 12_000)

  const ran = await $.tool.call({
    tool: 'Read',
    file_path: '/repo/Sources/StepCounter.swift',
  })

  expect(ran.deny).toBe(undefined)
})

test('a large file read whole is refused, with its size', async ($, on) => {
  engine(on, 400_000)

  const ran = await $.tool.call({
    tool: 'Read',
    file_path: '/repo/Sources/Generated.swift',
  })

  expect(ran.deny).toMatch(/a large file \(400 KB, about 100k tokens\)/)
  expect(ran.deny).toMatch(/offset and a limit of at most 500 lines/)
})

test('a large file read by range passes', async ($, on) => {
  engine(on, 400_000)

  const ran = await $.tool.call({
    tool: 'Read',
    file_path: '/repo/Sources/Generated.swift',
    offset: 100,
    limit: 200,
  })

  expect(ran.deny).toBe(undefined)
})

test('a range wider than the cap is still refused', async ($, on) => {
  engine(on, 400_000)

  const ran = await $.tool.call({
    tool: 'Read',
    file_path: '/repo/Sources/Generated.swift',
    limit: 2000,
  })

  expect(ran.deny).toMatch(/a large file/)
})

test('allow_large reads the whole file', async ($, on) => {
  engine(on, 400_000)

  const ran = await $.tool.call({
    tool: 'Read',
    file_path: '/repo/Sources/Generated.swift',
    allow_large: true,
  })

  expect(ran.deny).toBe(undefined)
})

test('a lockfile or generated file has the lower cap', async ($, on) => {
  engine(on, 20_000)

  for (const file_path of [
    '/repo/StepBuddy.xcodeproj/project.pbxproj',
    '/repo/Package.resolved',
    '/repo/DerivedData/Build/Logs/build.log',
    '/repo/.build/checkouts/Dep/Sources/Dep.swift',
    '/repo/Pods/Dep/Dep.swift',
  ]) {
    const ran = await $.tool.call({ tool: 'Read', file_path })

    expect(ran.deny).toMatch(/a lockfile or generated file \(20 KB/)
  }

  const source = await $.tool.call({
    tool: 'Read',
    file_path: '/repo/Sources/StepCounter.swift',
  })

  expect(source.deny).toBe(undefined)
})

test('a small lockfile is read', async ($, on) => {
  engine(on, 3_000)

  const ran = await $.tool.call({
    tool: 'Read',
    file_path: '/repo/Package.resolved',
  })

  expect(ran.deny).toBe(undefined)
})

test('an image is left to Read, whatever its size', async ($, on) => {
  engine(on, 2_000_000)

  const ran = await $.tool.call({
    tool: 'Read',
    file_path: '/repo/Screenshots/home.PNG',
  })

  expect(ran.deny).toBe(undefined)
})

test('a path that does not stat goes on to Read', async ($, on) => {
  on('fs.stat', () => {
    throw new Error('no such file')
  })
  on('tool.call', () => ({ result: READ }))

  const ran = await $.tool.call({
    tool: 'Read',
    file_path: '/repo/Sources/Missing.swift',
  })

  expect(ran.deny).toBe(undefined)
})
