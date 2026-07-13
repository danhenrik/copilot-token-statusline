# Thresholds: sources & rationale

This document explains **where the numbers in [`token-usage.js`](./plugins/token-statusline/token-usage.js) come from** and, just as importantly, **which parts are measured and which are extrapolated.** It covers two very different sets of numbers:

- **§1–§7 — the "dumb zone" anchors** that drive the green → yellow → orange → red color of the `ctx` segment. These are an honest **extrapolation** from published research.
- **§8 — the auto-compaction marker** (`⚠ compact`). These are **measured directly from the Copilot CLI binary** (native addon + app bundle) and are exact — a deliberate contrast to §1–§7.

## TL;DR (the honest version)

- The **general phenomenon and its rough magnitudes are well‑established** and convergent across multiple independent studies (academic + industry). Namely: model quality silently degrades *well before* the advertised context limit; onset is often in the **~32k** range; "effective" context for even strong models is frequently only **~½** of what's advertised (and closer to **~⅓** on hard tasks); and the onset behaves more like an **absolute token band** than a fixed percentage of the window.
- The **specific per‑family anchor numbers** in `MODEL_ZONES` (e.g. Opus `80k/180k`, Haiku `40k/100k`) are **an extrapolation**, not a direct measurement. Public benchmarks measured *older* model generations; the 2026 models exposed by Copilot CLI have not been independently benchmarked at this granularity. What is well‑motivated is the **relative ordering** (flagships get more headroom than small/fast models; Gemini‑Pro‑class most; retrieval‑heavy code models slightly more). The exact integers are judgment calls **within** the research‑supported band, and are fully tunable.

If you want to skip the reasoning: override any model with `COPILOT_STATUSLINE_ZONES="smartUntil,dumbFrom"`.

---

## 1. The phenomenon: "context rot" / the "dumb zone"

An LLM's accuracy, instruction‑following, and reasoning degrade as the context grows — long before the window is "full". The effect has several names ("context rot", "lost in the middle", "effective context length") and is documented repeatedly:

