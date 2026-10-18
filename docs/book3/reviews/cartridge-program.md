# Cartridge manual program — independent bounded source review

## Result

**PASS for the reviewed program and guest expectations.** No unsupported address, bit, readback, IRQ rearm, transfer routing, RAM bound, or source-lifetime assumption was found in the five reviewed files. This is actual-source review, not execution evidence or whole-console parity approval.

## Crucial public recipe conditions

- The zero expectation at `tests/carts/cartridge_manual/cartridge_manual_assert.lua:39–40` requires fresh card RAM: the program reads slot0 RAM bytes16..31 without first initializing them (`carts/cartridge_manual/cart.lua:91–95`). Fresh allocation is zeroed (`machine/ts/machine/devices/cartridge/card.ts:41–48`; `machine/cpp/machine/devices/cartridge/card.h:42–45`), whereas reset only resets the mailbox (`machine/ts/machine/devices/cartridge/card.ts:107–109`; `machine/cpp/machine/devices/cartridge/card.cpp:77–79`). State in the public recipe that the ordinary command starts a fresh machine. Do not describe untouched RAM as reset-cleared or promise the same zero after a warm rerun.
- Keep the program package in physical slot0 and the data package in physical slot1. `scripts/bootrom/platforms/node_tooling_entry.ts:96–106` loads the positional cartridge into slot0 and `--slot1` into slot1; `scripts/bootrom/platforms/hostrunner/test_runner.ts:19–22` looks up the guest test only in domain0. The provided command has the correct placement. Both manifests and both builds must accompany the public recipe; a lone `cart.lua` is not the entire lesson.

## Bounded checks

- `E63H = ((4−1)<<10) | (9<<6) | (8<<2) | 3`: four-word block, slot0 READ request, slot1 WRITE request, both address increments. Mirrored constants: `machine/ts/spec/bmsx/io.ts:374–397`; `machine/cpp/spec/bmsx/io.h:387–410`. Read and write request fields independently select bus signals: TS DMA controller `211–235,504–515`; C++ DMA controller `141–165,429–440`. DONE/count0/end-address and DMA0 pending expectations match TS `237–251,365–370` and C++ `167–181,289–294`.
- CPU execution fetch remains socket-bound after data SELECT1: TS CPU `1145–1155,1249–1252,1271–1290`; C++ CPU `665–673,816–822,838–860`. SELECT retains the high word bits while only bit0 selects the card: TS cartridge controller `80–85,228–240`; C++ controller header `29–34` and controller source `179–197`.
- Both local IRQ tests match mailbox trigger/action readback and false-to-true behavior: TS mailbox `58–90`; C++ mailbox `41–73`. Controller forwards slot-specific central IRQ bits: TS controller `178–187`; C++ controller `128–134`. Central ACK clears only central flags: TS IRQ controller `102–125`; C++ IRQ controller `72–93`.
- Both sentinels use card-RAM bytes0..3; destination uses bytes16..31 inside each manifest's 256 bytes. Full-width bounds: TS card `221–239`; C++ card `186–203`. Data-only card has no ROM backing: `hosts/common/cartridge_media.ts:14–34`; `hosts/libretro/cartridge_media.cpp:8–23`.
- The DMA source is static `rodata`, not a transient local buffer. `scripts/rompacker/rombuilder.ts:1149–1157` places the image at cartridge ROM base plus image offset; `toolchain/ts/rompack/blua32_linker.ts:368–369,840–856,956–958` resolves rodata addresses and installs their bytes into the ROM image. The program does not modify that backing before transfer completion.

Reviewed file SHA256 values:

```text
2d3cf43e256f7b460998c64fe45f6c46554daec85cb57870ada484bd2aeb89bb  carts/cartridge_manual/cart.lua
1ef3c8318084fcc2850d576ec61979f4af8483fa68836248f0c90d66fe2ad6da  carts/cartridge_manual/results.lua
327ba268a8ecb10d88edd843aa59e2105090e83eb840a7ad03c603cd55f9e632  carts/cartridge_manual/res/manifest/manifest.rommanifest
c523c85e1801a0e03adb7755dfb4233845e09c1a7a9e8f5faf21e4cb294bd778  carts/cartridge_manual_data/res/manifest/manifest.rommanifest
0737ad2d04789b0e91b6ed7d3d54cbacb39a9700df4f9f85c29d8810624078f8  tests/carts/cartridge_manual/cartridge_manual_assert.lua
```
