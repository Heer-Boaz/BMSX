# GTE cartridge example

This example runs projection, winding selection and vertex lighting, submits a
Gouraud triangle, and alternates two display buffers. It is a working example,
not a claim that the GTE programming chapter is complete.

## BLua interface

The entry uses the existing `cartlib/gx/gte` module. Its `data` and `control`
exports are addresses, consumed through explicitly typed BLua pointers:

```lua
local gte<const> = require('cartlib/gx/gte')
local control<const>: *word[32] = gte.control

control[gte.control_ofx] = 128 << 16
```

`control` is not a Lua table. Word indexing addresses consecutive four-byte
registers, starting at index zero. This statement writes OFX at `0x08010324`.
The example uses the module's register names, command constants and shared signed
halfword packer; it does not define a second GTE ABI or a local encoding helper.

Word reads preserve raw bits. The NCLIP winding test therefore checks MAC0's
sign bit and excludes zero; comparing the raw word with `> 0` would also accept
a negative signed result such as `0xfffff000`. The chosen triangle does not
overflow MAC0; arbitrary geometry also needs the overflow qualification.

The rotation, light and color matrices are Q12 identity matrices. Geometry uses
integer positions and SF=1. The three lighting vectors are deliberately supplied
orthogonal vertex directions, not normals derived from the triangle's positions.
They demonstrate independent vertex colors, not a physically smooth triangle.

The first projected triangle is `(96,64)`, `(160,64)`, `(128,128)`; translation
later moves it sixteen screen units right. NCCT produces RGB FIFO words
`0x000000a0`, `0x00008000`, `0x00400000`. The GPU interpolates those vertex colors.

## Run

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- gte_manual --debug
npm run headless:test -- gte_manual tests/carts/gte_manual/gte_manual_assert.lua
```

The integration case checks arithmetic and framebuffer changes and captures the
initial and translated images. Capture files are written under
`tests/carts/gte_manual/screenshots/`. This is guest execution in the headless
machine; it is not evidence of native-runtime or physical hardware execution.

The display loop waits for the GPU to finish, programs the next framebuffer,
then observes a later VBlank interrupt before reusing the previous buffer.
A VBlank between programming and reading the sequence counter can add a refresh
of waiting; the sequence counter must not be sampled before those display writes.
