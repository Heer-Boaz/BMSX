# Emulator architecture work

This is an internal engineering work-order guide for the TypeScript and C++
implementations. The console's product specification lives in the technical
manuals listed by [the catalog](manual/catalog.json), not here or in
[internal software architecture](architecture.md).

## Target

Keep each emulated state and operation with its real CPU, memory, device or
scheduler owner. Host applications compose execution and physical services;
Studio and project tools remain consumers above those boundaries. Co-located
source does not make a library, converter or build tool part of the console.

## Engineering constraints

- Keep mirrored machine responsibilities and representations coherent.
- Preserve raw machine words and direct buffer/data paths; convert only at the
  owner that interprets them.
- Keep mutable state with its existing owner rather than adding shadow models,
  facade layers, fallback state, compatibility readers or speculative validation.
- Source compilation, source symbols, workspace state and UI policy remain
  tooling responsibilities. `cartlib` remains independent cartridge software.
- Persistence captures live state directly; no alternate revisioned state model
  or repair pass is introduced.
- Follow the public manuals for intended product behavior and verify relevant
  spec leaves, owners and tests. Report conflicts rather than treating old
  architecture prose or an old work order as authority.

## Working on a slice

Start from the current branch/diff and the live owners. Treat historical plans
as hypotheses. Identify the representation and affected callers before editing;
for mirrored runtime work account for both implementations and hot paths.

Choose validation for the actual changed surface: focused TS/native tests,
build/typecheck, cross-runtime execution, real backend output or visible UI
interaction. Use `npm run audit:core-parity` for mirrored accounting and finish
with `git diff --check`. Passing a typecheck or parity inventory is not proof
of ownership, speed or hardware correctness.

Update `architecture.md` only for actual software ownership/dependency changes.
Update the appropriate manual for public hardware/BIOS behavior. Do not append
register tables, format descriptions, successful test transcripts or completed
migration history to the internal architecture document. Existing open work is
tracked in [open architecture slices](open_architecture_slices.md); it is not a
second specification or blanket authorization to implement its proposals.
