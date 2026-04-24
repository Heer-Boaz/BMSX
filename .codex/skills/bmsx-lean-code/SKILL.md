---
name: bmsx-lean-code
description: "Use when reviewing, cleaning up, refactoring, redesigning, or fixing BMSX quality/architecture debt, and when feature work is blocked by bad code. This is a hard-stop cleanup skill: remove junk instead of adding wrappers, lazy init, defensive clutter, hidden analyzer skips, or performance regressions. Ordinary feature work should use bmsx-feature-code unless it first needs a cleanup slice."
metadata:
  short-description: "Hard-stop BMSX cleanup gate"
---

# BMSX Lean Code

Use this for cleanup, refactor, architecture repair, code review, analyzer work,
and feature tasks that are blocked by bad code. This skill is not a general
feature workflow. It exists to stop cleanup work from adding more junk.

## Gate

Before editing, name the specific disease being removed. If the patch does not
remove a real disease, stop.

Good cleanup deletes, inlines, collapses, or moves ownership closer to the data.
Bad cleanup adds new indirection, new comments, new tags, or new files while the
code remains harder to understand.

## Stop Immediately

Stop before editing if the likely patch needs:

- temporary architecture;
- facade/host/provider/service/descriptor/adapter/manager/broker layers;
- callback injection to avoid naming the real owner;
- wrapper-only functions;
- lazy initialization in steady-state paths;
- defensive fallbacks around internal state that should exist;
- CPU shadow work on a hot path that can update the real backend/device state;
- compatibility aliases or legacy fallback paths;
- analyzer skip lists, name/path/usage exemptions, or broad suppressions;
- more comments or tags than actual simplification.

Report the stop gate and the owner that must be understood first.

## Required Process

1. Read nearby code and nearest `AGENTS.md`.
2. Search with `rg` for existing owners, state, helpers, and TS/C++ counterparts.
3. Use serious references when useful: MAME/Dolphin for emulator/video, VS Code
   for IDE/editor, VLC or mature media code for media.
4. Make the smallest slice that removes the named disease now.
5. Audit the diff for newly added junk before finishing.

## Analyzer And Tags

Analyzer code is production code. Do not hide debt by names, paths, usage
counts, or generic skips. Fix rules so bad code is exposed precisely.

If code must be tagged or suppressed, the local comment must say why that code
is still bad or exceptional. A tag is not a certificate of quality; it marks a
known mess or an unavoidable ABI/hot-path boundary.

For rule work, read `references/quality-workflow.md`.

## Validation

Use the existing project build+validate npm entrypoint for the touched area
instead of duplicating a command menu here. Add narrower analyzer/build/headless
runs only when the change needs extra proof. Always run `git diff --check`.

Use `TMPDIR=/tmp` for `tsx` commands when this environment needs it.

## References

Load only when needed:

- `references/quality-workflow.md` for analyzer work.
- `references/anti-patterns.md` for examples of bad code shapes.
- `references/project-rules.md` for AGENTS-derived rules.
- `references/lean-history.md` for selected 2024 style anchors.
