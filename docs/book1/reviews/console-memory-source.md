# Memory overview source review

- Draft: `/tmp/bmsx-overview-memory-prose.md`
- Initial audited draft SHA-256: `af643822d58e05c231da325e441ecd3b5a0686a8831786afaba5a21b3136b829`
- Final targeted recheck SHA-256: `6a4ad8389e1552d05f4084f118c00ccf025f9b5d0c4ebd200187a3042c8e454a`
- Disposition: **bounded pass for the final draft**. The initial cartridge-span ambiguity below is resolved; the narrowed mapped-register/DMA-word statement is supported.
- Live checkout: `master`, `ce3ef5b8f`.
- Read-only source audit; no builds, tests, runtime changes, repository edits, architecture document, or PDFs. The facts sheet was used only as a source index.

## Initial concrete finding, resolved

Initial draft:

> “For a block whose endpoints each remain in a single region, this gives:”

followed by:

> “Cartridge to RAM | `8n + 4` cycles”

The preceding charge table calls the entire cartridge bus one **Region**. Remaining within that region kind is not a sufficient condition for the formula. Both mirrors split cartridge accounting at the ROM/RAM and RAM/MMIO window boundaries, even though the classifier returns `Cartridge` on both sides. The formula requires each endpoint to stay within one uninterrupted accounting span, not merely one region kind. This is a necessary qualification of the guard, not a new timing model.

Direct owner evidence:

- TS `machine/ts/machine/memory/memory.ts:725-735`: the cartridge bus is classified as `MemoryRegionKind.Cartridge` throughout its mapped extent.
- TS `machine/ts/machine/memory/memory.ts:747-750`:
  ```ts
  case MemoryRegionKind.Cartridge:
      boundary = addr < CART_ROM_END
          ? CART_ROM_END
          : addr < CART_RAM_END ? CART_RAM_END : CART_MMIO_END;
  ```
- C++ `machine/cpp/machine/memory/memory.cpp:642-652` and `664-667` mirror that classifier and those boundaries.
- TS `machine/ts/machine/devices/dma/controller.ts:434-457`: charges are combined per span; exhausting a read or write span recomputes the endpoint and sets its `RegionStart` to `true`, even if the recomputed kind is unchanged.
- C++ `machine/cpp/machine/devices/dma/controller.cpp:358-381` mirrors that rule.
- TS `machine/ts/machine/devices/dma/controller.ts:473-483`; C++ `machine/cpp/machine/devices/dma/controller.cpp:397-407`: each cartridge span start adds four setup cycles.

Concrete source-derived counterexample, not an executed benchmark: an admitted two-word block with incrementing source `0x2ffffffc` and incrementing destination `0x080c0000` stays on the cartridge bus and in main RAM. The source crosses `CART_ROM_END` after the first word, causing two one-word cartridge spans. Their charges are `12 + 12 = 24` cycles, not `8 * 2 + 4 = 20`. The destination's continuing RAM span does not repeat its setup. The initial guard therefore needed a qualification beyond the table's cartridge-bus kind. No other unsupported address, capacity, reservation, static-layout, representation, or behavior sentence was found within this bounded audit.

## Final targeted closure

The final draft now says:

> “For one uninterrupted classified span of `n` words, starting at its beginning”

and:

> “Cartridge ROM, RAM and MMIO boundaries start new spans even though all three use the cartridge charge.”

The example-table guard now expressly requires one uninterrupted classified span at each endpoint and excludes the named boundary crossings. Its setup explanation also excludes recharging merely because the other endpoint subdivides the span. These statements match the span boundaries and `RegionStart` transitions cited above. The initial finding is closed.

The final opening now says:

> “A mapped register or DMA transfer word is 32 bits, or four bytes.”

That scoped statement matches `IO_WORD_SIZE = 4` (TS `machine/ts/spec/bmsx/memory_map.ts:23`; C++ `machine/cpp/spec/bmsx/memory_map.h:29`), `Uint32Array` I/O slots (TS `machine/ts/machine/memory/memory.ts:139,162`), `u32` I/O values (C++ `machine/cpp/machine/memory/memory.cpp:245-255`), and DMA's `readMappedDmaU32LE` / `writeMappedDmaU32LE` transfers (TS DMA `controller.ts:220-235`; C++ DMA `controller.cpp:150-165`). This closure does not generalize the word size to GPU-local storage or guest Number values.

No unresolved concrete failure remains in this bounded source audit of the final hash.

## Inspected live source ranges

- Address and reservation constants: TS `machine/ts/spec/bmsx/memory_map.ts:1-33`; C++ `machine/cpp/spec/bmsx/memory_map.h:7-39`.
- Installed capacities and DMA coefficients: TS `machine/ts/spec/bmsx/model.ts:7-12,27-57`; C++ `machine/cpp/spec/bmsx/model.h:12-17,32-62`.
- Installed-model selection and forwarding: `hosts/browser/boot.ts:106-122`; `hosts/browser/player.ts:30-47`; `hosts/common/machine_runtime.ts:13-26`; `machine/ts/machine/runtime/runtime.ts:119-142`; `hosts/libretro/content.cpp:32-53`; `machine/cpp/machine/runtime/options.h:14-18`; `machine/cpp/machine/runtime/runtime.cpp:8-24`.
- I/O producer chain and DMA block fields: TS `machine/ts/spec/bmsx/io.ts:1-160,374-382`; C++ `machine/cpp/spec/bmsx/io.h:15-173,387-395`. Independent arithmetic over each live constant chain gives 16,656 slots, 66,624 bytes, end `0x08010440`.
- Memory storage/routing/classification: TS `machine/ts/machine/memory/memory.ts:120-178,313-428,544-570,627-656,721-775,836-845`; C++ `machine/cpp/machine/memory/memory.cpp:46-99,228-296,434-460,522-550,642-692,725-727`; C++ `machine/cpp/machine/memory/memory.h:134-140`.
- Card capacities and selection: TS `machine/ts/spec/bmsx/cartridge.ts:1-15`; `machine/ts/machine/devices/cartridge/contracts.ts:1-10`; `card.ts:35-60,147-218`; `controller.ts:55-85,153-180`. C++ `machine/cpp/spec/bmsx/cartridge.h:7-18`; `machine/cpp/machine/devices/cartridge/contracts.h:13-22`; `card.cpp:11-24,116-203`; `controller.h:29-69`.
- Static placement and image payloads: `toolchain/ts/rompack/blua32_linker.ts:280-289,712-737,840-852,874-882,1064-1083,1099-1154`; mirrored descriptor offsets TS `machine/ts/spec/blua32/image_format.ts:19-27`, C++ `machine/cpp/spec/blua32/image_format.h:25-33`.
- CPU mapped-load/store route only: TS `machine/ts/machine/cpu/cpu.ts:3080-3143`; C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:621-665`.
- DMA timing wiring: TS `machine/ts/machine/machine.ts:98-105`; C++ `machine/cpp/machine/machine.cpp:41-48`.
- DMA admitted blocks, mapped transfer service, arbitration and charge calculation: TS `machine/ts/machine/devices/dma/controller.ts:131-168,211-253,386-485`; C++ `machine/cpp/machine/devices/dma/controller.cpp:65-98,141-183,310-409`.

This audit does not establish CPU bus latency, physical throughput, active GEO scratch allocation, exact linked-image footprints, whole-runtime parity, or any new timing claim.
