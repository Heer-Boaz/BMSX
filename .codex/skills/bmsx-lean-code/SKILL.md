---
name: bmsx-lean-code
description: "Use when editing, reviewing, refactoring, or designing BMSX TypeScript, C++, Lua, emulator, fantasy console, IDE, runtime, render, cart, architecture, or analysis tooling code. This is a hard-stop skill: block junk architecture, defensive clutter, facade/host/provider/service patterns, lazy ensure paths, wrapper forwarding, hidden analyzer skips, hot-path allocations, and performance regressions. Prefer deletion, inlining, direct ownership, explicit hardware/device contracts, and quality-rule fixes that expose bad code instead of hiding it."
metadata:
  short-description: "Hard-stop BMSX lean code gate"
---

# BMSX Lean Code

This skill is a gate, not style advice. Use it whenever touching or judging
BMSX code. Its job is to prevent "architecture improvement" from adding more
junk.

Default posture: stop before editing unless the next patch removes a concrete
disease and leaves the touched code simpler, faster, and more directly owned.

## Non-Negotiable Outcome

A successful patch must do at least one of these:

- delete a wrapper, facade, host/provider/service layer, callback injection, or
  fake helper;
- collapse duplicated state checks into one owned lifecycle/state decision;
- move behavior to the owner of the data without adding a generic middle layer;
- remove defensive internal bug-hiding code and let the real contract fail
  loudly;
- remove lazy `ensure`/first-use initialization from steady-state paths and put
  initialization at a real setup boundary;
- remove hot-path allocation, string churn, or repeated normalization;
- fix a quality rule so it exposes bad code instead of skipping by name, path,
  usage count, or vibes.

If the patch does not clearly do one of those, do not implement it.

## Stop Gates

Stop and report the blocker before editing when the likely fix requires any of
these:

- "temporary" structure that is expected to be removed later;
- new facade, host, provider, service, descriptor, adapter, manager, broker, or
  generic callback layer;
- an injection/callback pattern just to avoid naming the real owner;
- a wrapper function that only renames, forwards, adapts trivial arguments, or
  exists to satisfy a scanner;
- lazy `ensure*` or "create if missing" checks in methods called after startup;
- mandatory CPU shadow/write-through work in a hot path that can write the
  backend/device state directly;
- new compatibility aliases, legacy fallbacks, dual-name support, or migration
  shims;
- broad suppressions, name-based analyzer allowances, usage-count allowances,
  or hardcoded file/path skip lists;
- more comments/suppressions than actual simplification;
- a diff that is harder to read than the original code.

When a stop gate triggers, say exactly which gate triggered and name the owner
that must be understood before changing code.

## Required Workflow

1. Read the nearest `AGENTS.md` and the current code around the planned edit.
2. Name the disease in one sentence before changing files:
   "duplicated engine state check", "lazy texture initialization",
   "render singleton discovery", "defensive null blanket", etc.
3. Search first with `rg` for existing owners, helpers, state names, lifecycle
   methods, and related TS/C++ counterparts.
4. For architecture, emulator, render, IDE, or media behavior, inspect a serious
   reference implementation when useful: MAME/Dolphin for emulator/video,
   VS Code for IDE/editor, VLC or mature media code for audio/video.
5. Choose the smallest end-to-end slice that removes the disease now.
6. Edit only if the patch shape passes the "Acceptable Patch Shape" section.
7. Run checks matching the touched area.
8. Audit the diff for junk before finalizing.

## Acceptable Patch Shape

Prefer these moves, in this order:

- delete dead or fake code;
- inline one-use wrappers and aliases;
- collapse duplicated state predicates into one named lifecycle query or state
  transition owned by the state owner;
- move code directly to the data owner;
- replace defensive internal fallbacks with direct contract use or explicit
  throws at impossible states;
- move initialization to startup/setup/context-restore boundaries;
- fix scanner logic so it reports the real construct precisely.

Adding a new helper is allowed only when all are true:

- it names a real domain concept;
- at least two non-trivial call sites use the same concept, or one call site is
  too complex without the name;
- it does not hide ownership behind a generic layer;
- it does not allocate or dispatch in a hot path unless that cost already exists
  and remains justified;
- it makes the caller shorter and easier to read.

## Forbidden Patterns

Do not add:

- `if (!x) return`, optional chaining, `typeof fn === 'function'`, catch
  fallbacks, or `?? null` around internal state that should exist by design;
- `ensure*`, `initializeIfNeeded`, `getOrCreate`, or lazy singleton checks in
  regular execution paths;
- forwarding wrappers such as `getFoo() { return getBar(); }`, `uploadFoo(...)`
  that only calls `updateFoo(...)`, or C++ thunks except unavoidable ABI/MMIO
  callbacks marked locally;
