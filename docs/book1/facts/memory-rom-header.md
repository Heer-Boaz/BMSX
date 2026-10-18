# Current ROM header facts for one bounded writing slice
Scope: facts-only, live 2026-10-18; no runtime/compiler/BIOS/publisher/test changes.
Public gap: docs/book1/memory.md:147-183 names four boot checks but gives no field layout.
Public dependency: docs/book3/cartridge.md:24 delegates ROM header/startup authority to that section.
Placement: put the authoritative current ROM header table and boot-prefix distinction in
Memory's Reset and cartridge startup section, with Book III linking there; do not duplicate
socket composition/MMIO/selection/tails or the complete 96-byte executable-image ABI.

## Paired source keys
P = machine/ts/spec/bmsx/rom_package.ts:1-16 + machine/cpp/spec/bmsx/rom_package.h:9-24.
B = machine/ts/spec/bmsx/rom_header.ts:1-8 + machine/cpp/spec/bmsx/rom_header.h:7-14.
W = toolchain/ts/rompack/header_encode.ts:27-46 + machine/cpp/rompack/format.cpp:20-59.
R = machine/ts/rompack/format.ts:53-99 + machine/cpp/rompack/format.cpp:62-111.
D = machine/ts/machine/execution_address_space.ts:69-108 + machine/cpp/machine/execution_address_space.cpp:49-85.
All fields below occupy exactly 4 bytes, unsigned 32-bit little-endian (W/R).
Offsets are byte offsets from the start of ROM package, not word indices or MMIO addresses.
The full current package header is 72 bytes (P). Boot resolution requires 60 backed bytes (B/D).
A BLua32 image has a separate 96-byte header: machine/ts/spec/blua32/image_format.ts:1-3
+ machine/cpp/spec/blua32/image_format.h:7-9. These three sizes must not be conflated.

| Byte offset | Field | Value / representation | Leaf source |
| ---: | --- | --- | --- |
| 0 / 0x00 | MAGIC | Constant 0x58534d42 (bytes 42 4d 53 58, BMSX) | P |
| 4 / 0x04 | HEADER_SIZE | Current producer writes 72; BIOS checks >=60, not ==72 | P |
| 8 / 0x08 | MANIFEST_OFFSET | ROM-package-relative byte offset | P |
| 12 / 0x0c | MANIFEST_LENGTH | Byte count | P |
| 16 / 0x10 | TOC_OFFSET | ROM-package-relative byte offset | P |
| 20 / 0x14 | TOC_LENGTH | Byte count | P |
| 24 / 0x18 | DATA_OFFSET | ROM-package-relative physical-payload offset, not writable DATA run address | P |
| 28 / 0x1c | DATA_LENGTH | Physical-payload byte count, not program DATA section size | P |
| 32 / 0x20 | BLUA32_IMAGE_OFFSET | ROM-package-relative executable-image byte offset; zero means no image in D | B |
| 36 / 0x24 | BLUA32_IMAGE_BYTE_COUNT | Linked executable-image byte count | B |
| 40 / 0x28 | BLUA32_STARTUP_FUNCTION_ADDRESS | Absolute guest function-record address, not image offset or instruction PC | B |
| 44 / 0x2c | BLUA32_IRQ_FUNCTION_ADDRESS | Absolute guest function-record address | B |
| 48 / 0x30 | BLUA32_EXCEPTION_FUNCTION_ADDRESS | Absolute guest function-record address; do not infer cartridge fault routing from presence | B |
| 52 / 0x34 | BLUA32_STATIC_LAYOUT_TOKEN_LO | Opaque low token word; neither address nor byte count | B |
| 56 / 0x38 | BLUA32_STATIC_LAYOUT_TOKEN_HI | Opaque high token word; neither address nor byte count | B |
| 60 / 0x3c | BLUA32_DIAGNOSTIC_DIRECTORY_OFFSET | ROM-package-relative byte offset; initialized zero without emitted diagnostics | P |
| 64 / 0x40 | METADATA_OFFSET | ROM-package-relative byte offset | P |
| 68 / 0x44 | METADATA_LENGTH | Byte count | P |

