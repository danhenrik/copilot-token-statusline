# copilot-token-statusline

A custom **status line for [GitHub Copilot CLI](https://docs.github.com/copilot/how-tos/use-copilot-agents/use-copilot-cli)** that puts your per-session token and AI-credit usage back on the footer — the visibility that was lost when billing moved to AI Credits.

```
ctx 125k/200k (63%) | Σ3.4M (in 3.35M/out 50k) | cache 89% | 0.63 AIC ≈$0.01
```

| Segment | Meaning |
| --- | --- |
| `ctx 125k/200k (63%)` | Live `/context` occupancy. Colored **green → yellow → orange → red** by a per-model "dumb zone" gradient, so you can *see* when you're entering the range where models start to degrade. |
| `Σ3.4M (in 3.35M/out 50k)` | Cumulative tokens that actually flowed through the API this session (input/output split) — the real cost driver, not the context size. |
| `cache 89%` | Share of input tokens served from the prompt cache (cheap reads) vs freshly processed — an objective signal (no thresholds) that your stable prefix is being reused. |
| `▲ read 42k` | *(optional)* Transient **"output strike"**: a big tool result just landed in context — the #1 source of bloat. Requires the companion **token-spike** extension; shows briefly, then clears on its own. |
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
  --with-spike-extension   also install the token-spike extension (flags big tool outputs)
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
| `COPILOT_STATUSLINE_HIDE_COMPACT` | — | Set to `1` to hide the `⚠ compact` near-auto-compaction marker. |
| `COPILOT_STATUSLINE_COMPACT_WARN` | `0.75` | Fraction of the prompt budget at which the `⚠ compact` marker starts showing (must be < `0.80`). |
| `COPILOT_STATUSLINE_OUTPUT_TOKENS` | — | Override the model's max output tokens, used to recover the prompt budget for the compaction marker (only needed for unknown/future models). |
| `COPILOT_STATUSLINE_HIDE_CACHE` | — | Set to `1` to hide the `cache %` segment. |
| `COPILOT_STATUSLINE_HIDE_SPIKE` | — | Set to `1` to hide the `▲` output-strike marker. |
| `COPILOT_STATUSLINE_SPIKE_TOKENS` | `4000` | Min approx tokens for a tool result to count as a "spike" (needs the token-spike extension). |
| `COPILOT_STATUSLINE_SPIKE_WINDOW_MS` | `90000` | How long (ms) the `▲` marker stays visible after a spike. |
| `COPILOT_STATUSLINE_NO_GRADIENT` | — | Set to `1` to disable the color gradient (grey ctx). |
| `COPILOT_STATUSLINE_COLOR` | `auto` | Base color of the ordinary status text. `none`/`off` disables color; `auto`/`github`/`dark` = grey `#9198A1`; `light` = `#59636e`; `dim` = faint; or a bare SGR / `R;G;B` triple. |
| `NO_COLOR` | — | Standard: any non-empty value disables color. |
| `COPILOT_STATUSLINE_ZONES` | — | Override the per-model dumb-zone anchors (advanced). |
| `COPILOT_HOME` | `~/.copilot` | Base dir for the script + settings. |

---

## About the "dumb zone" gradient

The `ctx` color reflects how close the session is to the range where model quality drops off.

**Provenance (honest):** the *general* thresholds are corroborated across many independent studies — RULER, Chroma "Context Rot", NoLiMa, "Lost in the Middle", and Anthropic's context-engineering guidance (onset commonly ~32k, effective context often ~⅓–½ of advertised, coding degradation hits earliest). The *specific per-model* anchors in `token-usage.js` are an **extrapolation** of those ranges scaled by each family's generation/long-context reputation — not a direct measurement of these exact models. Unmatched/unknown models fall back to a **window-relative** default (`min(50%×window, 128k)` smart, `min(90%×window, 400k)` dumb). They're tunable via `COPILOT_STATUSLINE_ZONES`.

**→ Full sources, per-family reasoning, and the extrapolation method are documented in [THRESHOLDS.md](./THRESHOLDS.md).**

---

## The auto-compaction alert (`⚠ compact`)

As the live context nears the point where Copilot CLI **auto-compacts** it, the status line shows a `⚠ compact <headroom>` marker — the tokens left before compaction fires (e.g. `⚠ compact 8k`). Cross it and it reads `⚠ compacting`. It only appears in the final stretch (default: from 75% of the prompt budget) and escalates yellow → red as you close in. Hide it with `COPILOT_STATUSLINE_HIDE_COMPACT=1`.

**Unlike the dumb-zone gradient, this is measured directly from the CLI binary — not extrapolated.** Compaction fires at `0.80 × promptTokenLimit`, and because the reserved output buffer makes that anywhere from **11% to 37% of the displayed window depending on model/tier**, a flat "% of window" would be wrong. The script recovers `promptTokenLimit = displayed_context_limit − outputTokenLimit(model)` per model/tier, so the countdown is always tier-correct. For models whose output limit isn't known it simply shows nothing (never a guess).

**→ The exact constants, the `app.js` / native-addon sources, the buffer geometry, and the per-model output-token table are in [THRESHOLDS.md](./THRESHOLDS.md) §8.**

---

## The token-spike extension (optional)

The status line can only see **aggregate** context size — never the size of an individual tool result. But tool outputs (a huge file read, a long command dump, a big search) are the **#1 source of context bloat**, and by the time they show up in the aggregate it's easy to miss *what* caused the jump.

`token-spike` closes that gap. It's a tiny Copilot CLI **extension** (an `onPostToolUse` hook) that measures every successful tool result and records the big ones to a shared file:

```
<COPILOT_HOME>/statusline/tool-activity/<session_id>.json
```

The status line reads that file and shows a transient `▲ <tool> <tokens>` marker right after a large output lands, so you notice the hit and can decide whether to prune, summarize, or hand off before it degrades the context. The marker clears itself after `COPILOT_STATUSLINE_SPIKE_WINDOW_MS` (default 90 s).

It's **opt-in** because a hook runs on every tool call. Enable it with:

```shell
node plugins/token-statusline/install.js --with-spike-extension
```

That copies the extension to `~/.copilot/extensions/token-spike/`. Run **`/clear`** (or reload extensions) so the CLI picks it up. Token sizes are an approximate `chars ÷ 4` estimate — good enough to spot a strike, not billing-grade. Tune the trigger with `COPILOT_STATUSLINE_SPIKE_TOKENS` (default 4000) and hide the marker with `COPILOT_STATUSLINE_HIDE_SPIKE=1`. The uninstaller removes it automatically.

> **Calibration note:** Copilot CLI already truncates very large tool results to a short preview (offloading the full text to a temp file), so a single result contributes at most ~5–7k tokens to the context before that kicks in — which is why the default threshold is 4000, not higher. Usefully, this means the marker measures your *real* context contribution: a 250 KB command that gets truncated to a ~900-char preview correctly does **not** count as a spike, because it didn't actually bloat your window.

---

## Uninstall

```shell
node plugins/token-statusline/uninstall.js     # reverts settings.json + removes the installed script
copilot plugin uninstall token-statusline      # if installed as a plugin
```

---

## License

MIT — see [LICENSE](./LICENSE).
