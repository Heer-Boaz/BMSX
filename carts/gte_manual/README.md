# GTE cartridge example

This cartridge projects a triangle, selects its winding, calculates three vertex
colors and draws into alternating display buffers. Geometry and lighting operands
are authored as fixed ROM data; they are not a list of register-setting calls.
This is one executable example, not completion of the GTE programming chapter.

## Follow the BIOS data model

The example follows existing firmware patterns:

- [`shell/commands.lua`](../../machine/bios/shell/commands.lua#L61-L78) declares
  fixed structs and named-field `rodata` records.
- [`tty/terminal.lua`](../../machine/bios/tty/terminal.lua#L41-L73) separates ROM
  constants from mutable `bss` state and command buffers.
- [`kernel/vblank.lua`](../../machine/bios/kernel/vblank.lua#L6-L23) keeps the
  interrupt-visible counter in explicit static storage.

The cart therefore declares its matrix rows, projection setup, positions and
lighting directions using those language facilities:

```lua
rodata triangle: gte_vector[3] = {
    { x = -64, y = -64, z = 512, pad = 0 },
    { x = 64, y = -64, z = 512, pad = 0 },
    { x = 0, y = 64, z = 512, pad = 0 },
}
```

These braces are compile-time initializers, not heap Lua table constructors.
`vblank_sequence`, `back_buffer` and `frame_number` are `bss` words, including the
counter shared by the interrupt handler and display loop.

As a structural comparison, the
[PSn00bSDK GTE example](https://github.com/Lameguy64/PSn00bSDK/blob/master/examples/graphics/gte/main.c)
also keeps matrices and vertex arrays as real operand data before programming
the geometry unit. Its API and hardware details are not a BMSX contract.

## Representation and transfer

The reusable operand layouts belong to
[`cartlib/gx/gte.lua`](../../cartlib/gx/gte.lua), alongside the existing GTE
addresses and command constants. Requiring that const module makes its prefixed
struct type names available to BLua type declarations; they are not runtime
objects or `gte.vector()` constructors.

| Type | Size | Byte layout |
|---|---|---|
| `gte_matrix` | 20 | Row-major `i16[3][3]` at 0; explicit halfword padding at 18 |
| `gte_vector` | 8 | X at 0, Y at 2, Z at 4, padding at 6, all halfwords |
| `gte_transform` | 32 | Rotation matrix at 0; three translation words at 20 |
| `gte_projection` | 20 | Offset X/Y, H, cue gain/offset at 0/4/8/12/16, each a complete word |

Matrix coefficients are integer Q12 values; identity is 4096 on the diagonal.
Translation and positions use integer coordinates. Projection offsets use
16 fractional bits; H is the unsigned projection numerator, here 256. The
normal vectors are deliberately supplied orthogonal lighting directions, not
normals calculated from the triangle's positions. They demonstrate independent
vertex colors rather than physically smooth shading of this planar triangle.

The compiler packs signed halfword initializers into the ROM bytes. Thus the
three negative position components above produce the six words
`ffc0ffc0 00000200 ffc00040 00000200 00400000 00000200`, without a local packing
function or per-frame conversions. GTE decodes those signed halves itself.

The hardware still receives actual register transactions. The example uses
whole-word views of the ROM operands and bounded loops to copy them into the
existing GTE register windows. Matrix/projection/light setup is copied once;
each frame transfers six position words and six lighting-direction words.
Only the changing X-translation register is updated separately. No halfword
store is sent to MMIO, and no facade hides which register window receives data.

Current BLua rejects whole-struct assignment and provides no source-level GTE
operand-load or general block-copy intrinsic. These loops are scalar word
loads/stores, **not** a claimed native block transfer. The existing
`STORE_MEM_WORDS` ISA forms do not make an unimplemented language construct
available to a cartridge.

## Result lifetime and display ownership

RTPT leaves the three screen pairs in the GTE history. The cart retains them in
ordinary scalar locals before loading lighting vectors into the same input
slots and issuing NCCT. RGB0–RGB2 then supply the three GPU vertex colors.

NCLIP's MAC0 is read as a raw word. Winding selection tests its sign bit and
excludes zero; `raw_area > 0` would wrongly accept a negative signed value such
as `0xfffff000`. The chosen geometry does not overflow MAC0; arbitrary geometry
also needs the overflow qualification.

The initial projected triangle is `(96,64)`, `(160,64)`, `(128,128)`. Every
32 loop iterations the X translation alternates between 0 and 32, moving it sixteen
screen units right. NCCT produces RGB words `000000a0`, `00008000`, `00400000`;
the GPU interpolates those colors.

The display loop waits for the GPU to finish, programs the next framebuffer,
then observes a later VBlank interrupt before reusing the previous buffer.
A VBlank between programming and sampling the sequence counter can add a
refresh of waiting. Sampling the counter before the display writes would not
provide the same buffer-lifetime guarantee.

## Validation and allocation evidence

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- gte_manual --debug
npm run headless:test -- gte_manual tests/carts/gte_manual/gte_manual_assert.lua
```

The guest suite checks imported type sizes/offsets, readonly initialization of
all three negative position components, packed matrix row order and signed
translation words. Its integration case checks projection/colors, alternating
framebuffers, translated coordinates and reversed-winding raw MAC0 readback.
It captures both displayed triangles under
`tests/carts/gte_manual/screenshots/`. This proves execution in the headless
machine, not native-runtime or physical hardware behavior.

An independent current `-O3` compile of this cart plus the central GTE module
emits **152 ROM operand bytes and 12 BSS bytes**. It emits no `NEWT`, `GETT` or
`SETT` instructions; all its memory instructions use whole-word access. Struct
declarations and ROM initializers add no runtime operand-table allocations, and
the frame loop creates no tables or closures. This does not claim that BIOS
startup or the complete machine allocates nothing.

The relevant compiler owners are
[`struct_types.ts`](../../toolchain/ts/lua/compiler/struct_types.ts#L44-L69)
for primitive widths/array strides,
[`compiler.ts`](../../toolchain/ts/lua/compiler.ts#L3720-L3815) for recursive
static serialization, and
[`compiler.ts`](../../toolchain/ts/lua/compiler.ts#L4982-L5022) and
[`emitMemoryStore`](../../toolchain/ts/lua/compiler.ts#L5235-L5245) for typed
addressing and direct memory-store emission. ROM records are padded to a
four-byte section boundary by
[`recordRodata`](../../toolchain/ts/lua/compiler.ts#L656-L665), so these operand
symbols are suitable for the word views used here. The central data types add
no runtime functions or additional allocation layer.