## Owning producers and zero meanings
scripts/rompacker/rombuilder.ts:1345-1385 constructs every field then invokes W.
Its data span is [first physical span start,dataEnd), TOC follows aligned dataEnd.
Its no-BLua32 path writes zero to image offset/count, function addresses and both token words.
The image builder uses SYSTEM_ROM_BASE + imageOffset for system and CART_ROM_BASE + imageOffset
for cartridge: scripts/rompacker/rombuilder.ts:1069-1083,1123-1133,1149-1158,1184-1194.
Token producer hashes static section layouts/symbols and init participants, not RAM contents:
toolchain/ts/rompack/blua32_linker.ts:298-348,960-971. Do not teach its hash algorithm as guest ABI.
Manifest/metadata absent lengths are zero in toolchain/ts/rompack/rom_prefix_layout.ts:51-94;
this is not a blanket assertion that every arbitrary zero offset denotes an absent section.
Full package parsers R require size exactly72 and range-check manifest/TOC/data/metadata;
these packaging checks are not CPU reset, BIOS readiness, or a complete executable validator.

## Exact read/check/entry edges
1. BIOS machine/bios/main.lua:28-36,58-74 samples STATUS once per scan, visits present slots
   0 then1, writes SELECT, checks MAGIC==0x58534d42, HEADER_SIZE>=60, IMAGE_OFFSET!=0,
   STARTUP_FUNCTION_ADDRESS!=0. It returns the first passing startup word.
2. BIOS machine/bios/main.lua:105-123,136-143 waits VBlank before screen updates and hands
   off when ready plus retained boot_frame>=50: clear/flush terminal, IRQ MASK=0, CP0 EXEC=startup.
   It does not inspect the full package table or execute IMAGE_OFFSET as a PC.
3. D binds 60 installed ROM bytes in the named domain, rejects unbacked prefix or zero
   IMAGE_OFFSET, reads the three absolute function addresses, derives the image address.
   D does not perform the BIOS MAGIC/HEADER_SIZE tests or inspect IMAGE_BYTE_COUNT/tokens.
4. Installed-ROM descriptor binding is not zero-filled tail access: machine/ts/machine/memory/memory.ts:708-718
   + machine/cpp/machine/memory/memory.cpp:623-633; card extent gate machine/ts/machine/devices/cartridge/card.ts:264-274
   + machine/cpp/machine/devices/cartridge/card.cpp:240-250 (verify shifted native lines before publication).
5. CPU reset uses system-domain STARTUP and exception address: machine/ts/machine/cpu/cpu.ts:869-908
   + machine/cpp/machine/cpu/cpu.cpp:431-472. Activation binds separate image header and
   decodes constants/global mappings, not DATA/BSS: TS cpu.ts:1064-1127 + C++ cpu.cpp:594-643.
6. EXEC reads selected target function record through ordinary CPU bus, requires STATIC,
   hard-halts on failed read/nonstatic, then changes execution domain/status and pushes
   zero-argument function: TS cpu.ts:1499-1546 + C++ cpu.cpp:1082-1118.
7. Generated startup performs DATA copy, BSS zero, module init, entry call (system boot
   primitive clear before entry): toolchain/ts/lua/compiler.ts:1505-1584. Already public;
   only cross-reference it instead of rewriting the complete startup explanation.

## Conflict stop / programmer-facing boundary
D's image-address arithmetic differs for overflowing raw words: TS line94 retains host sum;
C++ line74 assigns u32 sum. For cart base0x10000000 plus offset0xfffffff0, sums are
0x10ffffff0 versus0x0ffffff0. Do not publish a common overflow rule or fix runtime here.
This is an intermediate-representation observation only; downstream guest behavior
was not assessed and no guest-visible divergence is established by this packet.
Publish offset-vs-address meaning only for ordinary linked backed images; malformed raw
header behavior is not a new electrical specification or a guest validation obligation.
Cartridge authors normally let the builder/linker emit the header; do not hard-code sample
startup addresses, cast IMAGE_OFFSET to a function, hand-edit tokens, or equate package
DATA_OFFSET with program DATA. No new serializer/header helper is needed for the writing.
