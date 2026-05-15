# BMSX Hardware-Emulation Goal

This file tracks the active architecture goal for the TypeScript and C++ BMSX
machine cores. It is a work-order checklist; stable hardware contracts live in
`docs/architecture.md` and the device-specific hardware documents.

## Target

Both BMSX cores should be structured like real machine emulators: CPU-visible
state enters through RAM, MMIO, command words, FIFOs, registerfiles, device
memory, timing edges, and IRQ/status/fault paths. Host code may present output
and inject input, but it must not own cart-observable behavior.

MAME is the reference style: devices own live state; save-state is passive
persistence of that live state, not a parallel object model.

## Non-negotiable constraints

- Keep TypeScript and C++ core ownership mirrored by relative path and role.
- Preserve hot-path performance and retained buffers; never break the direct
  VRAM-to-GPU texture path for cosmetic architecture.
- Do not add compatibility readers, legacy migration branches, defensive repair,
  facade/provider/adapter layers, DTO validation, or wrapper-only APIs.
- Use raw register words, integer fixed-point words, addresses, opcodes, slots,
  surface ids, packet fields, and render commands directly at their hardware
  boundaries.
- Keep cart/gameplay Lua at intent level; BIOS/system utilities may emit raw
  MMIO/RAM words, but gameplay files must not invent local hardware ABI helpers.

## Completion criteria

The goal is not complete until all of these are true in the current checkout:

1. `docs/architecture.md` describes the current machine/host boundary without
   stale migration notes or duplicated work queues.
2. Device docs that remain under `docs/` read as hardware contracts: register
   maps, latches, FIFOs, registerfiles, datapaths, timing edges,
   status/fault/IRQ behavior, save-state-visible state, and TS/C++ owners.
3. `npm run audit:core-parity` passes and any exceptions are narrow and current.
4. Scoped quality scans for touched machine/device files report zero issues.
5. Mirrored runtime slices pass TS build/typecheck and native build/tests.
6. Cart-visible behavior changes have focused tests that exercise RAM/MMIO or
   public device edges, not only private helper calls.
7. A slice-boundary reviewer returns no blockers for ownership, parity,
   performance, defensive clutter, compatibility paths, or fake architecture.

## Current remaining work

1. Continue splitting monolithic device controllers along hardware-unit
   boundaries: registerfiles, latches, FIFOs, datapaths, timing edges, and
   service points.
2. Keep ICU moving toward distinct register, action-table, FIFO, sample-latch,
   query, and output datapaths without creating wrapper layers.
3. Keep VDP/APU/GEO contracts honest: device-visible state first, host queues and
   renderer/audio backends only at output edges.
4. Treat save-state as passive persistence of live machine state; do not create
   parallel contracts when the live hardware owner already has the record shape.
5. Promote aggregate persistence plumbing only when it can be done without
   opening private hardware fields as fake public contracts.
6. Delete or rewrite any remaining hardware document that cannot be maintained
   as a current hardware contract.

## Validation menu

Use the smallest relevant set while iterating, then the broader set before a
slice lands:

- `npx tsc --noEmit --pretty false`
- `npm run compile:console -- --pretty false`
- `cmake --build build-cpp-tests --target bmsx_core_golden_tests -j2`
- `./build-cpp-tests/bmsx_core_golden_tests`
- focused `npx tsx --test --import ./tests/lua/test_setup.ts ...`
- `npm run analyze:code-quality -- --root <touched TS/C++ roots>`
- `npm run audit:core-parity`
- `git diff --check`
