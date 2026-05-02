# Repo-Wide Engineering Rules

This is a controlled codebase. Do not write defensive application-style code for values produced by our own runtime, compiler, tools, assets, carts, tests, editor, or engine.

Hard bans unless the user explicitly asks for an exception:
- No `Number.isFinite`, `Number.isNaN`, `isNaN`, `typeof x !== 'number'`, or `typeof x === 'number'` for internally produced values.
- No `math.floor` or `math.ceil` for fixed-point, register-word, address, opcode, VM, compiler, or renderer data.
- No local encoding/decoding helpers in random feature files.
- No rollback/capture/restore around state writes unless the domain explicitly models transactions.
- No safe fallback for corrupt, incomplete, stale, weird, or representable state.
- No wrappers/helpers whose only value is cosmetic callsite cleanup.
- No runtime DTO-style validation for data that comes from our own code.

Design rules:
- Producers must emit the right representation.
- Consumers must consume the representation directly.
- If conversion is needed, it belongs at the owning abstraction, not at a random callsite.
- If a value is a word, address, opcode, register, fixed-point value, token, AST node, VM slot, render command, or asset id, keep it as that representation.
- Weird but representable data must flow deterministically through the system.
- If code appears to need defensive validation, change the data boundary or producer instead.

Utility placement:
- Shared low-level helpers live in central owner files.
- Domain/gameplay/feature files must not invent local ABI, fixed-point, register, path, parser, or encoding helpers.
- Prefer constants, raw words, integer arithmetic, or existing central utilities.

Hard bans unless the user explicitly asks otherwise:
- Do not add `Number.isFinite`, `Number.isNaN`, `isNaN`, `typeof x !== 'number'`, or `typeof x === 'number'`.
- Do not add `math.floor` or `math.ceil` for fixed-point or register-word encoding.
- Do not add local Q16/fixed/register encoding helpers inside gameplay cart files.
- Do not add rollback/capture/restore around MMIO writes.
- Do not add safe fallbacks for corrupt, incomplete, or weird device state.
- Do not add wrappers/helpers just to make callsites cosmetically cleaner.
- Do not add runtime validation for values produced by BMSX-owned code.
- Do not preserve legacy behavior if it conflicts with the hardware model.

For BMSX hardware emulation:
- Hardware units are registerfiles, latches, buffers, FIFOs, and datapaths.
- Store raw register words.
- Decode at datapath boundaries.
- Weird but representable bits produce weird deterministic output.
- Gameplay code programs raw constants, integer fixed-point, or BIOS/system utilities.
- Random cart files such as `combat.lua` must not define VDP ABI helpers.

If a patch appears to need a banned pattern, stop and change the ownership/data boundary instead.
