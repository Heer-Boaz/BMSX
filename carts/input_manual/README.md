# Raw input-controller example

This ordinary BLua cartridge owns the ICU sample latch and the central VBlank
interrupt route. It arms one sample, waits for the sample sequence to change,
copies the retained keyboard/pointer/pad words, then derives press/release
edges for keyboard HID usage 04H from successive levels. It does not re-arm
while reading that snapshot. The next iteration requests the next sample.

The 25-line `results.lua` declares a 204-byte BSS result record; `cart.lua` is
the complete 62-line entry. Raw coordinates/axes remain raw words, not a claim
that every pointer attachment uses display-pixel coordinates. This example
does not use the higher-level cartlib action mapper or configure vibration,
rendering, DMA, CP0 or a supervisor handler.

## Build and observe

From the repository root with the normal development dependencies installed:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- input_manual --debug
npm run headless:test -- input_manual tests/carts/input_manual/input_manual_assert.lua
```

The build prepares the matching BIOS automatically. Expect:

```text
[test] latched_levels_and_software_edges: passed
```

The integration case starts with no keys/pad buttons held. It verifies the
initial copied raw snapshot, holds keyboard `KeyA` across multiple samples,
presses/releases first-pad A separately, then releases the key. Keyboard
transitions each increment their counter once; the retained transition mask
is `00000010H`, while pad A uses bit 0 of its own buttons word.

The suite uses case-owned input delivered through the normal ICU; it does not
write sampled registers or force the arm latch. Its derived integration image
contains the ordinary entry plus the assertion fixture, not byte-identical
ordinary-ROM playback. These checks establish the retained observations in
this headless route, not native cartridge execution, actual peripheral timing,
pointer coordinate calibration or a physical vibration effect.
