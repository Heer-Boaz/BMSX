---
name: bmsx-lean-code
description: "Use when editing, reviewing, refactoring, or designing BMSX TypeScript, C++, Lua, emulator, fantasy console, IDE, runtime, render, cart, or analysis tooling code. Enforces BMSX's lean historical coding style: trust caller/callee contracts, avoid defensive clutter, avoid facade/host/provider/service abstractions, preserve performance, and improve quality rules instead of working around them."
metadata:
  short-description: "Enforce BMSX lean coding style"
---

# BMSX Lean Code

Use this skill whenever working in the BMSX repo or discussing BMSX code quality. The goal is not to imitate old code blindly; the goal is to recover the lean, direct, high-trust style from selected 2024 BMSX engine work while keeping the current fantasy-console architecture disciplined and fast.

## First Moves
1. Read the nearest `AGENTS.md` and inspect the relevant current code before editing.
2. If the change touches style, quality rules, architecture, fallbacks, hot paths, or analyzer behavior, read the relevant files in `references/`.
3. Prefer local mature code and existing helpers over new abstractions. Before adding a helper, search for an equivalent helper with `rg`.
4. Before implementing product behavior, study a serious reference implementation matching the domain when useful: VS Code for IDE/editor work, MAME or emulator cores for machine/runtime discipline, VLC or mature media code for audio/video pipelines.

## Style Contract
- Preserve the fantasy-console contract. Cart-visible hardware belongs behind memory maps, MMIO registers, machine devices, and cart-facing helpers; host/platform conveniences must not become the hardware API.
- Trust internal contracts. Do not add null checks, optional chaining, `typeof fn === 'function'`, catch fallbacks, or legacy fallbacks around values that the design says must exist.
- Let failures surface unless the boundary is genuinely fallible: parsing external data, browser APIs, IO, network, optional user configuration, feature detection, or cart/user input.
- Keep ownership visible. Avoid facade, host, provider, service, descriptor, manager, registry, adapter, and broker layers unless they are already part of a proven subsystem boundary.
- Prefer direct state and direct calls over wrapper functions that only rename or forward work.
- Keep loops, scheduler paths, render paths, CPU/runtime paths, editor text/layout paths, and cart hot paths allocation-aware. Avoid temporary arrays/objects/closures in hot paths.
- Use existing BMSX primitives: `TaskGate` and `AssetBarrier` for async coordination, `clamp` from `src/bmsx/common/`, and scratch buffers/pools for temporary hot-path data.
- Do not normalize values to `null` with `?? null`; preserve `undefined` unless the public contract explicitly requires `null`.
- Use `switch` for multi-way closed-kind dispatch instead of `if/else if` chains.
- Name concepts once. If an expression such as bounds, normalization, lookup, line splitting, keyword lowercasing, or caret math repeats, extract a real concept or shared helper.
- In cart code, use cart-facing globals/helpers instead of `engine.*`, keep repeated string identifiers short, and read constants directly instead of aliasing global constant tables.
- Treat serialization as part of feature design. Registry/persistent runtime objects and host-only state should not leak into saved game state.
- Do not hand-fix indentation. Make the code change, then run `npm run fix:indent -- <touched paths>` for formatting/indent cleanup. If that tool cannot handle the touched language well enough, improve the tool or call out the limitation instead of committing manual whitespace churn.

## Hot-Path Duplication Discipline
For CPU/program, scheduler, VDP, render, and other tight emulator/runtime paths, the correct answer is often not a helper. Do not extract repeated opcode/register/timer/state statements just to satisfy a quality rule when the duplication keeps the hot path direct, predictable, allocation-free, and easy for the compiler/JIT to optimize.

When repeated code in these paths is intentional and performance-sensitive, mark the smallest practical section with a local quality region and explain the reason:

```ts
// @code-quality start repeated-sequence-acceptable -- CPU opcode fast path keeps register updates inline; helper dispatch would add overhead.
// @code-quality end repeated-sequence-acceptable
```

Use real cleanup for non-hot code, setup/init code, firmware table construction, asset metadata assembly, manifest shaping, and other places where extracting a concept improves ownership without adding dispatch, allocation, or abstraction cost. In short: no helper fetish in CPU/program hot paths; no duplicated sludge outside them.

## Anti-Workaround Rule
Do not satisfy a quality rule by producing worse code. If a rule pushes toward worse code, fix the rule first.

Forbidden evasions include:
- Adding terminal `return;` to dodge single-line body rules.
- Rewriting `return record ? record.current : null;` into an `if (!record) return null;` block when optional chaining or a contract change is the real answer.
- Introducing useless constants, wrappers, helpers, aliases, or methods only to pacify a rule.
- Splitting a compact expression into ceremonial enterprise flow without improving ownership, clarity, or performance.

Before finalizing a code-quality change, inspect your own diff specifically for these evasions.

## Quality Workflow
- For analyzer/rule work, read `references/quality-workflow.md`.
- For style anchors from selected 2024 BMSX engine code, read `references/lean-history.md`.
- For recurring bad patterns and preferred replacements, read `references/anti-patterns.md`.
- For architecture, cart API, serialization, and runtime-performance rules distilled from `AGENTS.md`, read `references/project-rules.md`.
- Suppressions are allowed only when the exception is real and local. Use rule-specific comments with a short reason, for example:

```ts
// @code-quality disable-next-line empty_catch_pattern -- browser API cleanup is best-effort here
try {
    releaseExternalHandle();
} catch {
}
```

Use region directives for scope-based analysis instead of hardcoded path exceptions:

```ts
// @code-quality start hot-path -- caret/layout work runs during frame input/render
// @code-quality end hot-path

// @code-quality start ensure-acceptable -- explicit capacity helper, not lazy singleton ownership
// @code-quality end ensure-acceptable

// @code-quality start required-state editorDocumentState,editorViewState -- owned state roots in this module
// @code-quality end required-state

// @code-quality start value-or-boundary -- manifest default is resolved at this boundary
// @code-quality end value-or-boundary

// @code-quality start fallible-boundary -- external parser/browser API can fail and maps failure to UI state
// @code-quality end fallible-boundary
```

## Finish Line
Run checks that match the touched area. Prefer these when relevant:

```bash
npm run fix:indent -- <touched paths>
npm run compile:engine
npm run analyze:code-quality -- --root src/bmsx/machine
npm run analyze:code-quality -- --root src/bmsx_cpp/machine
git diff --check
```

If a broad check is too expensive or noisy, run the narrowest meaningful root and state that scope clearly.
