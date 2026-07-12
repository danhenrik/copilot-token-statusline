# copilot-token-statusline

A custom **status line for [GitHub Copilot CLI](https://docs.github.com/copilot/how-tos/use-copilot-agents/use-copilot-cli)** that puts your per-session token and AI-credit usage back on the footer — the visibility that was lost when billing moved to AI Credits.

```
ctx 125k/200k (63%) | Σ3.4M (in 3.35M/out 50k) | 0.63 AIC ≈$0.01
```

| Segment | Meaning |
| --- | --- |
| `ctx 125k/200k (63%)` | Live `/context` occupancy. Colored **green → yellow → orange → red** by a per-model "dumb zone" gradient, so you can *see* when you're entering the range where models start to degrade. |
| `Σ3.4M (in 3.35M/out 50k)` | Cumulative tokens that actually flowed through the API this session (input/output split) — the real cost driver, not the context size. |
| `0.63 AIC ≈$0.01` | AI Credits used this session and an estimated USD cost (1 AI Credit ≈ $0.01). |

It also writes a per-session ledger to `<COPILOT_HOME>/statusline/sessions/<session_id>.json`.

---

## Why this is a plugin *plus* an installer (and not a pure plugin)

Copilot CLI plugins can contribute `agents`, `skills`, `commands`, `hooks`, `extensions`, `mcpServers`, and `lspServers` — **but not a status line or settings**. And `statusLine.command` is deliberately locked down: because it runs an arbitrary command on every render, the CLI only accepts it from your own `settings.json` (it's blocked from `/settings set`, the picker, and plugin/repo config).

So this repo ships as:

- a **plugin** (`plugins/token-statusline`) for discovery/distribution, whose bundled **setup skill** drives the install; and
- a **self-contained installer** (`install.js`) that performs the one trusted `settings.json` edit locally, with your approval.

---

## Requirements

- **Node.js** on `PATH` (the Copilot CLI already requires it).
- **Copilot CLI 1.0.71+** (the status-line JSON contract this script reads).

---

## Install

### Option A — Marketplace (recommended for sharing)

```shell
copilot plugin marketplace add danhenrik/copilot-token-statusline
copilot plugin install token-statusline@danhenrik-copilot
```

Then in a session, ask Copilot to **"set up the token status line"** (this invokes the bundled `token-statusline-setup` skill), or run the installer yourself (Option C).

### Option B — Install the plugin directly from the repo subdirectory

```shell
copilot plugin install danhenrik/copilot-token-statusline:plugins/token-statusline
```

Then trigger the setup skill as above.

### Option C — Just run the installer (no plugin needed)

```shell
git clone https://github.com/danhenrik/copilot-token-statusline
node copilot-token-statusline/plugins/token-statusline/install.js
```

On Windows you can use the wrapper `install.ps1`; on macOS/Linux `install.sh`. Both just forward to `install.js`.

### Option D — Fully manual

1. Copy `plugins/token-statusline/token-usage.js` to `~/.copilot/statusline/token-usage.js`.
2. In `~/.copilot/settings.json` add:
   ```json
   "statusLine": {
     "type": "command",
     "command": "node \"<home>/.copilot/statusline/token-usage.js\"",
     "padding": 2
   },
   "footer": { "showCustom": true }
   ```

### After installing

- Run **`/restart`** so the CLI reloads the status line.
- The built-in footer can *also* show context usage. To avoid seeing it twice, either re-run the installer with `--hide-builtin-context`, or set `footer.showContextWindow: false` in `settings.json`.

---

## Installer options

```
node install.js [options]
  --hide-builtin-context   also set footer.showContextWindow=false
  --hide-builtin-aiused    also set footer.showAiUsed=false
  --dry-run, -n            print the changes without writing anything
  --help, -h               show help
```

The installer backs up `settings.json` to `settings.json.bak` before writing, and refuses to run if your existing `settings.json` isn't valid JSON.

---

## Configuration (environment variables)

The status-line script reads these at render time:

| Variable | Default | Effect |
| --- | --- | --- |
| `COPILOT_STATUSLINE_USD_PER_AIC` | `0.01` | USD per AI Credit for the cost estimate. |
| `COPILOT_STATUSLINE_HIDE_USD` | — | Set to `1` to hide the `≈$` cost estimate. |
| `COPILOT_STATUSLINE_HIDE_CUMULATIVE` | — | Set to `1` to hide the `Σ` cumulative segment. |
| `COPILOT_STATUSLINE_HIDE_CONTEXT` | — | Set to `1` to hide the `ctx` segment. |
| `COPILOT_STATUSLINE_NO_GRADIENT` | — | Set to `1` to disable the color gradient (grey ctx). |
| `COPILOT_STATUSLINE_COLOR` | `auto` | `always` / `never` / `auto`. |
| `NO_COLOR` | — | Standard: any non-empty value disables color. |
| `COPILOT_STATUSLINE_ZONES` | — | Override the per-model dumb-zone anchors (advanced). |
| `COPILOT_HOME` | `~/.copilot` | Base dir for the script + settings. |

---

## About the "dumb zone" gradient

The `ctx` color reflects how close the session is to the range where model quality drops off.

**Provenance (honest):** the *general* thresholds are corroborated across many independent studies — RULER, Chroma "Context Rot", NoLiMa, "Lost in the Middle", HumanLayer's coding-session data, and Anthropic's context-engineering guidance (onset commonly ~32k, effective context often ~⅓–½ of advertised, coding "dumb zone" ~50k–100k). The *specific per-model* anchors in `token-usage.js` are an **extrapolation** of those ranges scaled by each family's generation/long-context reputation — not a direct measurement of these exact models. They're tunable via `COPILOT_STATUSLINE_ZONES`.

---

## Uninstall

```shell
node plugins/token-statusline/uninstall.js     # reverts settings.json + removes the installed script
copilot plugin uninstall token-statusline      # if installed as a plugin
```

---

## License

MIT — see [LICENSE](./LICENSE).
