# Repository agent instructions

## Implementation rules

- Before implementing anything, study best-practice reference implementations
  in serious production codebases on GitHub that match the problem domain.
  Example: IDE work -> VS Code, media player work -> VLC, fantasy
  console/emulator work -> MAME.
- Performance is mandatory. Do not introduce unnecessary allocations, GC
  churn, repeated work, redundant abstractions, duplicate validation, or
  defensive hot-path overhead.
- Follow professional codebase structure. Split responsibilities across files
  and modules the way mature apps do. Do not dump unrelated logic into one
  file.
- Before adding a new helper, first check whether an equivalent helper already
  exists. If not, decide whether it should be introduced as a general shared
  helper instead of a one-off local utility.
- No defensive-check clutter. Do not add redundant guard code, fallback junk,
  or speculative validation layers unless there is a real proven need.
- No ugly facade/host patterns. Do not add artificial wrapper layers that hide
  ownership, blur boundaries, or make control flow harder to follow.
- No useless `?? null` normalization.

## Architecture gates

- Never infer an implementation task from contextual documentation alone. Ask
  whether the requested output is an audit, plan, review, or implementation.
- Treat handover plans as hypotheses. Verify every proposed slice against the
  live owners and mirrored implementations before editing.
- A behavior-preserving move is forbidden when the moved code itself conflicts
  with the target architecture.
- Before mirrored-runtime edits, produce a TypeScript/C++ representation table
  and name every hot-path callsite.
- Guest-value classification must follow the guest/runtime representation.
  Host object identity, string-kind probes, and shape casts are not valid
  substitutes for a machine representation.
- Typechecks and unit tests prove neither architectural ownership nor hot-path
  performance.
- If the owner or representation is wrong, stop. Do not extract, wrap, rename,
  or relocate the bad code.