- service/provider/facade/host abstractions unless they are already the proven
  domain owner and the patch removes indirection elsewhere;
- temporary arrays, objects, closures, strings, regexes, or normalized copies in
  CPU, VDP, scheduler, render, editor layout, or cart hot paths;
- broad quality comments that silence a region because cleanup is hard.

Valid fallible boundaries are external input, parsing, browser APIs, IO,
network, feature detection, optional user config, and cart/user-authored input.
Every other fallback is suspicious until proven otherwise.

## Architecture Rules

- BMSX is a fantasy console with real console discipline. Cart-visible hardware
  belongs behind memory maps, MMIO registers, machine devices, and cart-facing
  helpers.
- Host/platform/render/IDE conveniences must not become the hardware contract.
- TS and C++ should express the same ownership unless language/runtime details
  force a difference.
- Performance is part of architecture. A cleaner diagram that slows a hot path
  is not clean.
- Do not solve boundary leaks with generic callback injection. Move discovery to
  setup, then let the owner call concrete owned state directly.
- Preserve direct backend/device writes in hot paths when that is the hardware
  contract. CPU readback mirrors are for software paths, save-state/readback, or
  explicit synchronization boundaries, not mandatory write-through ceremony.

## Quality Scanner Rules

Analyzer code is production code.

- Never skip by function name, class name, file path, word list, usage count, or
  "boundary-looking" spelling.
- Use local, rule-specific comments or regions only for real exceptions owned by
  the code site.
- Adding suppressions is not a win. Treat each suppression as debt unless the
  code is an unavoidable ABI/hardware boundary or a documented hot-path choice.
- If a rule pushes code toward worse shape, fix the rule before product code.
- Keep rules precise: parse tokens/ASTs, report the smallest useful construct,
  and preserve semantic targets in fingerprints.
- Do not create thin rule wrappers, export-only files, or generic
  `pushIssue` forwarding files.

For rule work, read `references/quality-workflow.md`.

## Hot Paths

Hot paths include CPU/program execution, scheduler, VDP/MMIO, render/blitter,
audio frame work, editor text/layout, and cart update/draw loops.

In hot paths:

- mutation of existing buffers/state is preferred over abstraction;
- repeated inline code may be correct when a helper would add dispatch,
  allocation, or hide opcode/device state;
- use scratch buffers/pools from `src/bmsx/common/` when temporary storage is
  genuinely needed;
- do not allocate arrays/objects/closures or repeatedly normalize strings;
- mark intentional repeated sequences with the smallest local
  `repeated-sequence-acceptable` region and a performance reason.

## Cart Code

- Cart code must not call `engine.*`; use cart-facing globals/helpers.
- Keep cart-visible strings short. Repeated long prefixes in tags/events/effect
  IDs/timeline IDs are forbidden.
- Do not alias global constants into locals just to shorten access.
- Serialization is part of feature design: decide what saves and what is
  runtime-only before adding state.

## Required Diff Audit

Before finalizing, inspect the diff for:

- `return;` added only to silence a rule;
- `?? null`, optional chaining, `typeof`, `catch`, `fallback`, `ensure`,
  `provider`, `service`, `host`, `descriptor`, `adapter`, `manager`;
- new one-use locals/helpers;
- new comments/suppressions without code simplification;
- new allocations or string work in hot paths;
- duplicated state checks still present under new names;
- TS/C++ conceptual divergence.

If the audit finds junk introduced by the patch, remove it before finalizing or
report that the attempted slice is not viable.

## Validation

Run the narrowest meaningful checks, then broaden when the touched area is
shared or runtime-visible.

Common checks:

```bash
npm run fix:indent -- <touched paths>
npm run compile:engine
npm run analyze:code-quality -- --root <touched root>
npm run build:game -- pietious --force
npm run build:platform:libretro-wsl
npm run headless:game -- pietious
git diff --check
```

Use `TMPDIR=/tmp` for `tsx` commands when the local environment needs it.

## Reference Files

Load only when relevant:

- `references/quality-workflow.md` for analyzer/rule changes.
- `references/anti-patterns.md` for smell examples and replacements.
- `references/project-rules.md` for AGENTS-derived project rules.
- `references/lean-history.md` for selected 2024 BMSX style anchors.

## Final Response Discipline

When reporting work, state:

- the disease removed;
- whether the patch deleted/collapsed more than it added;
- any stop gate that blocked further cleanup;
- the checks actually run.

Do not call a slice done because the analyzer passes. Done means the touched
code is simpler, more directly owned, and no slower on the relevant path.
