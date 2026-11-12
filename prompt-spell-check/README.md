# prompt-spell-check

A Claude Code mod that spell-checks the prompt box as you type, using the macOS spell checker.

- A misspelled word is underlined in red once you move past it.
- When the correction is sure, the word is replaced the moment you type a space after it, and shown in green until the next key. A correction is sure when macOS has exactly one guess (`acheive` to `achieve`), or when its first guess swaps two neighbouring letters back (`teh` to `the`).
- When macOS has several guesses (`aceive` could be `active` or `achieve`), the word is underlined and left as you typed it.
- While the cursor sits at the end of a misspelled word, macOS's guesses show as suggestions under the prompt. Press Tab to put the first guess in the box. Each further Tab puts in the next guess, and after the last one your own word comes back. The arrow keys and Enter pick a guess from the list too. A half-typed word (`achiev`) gets no suggestions, because it may still become a real word.
- For an underlined word behind the cursor, press `ctrl+x b`. A row above the prompt lists the guesses for the underlined word nearest before the cursor (`aceive: active  achieve`). Each press puts the next guess in the box, and after the last one your own word comes back.
- Press Enter after picking a guess to keep it. The prompt is not sent, and Claude Code shows a line saying so. Press Enter again to send. Typing anything also settles the word.
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

## Keys

| Key | Effect |
| --- | --- |
| Space after a word | Fix a sure typo |
| Tab at the end of a misspelled word | Put in the next guess |
| Enter right after picking a guess | Keep the guess instead of sending |
| Backspace right after a fix | Put your word back and keep it |
| `ctrl+x b` | Step the nearest underlined word through macOS's guesses |

Tab works through Claude Code's own suggestion list, so it only reaches the word at the cursor. A mod cannot take a key in the prompt box of its own, so `ctrl+x b` is the chord Claude Code binds to `app:cycleDiffBase`, which only acts in the diff panel. Rebind that action in `~/.claude/keybindings.json` to use another chord; the row above the prompt still says `ctrl+x b`.

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

Run `claude plugin test .` for the tests and `claude plugin validate .` to check the manifest and hooks. Bump the number in `HELPER` in `hooks/register.tsx` when the Swift helper changes, so the old binary is rebuilt.

## Known limits

- The last word of a prompt is not checked if you press Enter without a space after it.
- Some typos with an obvious correction are only underlined, because macOS offers a second guess (`sugest`: `suggest` or `surest`).
- Keeping a guess with Enter leaves a "Prompt dropped by a hook" line in the conversation. A mod cannot stop Enter from sending any other way.
- Developer terms macOS does not know (`worktree`, `changelog`) are underlined until you add them with `/prompt-spell-check add`.
