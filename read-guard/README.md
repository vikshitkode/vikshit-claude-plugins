# read-guard

A Claude Code mod that saves tokens by stopping Claude from reading very large files whole. A refused read tells Claude the file's size and to search it or read a range instead.

## What it refuses

A whole-file `Read` of:

- any file over 64 KB (about 16k tokens)
- a lockfile or generated file over 8 KB: `Package.resolved`, `Podfile.lock`, `Cartfile.resolved`, `Gemfile.lock`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `*.pbxproj`, and anything under `DerivedData/`, `.build/`, `Pods/`, `node_modules/`, `Carthage/`, `xcuserdata/` or `*.xcresult/`

## What still passes

- a `Read` with a `limit` of 500 lines or fewer
- a `Read` with `allow_large: true`, for when the whole file is really needed
- images and PDFs, which `Read` resizes or pages itself
- a path that cannot be checked, which goes on to `Read` unchanged

The mod only watches the `Read` tool. A `cat` through the shell is not stopped.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install read-guard --marketplace vikshitkode/vikshit-claude-plugins
```

Answer `y` to add the marketplace, then choose a scope. The user scope loads the mod in every session.

From a shell:

```
claude plugin install read-guard --marketplace vikshitkode/vikshit-claude-plugins
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `vikshitkode/vikshit-claude-plugins`, then Add plugin.

## Development

To run the mod from a folder instead of installing it, start `claude --plugin-dir <folder>`, or name the folder in `env.CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` so every session loads it.

Run `claude plugin test .` for the tests and `claude plugin validate .` to check the manifest and hooks. The size limits are the constants at the top of `hooks/register.ts`.
