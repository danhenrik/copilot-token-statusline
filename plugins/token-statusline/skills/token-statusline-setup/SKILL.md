---
name: token-statusline-setup
description: Install, enable, or reconfigure the per-session token and AI-credit usage status line for GitHub Copilot CLI. Use when the user wants to set up, install, turn on, or change the token-usage / context / credit-cost status line, or asks to wire the bundled token-usage.js into their Copilot CLI settings.
---

# Set up the token-usage status line

This skill installs the custom Copilot CLI status line that shows, on the footer:

```
ctx 125k/200k (63%) | Σ3.4M (in 3.35M/out 50k) | 0.63 AIC ≈$0.01
```

- **ctx** — live `/context` occupancy, colored green→yellow→orange→red by a
  per-model "dumb zone" gradient.
- **Σ** — cumulative tokens for the session (input/output split), i.e. the real
  API cost that flowed through.
- **AIC + ≈$** — AI Credits used this session and an estimated USD cost.

## How to install

The installer is a self-contained Node script named `install.js`, bundled in
this plugin **at the plugin root — one level above the `skills/` directory that
contains this file** (i.e. `../../install.js` relative to this `SKILL.md`).

Do the following:

1. **Locate `install.js`.** Resolve `../../install.js` relative to this
   `SKILL.md` file to an absolute path. If that is unclear, search the plugin
   directory for a file named `install.js` that has a sibling `token-usage.js`.

2. **Ask the user about the built-in context item.** The built-in footer can
   also show context usage. Ask whether they want to hide it to avoid showing
   context twice. If yes, plan to pass `--hide-builtin-context`.

3. **Run the installer** with the user's shell (it needs no arguments for a
   default install). Examples:
   - Windows PowerShell: `node "<abs path>\install.js"`
   - macOS/Linux: `node "<abs path>/install.js"`
   - add `--hide-builtin-context` if the user chose to hide the built-in one.
   - add `--dry-run` first if the user wants to preview changes.

   The installer copies `token-usage.js` and its `lib/` modules into
   `<COPILOT_HOME>/statusline/` and edits `<COPILOT_HOME>/settings.json` (a
   `settings.json.bak` backup is made first). `COPILOT_HOME` defaults to
   `~/.copilot`.

4. **Report the result** and tell the user to run `/restart` so the CLI reloads
   the status line. Confirm `footer.showCustom` is `true` (the installer sets
   it).

## Notes

- Editing `settings.json` is required and cannot be done by the plugin itself:
  `statusLine.command` runs an arbitrary command on every render, so Copilot CLI
  deliberately only accepts it from the user's own `settings.json` (it is
  blocked from `/settings set`, the picker, and plugin/repo config). Running
  this installer performs that trusted edit locally with the user's approval.
- To customize after install, see the environment variables documented in the
  plugin `README.md` (e.g. `COPILOT_STATUSLINE_USD_PER_AIC`,
  `COPILOT_STATUSLINE_HIDE_USD`, `COPILOT_STATUSLINE_HIDE_CUMULATIVE`,
  `COPILOT_STATUSLINE_ZONES`).
- To revert, run the bundled `uninstall.js` the same way.
