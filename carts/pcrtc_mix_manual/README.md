# PCRTC coefficient, source alpha and background

One genuine BLua setup draws two immutable GX16 sources and changes only the
complete PMODE word across four phases. Circuit1 is red in both128-pixel halves,
but its stored bit15 is0 on the left and1 on the right. Circuit2 is blue. The
background is green. Both reading circuits cover the same256×192 output window.

| Phase | PMODE | Left RGB | Right RGB | Output alpha left/right |
|---|---|---|---|---|
| A | 8023 | 128,0,127 | 128,0,127 | 0 /128 |
| B | 8003 | 0,0,255 | 255,0,0 | 0 /128 |
| C | 8083 | 0,255,0 | 255,0,0 | 0 /128 |
| D | 8043 | 0,0,255 | 255,0,0 | 128 /128 |

Compare A/B for MMOD, B/C for SLBG and B/D for AMOD. Moving from C to D also
restores SLBG=0; it is not a single-bit adjacent comparison. ALP stays128.
GX16 sample alpha128 maps to RGB coefficient255 under source-alpha mode, not
half coverage. In constant mode, source alpha0 does not suppress the red RGB.
Output alpha is independently selected; the PNGs cannot demonstrate it.

Raw source probes001F/801F/FC00, source words/windows/background and fresh
callback sequences are asserted by the ordinary guest. C0 is raw VRAM readback,
not composed-output readback. After all sources are drawn, drained and idle,
they are never rewritten or recycled. Masked publication, stale acknowledgement
and fresh-after-write callback observations are explicit, not atomic/release
or fixed-latency promises. The firmware reservation query is not an allocator.

With supplied tests and timeline present, run from the repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- pcrtc_mix_manual --debug
npm run headless:test -- pcrtc_mix_manual tests/carts/pcrtc_mix_manual/pcrtc_mix_manual_assert.lua
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/pcrtc_mix_manual/pcrtc_mix_manual_demo.json pcrtc_mix_manual
```

Ordinary native-resolution 256 × 192 frames1/4/7/10 provide real images. All49,152 pixels in
each are checked. D is byte-identical to B as an opaque capture, so the manual
publishes only A/B/C rather than duplicating a picture. Actual owner/render
replay separately checks all raw output RGBA channels; this is not an invented
guest readback register or a claim that capture alpha equals output alpha.
No native/backend/physical-display or fresh-OS installation acceptance follows.

Before implementation, production
[gsKit basic](https://github.com/ps2dev/gsKit/blob/master/examples/basic/basic.c)
and [PCSX2's merge organization](https://github.com/PCSX2/pcsx2/blob/master/pcsx2/GS/Renderers/Common/GSRenderer.cpp)
were inspected for authored source/draw work separated from output composition.
They supply no BMSX address, numerical coefficient or hardware behavior.
Current paired BMSX software is authority; no runtime/compiler/BIOS/renderer,
publisher/CSS/schema/framework, ABI helper or capture path is changed here.
