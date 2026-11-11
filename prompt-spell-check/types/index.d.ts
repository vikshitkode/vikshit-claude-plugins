/** The word the band offers to step, as the band draws it. */
export type Target = {
  /** What the person typed. */
  word: string
  /** macOS's guesses for it, best first. */
  guesses: string[]
  /** The guess the box shows now; -1 while it shows `word`. */
  index: number
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-spell-check': { target: Target | null }
  }
}