| Source | What it establishes | Concrete numbers |
| --- | --- | --- |
| **RULER** — Hsieh et al., NVIDIA, 2024. [arXiv:2404.06654](https://arxiv.org/abs/2404.06654) | Measures *effective* context (retrieval + multi‑hop + aggregation + QA), not just needle‑in‑haystack. Of 17 models, only ~half stay above a 4K‑baseline quality bar at 32K. | **Effective ≈ ½ of claimed** for strong models: GPT‑4‑128K → ~**64K**; Llama‑3.1‑70B‑128K → ~64K; Command‑R+‑128K → ~**32K**. Gemini‑1.5‑Pro was the standout that held past 128K. |
| **NoLiMa** — Modarressi et al., 2025. [arXiv:2502.05167](https://arxiv.org/abs/2502.05167) | Long‑context eval that removes literal lexical cues (forces semantic matching). Evaluated **12 models** claiming ≥128K support (GPT‑4o, Gemini 1.5 Pro, Llama 3.3 70B, …). | **10 of 12 models fall below 50%** of their short‑context score by **32K** tokens (many drop noticeably even at 2K–8K). |
| **Lost in the Middle** — Liu et al., 2023 (TACL). [arXiv:2307.03172](https://arxiv.org/abs/2307.03172) | Position matters: a "U‑shaped" curve — info at the start/end is recalled; info in the middle is missed. | Sharp mid‑context recall drop in long inputs. |
| **Context Rot** — Chroma Research, 2025. [Report](https://www.trychroma.com/research/context-rot) | 18 current models (GPT‑4.1, Claude 4, Gemini 2.5, Qwen3). Holds task difficulty constant and varies *only* input length. | **All 18 degrade** as length grows; degradation starts **well below** the max window; **multi‑step / coding agents are hit hardest**. |
| **Effective context engineering for AI agents** — Anthropic, Sep 29 2025. [Post](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Treats context as a finite "attention budget"; curating/compacting beats stuffing the window. | Qualitative; motivates compaction well before the limit. |
| **Advanced Context Engineering for Coding Agents** — D. Horthy, HumanLayer, 2025 *(industry talk)*. | Practitioner guidance for **coding agents specifically**: compact/route context and delegate to sub‑agents *well before* the window fills. | Heuristic (not a benchmark): compact around **~50–100k** working tokens. |

**Convergent conclusion (the part I'm confident in):**
1. Degradation **onset** is commonly around **~32k** tokens and is **gradual** from there.
2. **Effective** context ≈ **50%** of advertised for the *best* models on general tasks, **~⅓** on hard/semantic tasks.
3. It is closer to an **absolute token band than a percentage** — a 1M‑token window does **not** stay reliable to 500k.
4. **Agentic coding is the worst case** (stateful, multi‑step), so a *coding* status line should warn *earlier* than a retrieval benchmark would suggest.

---

## 2. What's measured vs. what's extrapolated

| | Status |
| --- | --- |
| "Degradation begins ~32k and is gradual" | **Measured** (NoLiMa, Lost‑in‑the‑Middle) |
| "Effective ≈ ½ (best) to ⅓ (hard) of the window" | **Measured** (RULER) |
| "Doesn't scale with window size; coding worst" | **Measured / strongly supported** (Chroma, Anthropic, HumanLayer) |
| **Exact per‑family `smartUntil`/`dumbFrom` integers** | **Extrapolated** — mapping each 2026 family to the nearest measured reference class, scaled by generation & long‑context reputation. **Not** a direct benchmark of these models. |
| Relative ordering of families | **Reasoned** (follows model size/class trends seen in RULER, where smaller models had shorter effective lengths) |

---

## 3. Per‑family anchors and their rationale

Two absolute token anchors per family: `smartUntil` (stay green up to here) and `dumbFrom` (full red at/after here); the color fades between them. Values as of v1.0.

| Family (regex) | smartUntil | dumbFrom | Reference class & reasoning (all extrapolated) |
| --- | ---: | ---: | --- |
| `gemini` (Pro) | 100k | 250k | Gemini was **the** RULER outlier that held past 128K; give the most headroom. |
| `codex` | 90k | 220k | Code‑specialized, tuned for long *code* context; slightly more headroom than general GPT. |
| `opus` | 80k | 180k | Flagship / strongest reasoning class → top of the "best model" band (RULER best ≈ 64K on 128K; frontier 2026 flagship assumed to exceed that). |
| `gpt-5` | 80k | 200k | Flagship GPT class, large window; same headroom as Opus, higher dumb ceiling for its bigger window. |
| `sonnet` | 60k | 150k | Strong mid‑tier; below Opus. |
| `flash` | 50k | 130k | Gemini **Flash** = smaller/faster than Pro → less headroom. |
| `mini` (`\bmini\b`) | 45k | 110k | Small GPT tier; earlier onset. (Word‑boundary regex so it does **not** match "ge**mini**".) |
| `haiku` | 40k | 100k | Small/fast Claude; earliest onset of the Claude line (cf. Command‑R+ 128K→32K for small models). |
| `mai` | 40k | 100k | MAI‑Code‑1‑Flash = small/fast; earliest onset. |
| **default (unmatched)** | `min(50%×window, 128k)` | `min(90%×window, 400k)` | See §4. |

> These are deliberately a little **more conservative** than RULER's ½‑of‑window because the use case is **agentic coding**, which Chroma/Anthropic identify as the worst case — so warning earlier than a retrieval benchmark is intentional.

**Regex order matters** (first match wins): specific families precede generic ones, and `\bmini\b` avoids matching `gemini`.

---

## 4. The window‑relative default (for unmatched / future models)

Unknown models don't get a flat number — they get a **hybrid** of the two measured findings:

```js
smartUntil = min(0.50 × window, 128k)   // RULER "≈50% of advertised"
dumbFrom   = min(0.90 × window, 400k)   // near-full window
```

- The **percentage** term honors RULER's "effective ≈ ½ of the window" for normal (128k–200k) windows: a 200k model → green to **100k**.
- The **absolute cap** honors NoLiMa/Chroma: a very large window must **not** get a free pass. A 1M‑token model is capped at **128k / 400k**, not 500k/900k.
- When the window size is unknown, it falls back to a static **50k / 120k**.

Worked examples (verified against the script):

| Window | smartUntil | dumbFrom |
| ---: | ---: | ---: |
| 128k | 64k | 115.2k |
| 200k | 100k | 180k |
| 256k | 128k (cap) | 230.4k |
| 1M | 128k (cap) | 400k (cap) |

Per‑family entries in §3 intentionally **keep their absolute anchors** rather than using this formula — the two‑measurement hybrid is only the *fallback*.

---

## 5. How the color is computed

`dangerFor(cur, limit, zone)` returns a `0..1` score = **max** of:

1. **Absolute‑anchor ramp** — linear from `smartUntil` (0.0) to `dumbFrom` (1.0).
2. **Window‑fullness safety** — linear from 70% (0.0) to 98% (1.0) of the *actual* window; a nearly‑full window is its own hazard (overflow / forced compaction) regardless of the anchors.

The score maps onto a 4‑stop gradient (GitHub Primer hues): green `#3FB950` (0.0) → yellow `#D29922` (0.45) → orange `#DB6D28` (0.75) → red `#F85149` (1.0).

---

## 6. Pricing: AI Credits → USD

The `AIC` figure and its `≈$` estimate are documented in the script header. In short: Copilot CLI's own footer renders `Session: <n> AIC used`, where the value is `total_nano_aiu / 1e9` (already weighted by each model's `request_multiplier`). GitHub's June 2026 billing change set **1 AI Credit = $0.01 USD**, so the estimate is `credits × $0.01`. Override the rate with `COPILOT_STATUSLINE_USD_PER_AIC` if your plan differs.

---

## 7. Recalibrating

- **Per session / model:** `COPILOT_STATUSLINE_ZONES="60000,150000"` overrides both anchors for the current model.
- **Permanently:** edit the `MODEL_ZONES` table (per family) or the `defaultZone()` formula in `token-usage.js`.
- **Stricter (research‑literal) preset** you may prefer, closer to NoLiMa/coding onsets: `smartUntil = min(⅓×window, 64k)`, `dumbFrom = min(60%×window, 160k)`.

If you have **measured** dumb‑zone data for any of these exact 2026 models, please open an issue/PR — measured values should replace the extrapolated ones here.

---

## 8. Auto‑compaction thresholds — the `⚠ compact` marker (measured, not extrapolated)

Everything above (§1–§7) is an honest **extrapolation**. This section is the opposite: the numbers are **read straight out of the Copilot CLI itself** (v1.0.71) — the native runtime addon and the app bundle — so they are exact, not guesses.

### 8.1 The four stages (from the native addon)

The CLI's native addon (`runtime.node`) exports the compaction thresholds as plain nullary functions. Calling them directly returns:

| Native export | Value | Meaning |
| --- | ---: | --- |
| `compactionStaticContextWarningThreshold()` | **0.75** | static‑context warning |
| `contextBackgroundCompactionThreshold()` | **0.80** | **background auto‑compaction fires** |
| `compactionStaticContextBlockThreshold()` | **0.85** | static‑context block (refuses to add more static context) |
| `contextBufferExhaustionThreshold()` | **0.95** | buffer exhaustion — the hard ceiling |

All four are fractions of **`promptTokenLimit`**, *not* of the displayed window.

### 8.2 How the CLI applies them (from `app.js` `contextInfo()`)

The bundle's `contextInfo()` computes (variable names de‑minified):

```js
promptTokenLimit    = max_prompt_tokens ?? max_context_window_tokens
compactionThreshold = Math.floor(promptTokenLimit * 0.80)          // <- the trigger
limit /*displayed*/ = promptTokenLimit + outputTokenLimit
bufferTokens        = outputTokenLimit + Math.floor(promptTokenLimit * (1 - 0.95))
                    = outputTokenLimit + Math.floor(promptTokenLimit * 0.05)
```

The `0.80` and `0.95` are the same native constants, wired in a second place too — `normalizeInfiniteSessionsConfig()` sets `backgroundCompactionThreshold: 0.80` and `bufferExhaustionThreshold: 0.95`.

> **Honest caveat:** `0.80` is definitively the value the CLI computes and labels as its background‑compaction threshold, applied to `promptTokenLimit`. The `if (usage ≥ threshold)` comparison itself lives in the **native** compaction processor (compiled Rust addon), so it can't be shown as readable source — the name + wiring are the evidence. The marker counts down to `0.80` because it's the first stage that actually reclaims space (`0.95` is the hard wall you normally never reach, because compaction fires first).

### 8.3 Recovering `promptTokenLimit` — and why a flat "% of window" is wrong

The status payload piped to the script exposes `displayed_context_limit` and `current_context_tokens`, but **not** `promptTokenLimit` or `outputTokenLimit`. Since `displayed = prompt + output`, the script recovers:

```
promptTokenLimit = displayed_context_limit − outputTokenLimit(model)
```

This is **tier‑correct**: the payload's `displayed_context_limit` already reflects the active context tier (e.g. 264 000 for Opus‑4.8 default, 1 000 000 for its long‑context tier), and `outputTokenLimit` is ~constant per model across tiers.

Why not just use a percentage of the displayed window? Because the reserved **buffer** (`outputTokenLimit + 0.05 × prompt`) has a *fixed* absolute component, so as a share of the displayed window it swings widely by tier — **11 % to 37 %**:

| Model / tier | prompt | output | displayed | buffer | buffer % of displayed | compaction @ `0.80×prompt` | = % of displayed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Opus‑4.8 (264k tier) | 200 000 | 64 000 | 264 000 | 74 000 | **28.0 %** | 160 000 | 60.6 % |
| Opus‑4.8 (1M tier) | 936 000 | 64 000 | 1 000 000 | 110 800 | **11.1 %** | 748 800 | 74.9 % |
| GPT‑5‑mini | 128 000 | 64 000 | 192 000 | 70 400 | **36.7 %** | 102 400 | 53.3 % |
| Sonnet‑4.6 | 168 000 | 32 000 | 200 000 | 40 400 | **20.2 %** | 134 400 | 67.2 % |

So the same model auto‑compacts at **60.6 %** of its displayed window in one tier and **74.9 %** in another — a flat percentage could not track that. The marker therefore counts **absolute headroom tokens** to `0.80 × promptTokenLimit`.

**A large buffer never starves the session.** `bufferTokens = output + 0.05×prompt` is *always* smaller than `displayed = prompt + output`, so usable context is always `0.95 × promptTokenLimit`; the buffer just reserves the room the model needs to write its reply. And because compaction (`0.80`) fires *before* the buffer edge (`0.95`), you reclaim space long before touching the reserve.

### 8.4 Per‑model `outputTokenLimit` (the only value the marker needs)

`outputTokenLimit` (default tier) per model, and where each value comes from. The CLI resolves the newest models' limits from the API at runtime, so those are recovered from the `Applied model capabilities override` lines in `~/.copilot/logs/process-*.log`; the rest come from the native model catalog (`catalogLookupModelLimits(id)`).

| Model | `max_output_tokens` | Source |
| --- | ---: | --- |
| `claude-opus-4.8` | 64 000 | log (API override) |
| `claude-opus-4.7` | 64 000 | log (long‑context tier; default assumed identical) |
| `claude-opus-4.6` and older | 32 000 | native catalog |
| `claude-sonnet-5` | 64 000 | log |
| `claude-sonnet-4.6` / `4.5` | 32 000 | native catalog |
| `claude-haiku-4.5` | 64 000 | native catalog |
| `gpt-5.6-sol` / `terra` / `luna` | 128 000 | log |
| `gpt-5.5` | 128 000 | log |
| `gpt-5.4` (+ `-mini` / `-nano`) | 128 000 | native catalog / log |
| `gpt-5.3-codex` | 128 000 | native catalog |
| `gpt-5-mini` | 64 000 | native catalog |
| `gemini-3.1-pro-preview` | 64 000 | log |
| `gemini-3.5-flash` | 64 000 | log |
| `mai-code-1-flash-picker` | *unknown* | catalog returns null, absent from logs → **marker hidden** |

Only `outputTokenLimit` is needed (not the full prompt/context limits) because `promptTokenLimit` is derived from the live `displayed_context_limit`. Unknown/future models return `null` → the marker is simply **not shown** (never a guessed number). Override any model with `COPILOT_STATUSLINE_OUTPUT_TOKENS=<n>`.

> **Tier nuance:** `outputTokenLimit` is tier‑invariant for every current model *except* older Claude (e.g. Opus‑4.6 is 32k on its 200k default tier but 64k on its 1M long‑context tier). The table uses the **default‑tier** value; running such a model in long‑context tier can shift the compaction point by ≈`0.80 ×` the output delta. Rare in practice, and overridable.

### 8.5 The marker

- Appears only when `current_context_tokens ≥ COMPACT_WARN × promptTokenLimit` (default `0.75`, tunable via `COPILOT_STATUSLINE_COMPACT_WARN`).
- Reads `⚠ compact <headroom>` where `headroom = floor(0.80 × promptTokenLimit) − current_context_tokens`; once headroom ≤ 0 it reads `⚠ compacting`.
- Escalates from mild to red as you cross from the warn stage to the `0.80` target.
- Hide with `COPILOT_STATUSLINE_HIDE_COMPACT=1`.

**Reproduce it yourself:** the native constants come from `require`-ing the addon as CommonJS and calling the four functions in §8.1; the formulas come from the `contextInfo()` body in the app bundle; the per‑model limits come from `catalogLookupModelLimits(id)` plus the `Applied model capabilities override` log lines. All are in Copilot CLI **1.0.71** (`%LOCALAPPDATA%\copilot\pkg\win32-x64\1.0.71-0\`).

---

## References

- Hsieh et al., *RULER: What's the Real Context Size of Your Long‑Context Language Models?*, NVIDIA, 2024. https://arxiv.org/abs/2404.06654
- Modarressi et al., *NoLiMa: Long‑Context Evaluation Beyond Literal Matching*, 2025. https://arxiv.org/abs/2502.05167
- Liu et al., *Lost in the Middle: How Language Models Use Long Contexts*, TACL, 2023. https://arxiv.org/abs/2307.03172
- Chroma Research, *Context Rot: How Increasing Input Tokens Impacts LLM Performance*, 2025. https://www.trychroma.com/research/context-rot
- Anthropic, *Effective context engineering for AI agents*, Sep 29 2025. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Dexter Horthy (HumanLayer), *Advanced Context Engineering for Coding Agents*, 2025 — industry talk (practitioner guidance, not a peer‑reviewed benchmark).
