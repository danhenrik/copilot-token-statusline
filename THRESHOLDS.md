# Dumb‑zone thresholds: sources & rationale

This document explains **where the numbers in [`token-usage.js`](./plugins/token-statusline/token-usage.js) come from** — specifically the per‑model "dumb zone" anchors that drive the green → yellow → orange → red color of the `ctx` segment — and, just as importantly, **which parts are measured and which are extrapolated.**

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
| **NoLiMa** — Modarressi et al., 2025. [arXiv:2502.05167](https://arxiv.org/abs/2502.05167) | Long‑context eval that removes literal lexical cues (forces semantic matching). | **11 of 13 models fall below 50%** of their short‑context score by **32K** tokens. |
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

## References

- Hsieh et al., *RULER: What's the Real Context Size of Your Long‑Context Language Models?*, NVIDIA, 2024. https://arxiv.org/abs/2404.06654
- Modarressi et al., *NoLiMa: Long‑Context Evaluation Beyond Literal Matching*, 2025. https://arxiv.org/abs/2502.05167
- Liu et al., *Lost in the Middle: How Language Models Use Long Contexts*, TACL, 2023. https://arxiv.org/abs/2307.03172
- Chroma Research, *Context Rot: How Increasing Input Tokens Impacts LLM Performance*, 2025. https://www.trychroma.com/research/context-rot
- Anthropic, *Effective context engineering for AI agents*, Sep 29 2025. https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Dexter Horthy (HumanLayer), *Advanced Context Engineering for Coding Agents*, 2025 — industry talk (practitioner guidance, not a peer‑reviewed benchmark).
