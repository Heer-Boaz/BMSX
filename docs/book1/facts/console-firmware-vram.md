# Firmware VRAM reservation — finite overview facts

Facts only, current 58bbf76d7. Existing memory-vram index located these direct
owners; the files below were opened. No architecture/PDF/runtime change.

- V01. Named BIOS export `gpu/system_vram_region` is in BIOS_FUNCTION_EXPORTS.
  It is a callable no-argument function, not an asset ID or numerical register.
  Sources: `toolchain/ts/rompack/system.ts:9-21`;
  `machine/bios/gpu/system_vram_region.lua:1-29`.
- V02. The function computes the bounding rectangle of the full terminal-layout
  surface and actual system-texture upload rectangle. It returns origin x/y in
  low/high16 of first word, width/height in low/high16 of second. It has no
  hardware read/write/wait or allocation and no active-viewport/handoff input.
  Sources: `machine/bios/gpu/system_vram_region.lua:10-29`.
- V03. Current boot initializes drawing at terminal_layout.vram_origin and
  uploads the system texture, then opens/flushes the terminal. Handoff clears
  status/flushes, clears IRQ mask and writes EXEC, with no reservation-release
  operation or layout/asset-header change in that path. Do not invent a release
  or imply cartridge entry makes the whole VRAM capacity available.
  Sources: `machine/bios/main.lua:105-113,126-136`;
  immutable query inputs `machine/bios/gpu/system_vram_region.lua:2-3,10-29`.
- V04. Existing real cartlib consumes that named function directly, extracts
  both words' halves and reserves the complete returned rectangle before its
  framebuffer allocation. This is evidence for reservation use, not universal
  proof that all other VRAM coordinates are free.
  Source read directly: `cartlib/gx/vram.lua:1-2,77-119`.

Overview may cross-reference canonical Memory "Firmware reservation in VRAM"
for the complete call/unit interpretation. Do not emit fixed current image
coordinates/sizes or guess GPU ownership/protection/release. No second ABI or
new allocator is authorized. Actual arbitrary VRAM contents/physical protection
and all coordinates outside the rectangle are not established by these facts.
