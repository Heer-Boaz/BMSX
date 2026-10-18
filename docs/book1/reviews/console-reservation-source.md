# System overview — firmware VRAM reservation source review

Result: **PASS within the paragraph below.** No concrete unsupported or mismatched sentence found. No rewrite requested.

Reviewed at `58bbf76d71bca37cff38e4c14690d61b37f9b654`:

> Firmware uses the shared GPU memory for its terminal surface and system texture. Reserve the complete bounding rectangle returned by the named BIOS function `gpu/system_vram_region`; cartridge entry does not release that reservation. The query is not an allocation operation and does not establish that every other VRAM location is free. See Memory, ‘Firmware reservation in VRAM’, for the call and coordinate units.

## Scope and actual sources opened

The finite facts sheet was an index only. The following live sources were opened directly:

- `toolchain/ts/rompack/system.ts:9–21`: actual named BIOS export.
- `machine/bios/gpu/system_vram_region.lua:1–29`: full no-argument query, retained texture-upload words, full terminal-layout rectangle, bounding calculation and two return words; no allocation or enumeration of remaining VRAM.
- `machine/bios/main.lua:14–23,105–143`: firmware GPU/terminal imports, initialization of drawing/display origin and system-texture upload, terminal flush, cartridge handoff without reservation release or query-input changes.
- `machine/bios/tty/layout.lua:1–26`: terminal rectangle and packed origin.
- `machine/bios/tty/terminal.lua:1–25,478–511,524–537,576–608`: actual terminal GPU fill/copy/textured-rectangle commands and submission.
- `cartlib/gx/vram.lua:1–119`: named query import and complete rectangle reservation before framebuffer allocations.
- `docs/book1/memory.md:59–98`: public cross-reference exists; call, packed returns and coordinate units are documented under “Firmware reservation in VRAM”. That section was checked as the cross-reference target, not treated as the factual owner in place of the sources above.

This audit makes no claim about every other VRAM location, hardware write protection, runtime captures, broader BIOS/GPU correctness, or complete-manual acceptance. No architecture document or reference PDF was opened. No repo files were edited; no build/test was run.
