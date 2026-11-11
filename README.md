# vikshit-claude-plugins

A marketplace of Claude Code plugins.

| Plugin | What it does |
| --- | --- |
| [prompt-spell-check](prompt-spell-check/README.md) | Underlines misspelled words in the prompt box and fixes sure typos as you type, using the macOS spell checker. Needs macOS with the Xcode command line tools. |
| [read-guard](read-guard/README.md) | Saves tokens by refusing whole-file reads of large files, lockfiles and generated folders, and pointing Claude to a search or a ranged read instead. |

## Install

At the prompt of a Claude Code terminal session, install the plugins you want:

```
/plugin install prompt-spell-check --marketplace vikshitkode/vikshit-claude-plugins
/plugin install read-guard --marketplace vikshitkode/vikshit-claude-plugins
```

Answer `y` to add the marketplace, then choose a scope. The user scope loads the plugin in every session.

From a shell:

```
claude plugin install prompt-spell-check --marketplace vikshitkode/vikshit-claude-plugins
claude plugin install read-guard --marketplace vikshitkode/vikshit-claude-plugins
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `vikshitkode/vikshit-claude-plugins`, then Add plugin.
