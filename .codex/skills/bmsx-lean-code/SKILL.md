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
- Legacy and compatibility code is forbidden. Do not add compatibility shims, migration aliases, old-name fallbacks, deprecated contract bridges, dual-key support, or "accept both old and new" paths. Fix the caller/config/data to the current contract instead of preserving the old one.
- Keep ownership visible. Avoid facade, host, provider, service, descriptor, manager, registry, adapter, and broker layers unless they are already part of a proven subsystem boundary.
- Prefer direct state and direct calls over wrapper functions that only rename or forward work.
- Place files in the folder that owns the named concept. Do not put compound names as loose root-level files when the name already describes the hierarchy. A file named like `runtime_error_navigation.ts` belongs under `runtime/error/navigation.ts`; likewise prefer `cart/source/files.ts`, `runtime/boot/timing.ts`, or `editor/runtime/error.ts` over root grab-bag filenames. If the right folder does not exist yet, create it instead of flattening ownership into a top-level module. If a specific file is a legitimate local architecture boundary exception, mark that local contract with `@code-quality` analysis comments instead of adding rename-sensitive path config or moving the file to a root grab-bag.
- Keep loops, scheduler paths, render paths, CPU/runtime paths, editor text/layout paths, and cart hot paths allocation-aware. Avoid temporary arrays/objects/closures in hot paths.
- Use existing BMSX primitives: `TaskGate` and `AssetBarrier` for async coordination, `clamp` from `src/bmsx/common/`, and scratch buffers/pools for temporary hot-path data.
- Do not normalize values to `null` with `?? null`; preserve `undefined` unless the public contract explicitly requires `null`.
- Use `switch` for multi-way closed-kind dispatch instead of `if/else if` chains.
- Name concepts once. If an expression such as bounds, normalization, lookup, line splitting, keyword lowercasing, or caret math repeats, extract a real concept or shared helper.
- Aliasing input contracts is forbidden. Do not alias CLI argument names, option payload entries, event handler names, event IDs, command IDs, manifest fields, or config keys. There must be one canonical name at the boundary; do not normalize multiple names into one internal value.
- Newline normalization is exceptional. Do not normalize `\r`/`\n` line endings with `split`, `replace`, or `replaceAll` unless that exact expression has the previous-line or same-line comment `@code-quality newline_normalization_pattern -- reason`.
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

## Quality Rule Code Contract
Treat analyzer and lint code as production code. The checker must model good engineering, not become a second trash pile next to the product code.

- Keep rules project-agnostic by default. Do not bake BMSX paths, file names, root object names, function-name word lists, issue-pusher names, or rename-sensitive exceptions into generic rules.
- Use `@code-quality` directives, analysis regions/statements, or explicit config for local contracts. A hot path, accepted numeric boundary, required state root, or intentional wrapper must be marked near the code that owns that exception.
- Generic suppressor machinery is allowed, but every suppressor must require an explicit exact rule name. Broad disables, wildcard disables, unnamed `@code-quality disable`, and alias tags such as `legacy-sentinel-string-acceptable` are forbidden. A local exception must point at the concrete rule it suppresses, for example `@code-quality disable-next-line legacy_sentinel_string_pattern -- reason`.
- Do not add fallback skip lists. Directory/file exclusion should come from source-control/project config such as `.gitignore` or a real analyzer config, not hardcoded guesses.
- Put language parsing, token scanning, AST naming, call-target extraction, literal checks, operator searches, and range helpers in language/support modules. Pattern files should combine existing language helpers into one rule, not reimplement parsers.
- Every rule file must contain real detection logic for that rule. Empty files, export-only shims, and thin wrappers that only call `pushLintIssue` are forbidden.
- Keep one coherent rule per file and move shared mechanics into support modules. Do not grow monolithic analyzer files, but also do not split code into fake files without ownership.
- Share generic logic across TS, C++, and Lua when the concept is the same. Do not copy/paste near-identical rules per language unless the language-specific parsing genuinely differs.
- Prefer precise AST/token logic over text grep. Report the smallest meaningful construct and preserve semantic targets in fingerprints; `min` and `max`, `trim` and `slice`, `startsWith` and `includes` are different operations.
- Avoid duplicate or noisy findings. Exact duplicates, semantic duplicates, normalized-body duplicates, and repeated-statement rules should not all report the same underlying issue.
- Keep diagnostics actionable and bounded. Include a compact sample when useful, but do not dump giant expressions or vague “bad style” messages.
- If a rule needs many hardcoded exceptions, the rule is probably wrong. Improve the rule shape before touching product code.

## Quality Workflow
- For analyzer/rule work, read `references/quality-workflow.md`.
- For style anchors from selected 2024 BMSX engine code, read `references/lean-history.md`.
- For recurring bad patterns and preferred replacements, read `references/anti-patterns.md`.
- For architecture, cart API, serialization, and runtime-performance rules distilled from `AGENTS.md`, read `references/project-rules.md`.
- Rule exceptions are allowed only when the exception is real, local, and tagged with the exact rule name. Use rule-specific comments with a short reason, for example:

```ts
// @code-quality empty_catch_pattern -- browser API cleanup is best-effort here
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
