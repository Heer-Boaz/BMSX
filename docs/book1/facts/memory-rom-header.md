# ROM boot and executable-image consumer facts

Scope: mirrored spec leaves, CPU boot/image/record readers and installed BIOS
boot consumer. Package writers, current section ordering and cartridge libraries
are not machine ABI authority. Public placement: Memory, ROM header fields and
BLua32 executable image; retain their existing boot/EXEC cross-references.

## Source keys

- B: `machine/ts/spec/bmsx/rom_header.ts:1–8` and
  `machine/cpp/spec/bmsx/rom_header.h:7–14`.
- D: `machine/ts/machine/execution_address_space.ts:36–108` and
  `machine/cpp/machine/execution_address_space.cpp:10–85`.
- H: `machine/ts/spec/blua32/image_format.ts:1–46` and
  `machine/cpp/spec/blua32/image_format.h:7–52`.
- A: `machine/ts/machine/cpu/cpu.ts:1064–1127` and
  `machine/cpp/machine/cpu/cpu.cpp:594–643`.
- C: `machine/ts/machine/cpu/cpu.ts:952–1007` and
  `machine/cpp/machine/cpu/cpu.cpp:507–553`.
- N: `machine/ts/machine/cpu/cpu.ts:1009–1047` and
  `machine/cpp/machine/cpu/cpu.cpp:555–591`.
- S: `machine/ts/machine/cpu/cpu.ts:139,929–949` and
  `machine/cpp/machine/cpu/cpu.cpp:484–504`.
- F: `machine/ts/machine/cpu/cpu.ts:1424–1546` and
  `machine/cpp/machine/cpu/cpu.cpp:1019–1118`.
- U: `machine/ts/machine/cpu/cpu.ts:3302–3356` and
  `machine/cpp/machine/cpu/cpu.cpp:2907–2960`.

## Boot prefix

Offsets are bytes from ROM base, not image base. D binds 60 ROM-backed bytes
before reading fields. It does not inspect the size word; its final field ends
at byte51. System domain−1 uses base0; card domains0/1 use base10000000H and
select that socket. Domains: `machine/ts/spec/blua32/execution_domain.ts:1–3`
and `machine/cpp/spec/blua32/execution_domain.h:7–9`.

| Offset | CPU/D consumption | BIOS cartridge consumption |
|---:|---|---|
| 00H | Unread | Magic must be58534d42H |
| 04H | Unread | Reported header size must be>=60 |
| 08H–1FH | Unread | Unread |
| 20H | u32LE ROM-relative image byte offset; zero=no image | Must be nonzero |
| 24H | Declared image byte count, unread | Unread |
| 28H | u32LE absolute startup-function-record address | Must be nonzero; supplied unchanged to EXEC |
| 2CH | u32LE absolute IRQ-function-record address | Unread |
| 30H | u32LE absolute exception-function-record address | Unread |
| 34H,38H | Declared token words, unread | Unread |

D returns no image for failed prefix binding or zero image offset. System-domain
resolution turns that absence into an error. D adds ROM base to image offset,
not to the three function addresses. B supplies declared locations; D supplies
the actual read/absence behavior. The BIOS scan samples presence, visits0 then1,
selects candidates and checks the four words above; it does not bind/check a
60-byte span itself: `machine/bios/main.lua:28–36,58–74`. At ready plus
boot_frame>=50 it masks IRQ and writes startup directly to `cop0.exec`:
`machine/bios/main.lua:105–113`. These are different admission boundaries.

## Image header activation

H declares96 bytes. A binds all96 but reads ONLY these six u32LE words:

| Image-relative offset | Actual meaning |
|---:|---|
| 18H | Absolute constant-table byte address |
| 1CH | Count of16-byte constant records |
| 20H | Absolute global-name-table byte address |
| 24H | Count of8-byte name records |
| 28H | Absolute system-global-name-table byte address |
| 2CH | Count of8-byte name records |

H also names magic32334C42H at00H, version1 at04H, bytecount/flags08H/0CH,
function table/count10H/14H, strings30H/34H, rodata38H/3CH,
DATA load/count/run40H/44H/48H, BSS4CH/50H, TEXT54H/58H and reserved5CH.
A does not read them. Their declaration names are not activation requirements,
section-order guarantees, function enumeration, text bounds or DATA/BSS work.

Table/string spans are bound to installed ROM with image-domain socket routing,
not constrained by the declared image bytecount: D and
`machine/ts/machine/memory/memory.ts:708–718` plus
`machine/cpp/machine/memory/memory.cpp:623–633`. Zero table count skips binding
(C/N); its address is unused. No image-base addition is applied to table fields.

## Constants, names and text

