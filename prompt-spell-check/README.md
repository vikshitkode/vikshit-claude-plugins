# prompt-spell-check

A Claude Code mod that spell-checks the prompt box as you type, using the macOS spell checker.

- A misspelled word is underlined in red once you move past it.
- When the correction is sure, the word is replaced the moment you type a space after it, and shown in green until the next key. A correction is sure when macOS has exactly one guess (`acheive` to `achieve`), or when its first guess swaps two neighbouring letters back (`teh` to `the`).
- When macOS has several guesses (`aceive` could be `active` or `achieve`), the word is underlined and left as you typed it.
- Press Backspace straight after a correction to put your word back. The mod then keeps that word for good and stops flagging it.
- Code is left alone: paths, URLs, backticked text, slash commands, shell lines, identifiers with capitals, digits, dots, hyphens or underscores, acronyms, and capitalised names in the middle of a sentence.
- Pasted text is underlined but never rewritten.

## Commands

| Command | Effect |
| --- | --- |
| `/prompt-spell-check` | Show whether the check is on |
| `/prompt-spell-check on`, `/prompt-spell-check off` | Turn it on or off |
| `/prompt-spell-check add <word>` | Never flag or fix this word |
| `/prompt-spell-check remove <word>` | Check the word again |
| `/prompt-spell-check list` | List the words you added |

## Requirements

macOS with the Xcode command line tools. The mod compiles `helper/spellcheck.swift` into `bin/` the first time it loads. It follows the spelling language set in System Settings, and words you taught macOS are accepted.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install prompt-spell-check --marketplace vikshitkode/vikshit-claude-plugins
```

Answer `y` to add the marketplace, then choose a scope. The user scope loads the mod in every session.

From a shell:

```
claude plugin install prompt-spell-check --marketplace vikshitkode/vikshit-claude-plugins
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `vikshitkode/vikshit-claude-plugins`, then Add plugin.

## Development

To run the mod from a folder instead of installing it, start `claude --plugin-dir <folder>`, or name the folder in `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` so every session loads it.

Run `claude plugin test .` for the tests and `claude plugin validate .` to check the manifest and hooks. Bump the number in `HELPER` in `hooks/register.ts` when the Swift helper changes, so the old binary is rebuilt.

## Known limits

- The last word of a prompt is not checked if you press Enter without a space after it.
- Some typos with an obvious correction are only underlined, because macOS offers a second guess (`sugest`: `suggest` or `surest`).
- Developer terms macOS does not know (`worktree`, `changelog`) are underlined until you add them with `/prompt-spell-check add`.
