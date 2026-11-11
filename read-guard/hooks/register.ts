import type { Register } from 'claude-code'

// A whole-file read above these sizes is refused. Roughly 4 bytes per token.
const MAX_BYTES = 64_000
const MAX_GENERATED_BYTES = 8_000

// A read that names a `limit` no larger than this always passes.
const MAX_RANGE_LINES = 500

const LOCKFILE =
  /(^|\/)(Package\.resolved|Podfile\.lock|Cartfile\.resolved|Gemfile\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|[^/]+\.pbxproj)$/
const GENERATED_FOLDER =
  /(^|\/)(DerivedData|\.build|Pods|node_modules|Carthage|xcuserdata|[^/]+\.xcresult)\//

// Read handles these itself (images are resized, PDFs are paged), so their
// byte size says little about what they cost.
const MEDIA = /\.(png|jpe?g|gif|webp|pdf)$/i

const isGenerated = (path: string): boolean =>
  LOCKFILE.test(path) || GENERATED_FOLDER.test(path)

const kilobytes = (bytes: number): string => `${Math.round(bytes / 1000)} KB`

const thousands = (tokens: number): string =>
  tokens < 1000 ? `${tokens}` : `${Math.round(tokens / 1000)}k`

export const register: Register = on => {
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const isRanged = e.limit !== undefined && e.limit <= MAX_RANGE_LINES

    if (isRanged || e.allow_large === true || MEDIA.test(e.file_path)) {
      return next(e)
    }

    const stat = await $.fs.stat(e.file_path).catch(() => undefined)

    if (stat === undefined || stat.kind !== 'file') return next(e)

    const path = e.file_path.replaceAll('\\', '/')
    const generated = isGenerated(path)
    const cap = generated ? MAX_GENERATED_BYTES : MAX_BYTES

    if (stat.size <= cap) return next(e)

    const what = generated ? 'a lockfile or generated file' : 'a large file'
    const size = `${kilobytes(stat.size)}, about ${thousands(Math.round(stat.size / 4))} tokens`

    return {
      deny:
        `${$.plugin.name}: ${e.file_path} is ${what} (${size}). ` +
        `Search it with grep, or Read a range with offset and a limit of at most ${MAX_RANGE_LINES} lines. ` +
        `Pass allow_large: true only if the whole file is really needed.`,
    }
  }).catch(($, e, next) => next(e))
}
