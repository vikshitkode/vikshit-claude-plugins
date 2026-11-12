# vikshit-personal-theme

A Claude Code theme built on the built-in dark theme. It swaps the blue and periwinkle accents for Claude orange and makes your own prompts stand out in the transcript.

## What it changes

- Highlights, permission prompts, the usage bar and the IDE indicator use Claude orange, `rgb(215,119,87)`, instead of blue.
- Prompt lines show bright orange text, `rgb(245,149,117)`, on a dark orange band, `rgb(64,26,8)`.
- Text selection and memory notes use dark brown backgrounds instead of blue ones.

Everything else comes from the dark theme. The theme does not change your terminal's own background color.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install vikshit-personal-theme --marketplace vikshitkode/vikshit-claude-plugins
```

Answer `y` to add the marketplace, then choose a scope. The user scope makes the theme available in every session.

From a shell:

```
claude plugin install vikshit-personal-theme --marketplace vikshitkode/vikshit-claude-plugins
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `vikshitkode/vikshit-claude-plugins`, then Add plugin.

## Turn it on

Installing the plugin only makes the theme available. Run `/theme` and pick `vikshit-personal-theme` from the list.

## Known limit

In Claude Code 2.1.322, text inside replies (inline code, for example) is drawn with the base dark palette, so it stays periwinkle whatever the theme says.

## Change the colors

The theme is one file, `themes/vikshit-personal-theme.json`. Each entry in `overrides` is a color key from the dark theme and a value written as `rgb(r,g,b)`, `#rrggbb`, `ansi256(n)` or `ansi:<name>`. A key the dark theme does not have, or a value in another format, is ignored.