C: constant stride16 bytes; LE tag at+0. Tags0=nil,1=false,2=true consume no
payload. Tag3 reads binary64LE at+4..11. Tag4 reads absolute text address+4 and
encoded-byte count+8, both u32LE. Bytes12..15 are unread. Other tags fail the
activation path. Native binary64 decoder: `machine/cpp/common/endian.h:25–41`.

N: name stride8 bytes; absolute text address+0 and encoded-byte count+4, u32LE.
Image indices map to shared slots; ordinary/system maps are separate. Existing
names retain slots/values; new names begin nil. Names carry no initializer.

S reads exactly the supplied span, not NUL termination. Length0 yields empty
text without address dereference. Embedded zero bytes remain text. The public
layout specifies byte lengths, not an arbitrary-byte text-decoding policy. Do
not infer malformed or leading-BOM behavior from producer output (conflict below).

## Function and upvalue records

H declares function record32 bytes, alignment constant16. F reads fields LE at
absolute record address. It consumes code address+0, parameter count+8,
max-stack-slot count+12, flags+16, upvalue-table address+20 and count+24. Declared
code bytecount+4 and reserved+28 are unread; code bytecount is not a fetch bound.
Record decoding itself does not enforce the declared16-byte alignment.

Flags bit0=VARARG, bit1=STATIC (H/F). EXEC requires STATIC, clears prior frames
and enters with zero arguments (F). Instruction byte order is BE, unlike these
records: `machine/ts/spec/blua32/instruction_format.ts:44–70`,
`machine/cpp/spec/blua32/instruction_format.cpp:11–41` and TS fetch
`machine/ts/machine/cpu/cpu.ts:1271`. Existing CPU chapter owns instruction forms.

U: each descriptor is4 bytes LE at absolute table address+4i. Bit31 selects
parent-frame register capture; clear selects parent-closure upvalue. Low31 bits
are index. F/U use mapped-bus reads, not the ROM-only binding used by A/C/N/S.

## Editorial conflict stops

- Boot image-address arithmetic: D TS line94 retains a host sum while C++ line74
  assigns u32. With card base10000000H and raw offsetFFFFFFF0H, intermediate sums
  are10FFFFFF0H versus0FFFFFF0H. No downstream guest-visible divergence was
  established by this observation. Do not publish a common overflow rule or
  turn this into a new guest validation obligation.
- Text decoding: S TS uses fatal UTF-8 TextDecoder; native passes raw bytes to
  `StringPool::intern`, which copies/counts without matching validation:
  `machine/cpp/machine/cpu/string_pool.cpp:55–56,139–143` and
  `machine/cpp/common/utf8.h:27–38,45–52`. Malformed bytes are rejected in TS but
  retained in native; leading UTF-8 BOM behavior also differs. Do not publish a
  common arbitrary-byte contract or fix runtime as part of this documentation.

No runtime/BIOS/compiler behavior changed. Current packaging writers may be
checked for conformance separately; their unused fields and section layout do
not become machine requirements merely because current tools emit them.

## BIOS link information and static placement boundary

The current system producer places DATA at DYNAMIC_RAM_BASE and BSS after DATA;
cartridge linking places DATA at imported cartridgeStaticRamBase and BSS after
DATA: `toolchain/ts/rompack/blua32_linker.ts:1099–1154`. This is linker layout
policy, not machine adjacency validation. A and the BIOS boot consumer above
neither allocate cartridge RAM nor compare DATA/BSS extents.

The BIOS header BSS-address/count fields are written from the same inputs used
for the import metadata's exclusive BSS end:
`toolchain/ts/rompack/blua32_linker.ts:874–880,1064–1078`. Thus they convey the
current firmware's declared occupied span, despite being unread by activation.
DATA copy/BSS clear remain emitted guest startup operations, not allocator
commands: `toolchain/ts/lua/compiler.ts:1505–1558,1561–1584` and linker address
relocation resolution `:353–369`.

The map's semantic fields (cartridgeStaticRamBase, functions[].path,
exportPathKey and absolute functionAddress) are owned by
`toolchain/ts/rompack/blua32_bios_imports.ts:4–28`. Build consumers read/decode the
matching sidecar: `scripts/rompacker/build.ts:60–76`, `compile.ts:98–104`.
Sidecar/embedded tooling-asset production: `scripts/rompacker/rombuilder.ts:1084–1105,1432–1442`.
Neither D nor BIOS scan implements a resident import-name lookup. Current
function-record ordering does not itself establish invariant machine vectors.
Imported calls resolve through CLOSURE relocations during linkage:
`toolchain/ts/rompack/blua32_linker.ts:660–673,832–837`.

The companion's direct shared-decoder command was executed against the current
debug BIOS sidecar. Its cartridgeStaticRamBase135290052 equals that ROM's
declared BSS address135004164 plus count285888. These are checked artifact
observations, not fixed addresses promised to every cartridge or BIOS build.
