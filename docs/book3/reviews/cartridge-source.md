# Cartridge chapter actual-source review

**Bounded PASS: no actual unsupported or mismatching public sentence, address, bit, reset, timing, fault, table or figure claim found in the reviewed scope.**

Reviewed on 2026-10-18 in `/home/boaz/BMSX`, HEAD `e0c77de6d9a1c1f4b4ef96084967d077b5b88718`. No repository files edited. `docs/book3/facts/cartridge.md` was used only as a source-location map, not as authority. Neither `docs/architecture.md` nor reference PDFs were read or used.

## Scope checked directly against live owners

- Chapter `docs/book3/cartridge.md:1-530`, including every table, all literal program/module/manifest listings and retained observations; figure `docs/book3/figures/cartridge-irq.svg:1-26`, including its description and visible labels/arrows.
- Composition, occupancy, independent optional devices, package bytes versus ROM declaration: paired manifest readers and host media producers; paired cartridge constructors. The aperture/capacity distinction is supported; the aperture table states address-window sizes, not installed storage sizes.
- Boot order/readiness/selection and execution-fetch isolation: `machine/bios/main.lua:28-35,58-73,105-112`; TS `machine/ts/machine/cpu/cpu.ts:1145-1156,1241-1294`; C++ `machine/cpp/machine/cpu/cpu.cpp:665-674,809-864`.
- Raw SELECT, computed STATUS, override isolation, absent-card accesses, reset and DREQ publication: paired cartridge controller owners and cartridge leaf constants. IO addresses were independently evaluated from both live leaf constant chains, yielding SELECT `08010420H`, STATUS `08010424H`, IRQ FLAGS/ACK/MASK `08000000H/04H/08H`, and DMA0 ports `0800000CH` through `08000020H`.
- Card ROM/RAM/MMIO windows, little-endian scalar/tail behavior, byte runs crossing windows, full-width RAM writes, MMIO read lanes/exact write offsets, ignored ROM/narrow-MMIO writes, zero provisioning versus retained RAM on reset: TS card `41-50,107-109,147-261,276-309`; C++ card `.h:42-48`, `.cpp:11-25,77-79,116-235,251-287`; paired memory-map/endian leaves.
- Mailbox word/bit/offset/reset semantics, repeated-trigger coalescing, local IRQ_ACK versus central ACK, pending independent of MASK and non-destructive FLAGS reads: complete paired mailbox owners, controller routing, paired central IRQ owners and corresponding cartridge/IO leaves. All seven rows of the two-latch sequence and the SVG agree with these owners.
- DMA selectors 7-10, endpoint-independent overrides, both request conditions, absent/no-mailbox levels, block snapshot/nonpreemption/service/count/completion, current SELECT at service for unoverridden endpoints: TS DMA `131-178,211-253,365-515` and C++ DMA `62-108,141-183,289-440`, with paired card/controller and bus-signal owners.
- Installed 33,868,800 Hz model and DMA coefficients traced through the ordinary Node/native installation paths. Paired mapped-region/timing owners classify card RAM and mailbox MMIO as Cartridge, charge `8N+4` per endpoint span, add two cartridge endpoints (`16N+8`), and restart setup at cartridge subwindow boundaries. All numeric table entries and `E63H` arithmetic agree. The four-word ROM(socket 0) to RAM(socket 1) admitted-block cost is 72 cycles; neither listing observations nor prose claim it as CPU-launch elapsed time.
- Installed-IO alignment/narrow access rules, CART_STATUS read-only fault, cartridge whole-access aperture admission and final addresses, no cartridge-wide word-alignment gate, deterministic absent/ROM/narrow-MMIO behavior, DMA progression through mapped faults and first-outstanding fault retention: paired Memory owners and IO leaves. Ordinary CPU LOAD/STORE and displacement forms were separately checked for pre-bus alignment and post-read fault checking before result commitment (TS CPU `2992-3153`; C++ dispatch `554-669`), so mapped read-zero is not misrepresented as successful ordinary CPU zero-load.
- YAML listings exactly equal their supplied `.rommanifest` files. The `results.lua` fence exactly equals the supplied module. Concatenating the three entry fences exactly equals `carts/cartridge_manual/cart.lua`. Retained observations were traced through the printed sequence and owner behavior; they also match `tests/carts/cartridge_manual/cartridge_manual_assert.lua:12-42`. The existing `/tmp/bmsx-cartridge-manual-guest.log` records that supplied case passed; this review did not rerun it or infer broad hardware conformance from it.

## Boundaries

This is a source consistency review, not complete runtime/native execution acceptance, physical-hardware validation, a measured DMA launch-latency result, an electrical/socket specification or an audit of all Memory/CPU behavior. Reusable capture-buffer topology is separately triaged; its API asymmetry was not promoted into any cartridge-visible semantic or treated as a failure without a demonstrated public consequence. No such consequence was found or claimed here.

Final chapter hash includes the root agent's notified keep-together markup-only update; literal listings were compared again afterward and remain exact. `git diff --check` completed successfully at review end. Other agents' unrelated worktree edits were left untouched.

## Reviewed file SHA-256 hashes

```text
9a9a10aa03da799e7b9c221088acf078bf8374f12b6cf60536d38c6664412030  docs/book3/cartridge.md
4a519a2a0ce2fca6fac9cb73c115d9349dbe06ccc56dc087d9baccccbb272307  docs/book3/figures/cartridge-irq.svg
8c8f84a41b74269d6cd70e06f87799086c4ada529e5bbf8b627ddd4895edfa96  machine/ts/spec/bmsx/cartridge.ts
0d221f86f0ee4de8c26512a3abcfde5bd7a5d9c8d6b9dc70fb600eb5bad408e6  machine/cpp/spec/bmsx/cartridge.h
816f059c9dbe4aa4942815d6d2acfc320ec3bc08e27d076021b3a44c745a00a6  machine/ts/spec/bmsx/memory_map.ts
06da6acf52cca2e228642d0d3a0de31b01230ffc6b9bc263f93c8bc306752b57  machine/cpp/spec/bmsx/memory_map.h
20319518e3435cd52c53a73b564a7f734084721417274066d40f274543c94a95  machine/ts/spec/bmsx/io.ts
a86450c9ad3db29b42080fb895b4fcf0733b368e553f9d26d1205aef5145a4c2  machine/cpp/spec/bmsx/io.h
a23d6ded3ab13785817be115d8add30cdbf67d52fcb33b934f674c2aeb26f2c2  machine/ts/spec/bmsx/model.ts
840bda9e6a9cd97f56c09341380e0f998277719e3365baf2a0d54402f476258f  machine/cpp/spec/bmsx/model.h
915b47b6272cf1673dbe6d999688ab566d3660fc320e8b76d9cde6afd606cf23  machine/ts/spec/blua32/memory_access_kind.ts
b10643e25eb0e17ddaab47ee1d60513f9d05eeadee88f3ccedb89ada271600c1  machine/cpp/spec/blua32/memory_access_kind.h
a8a86e11b469f68edfb5592963d6ed0e6b6c19a7fe4a247ae8e28ec35752e0dd  machine/ts/rompack/manifest.ts
1b8a9507812a5a1e6e0766e8f6fb747dac7eef19e3dbebdc930f20a09282bcdf  machine/cpp/rompack/manifest.cpp
eeb3b1b64f14b7155bc8dd6d42a31058a3318299326932d2a1e101be97b03894  hosts/common/cartridge_media.ts
d5d16219a7e3715a5110e8f12a870c8326d101cf50a24b45ba170b9e39e26c09  hosts/libretro/cartridge_media.cpp
d32e0d8bf940976fb745e2a7795eb5f6ff8db80393a5324e142c838274cd3821  machine/bios/main.lua
8cd47a10fc03af15cd83ade44cd19d489bc9930f27ed6adf03bd7686bf497d7e  machine/ts/machine/devices/cartridge/controller.ts
ad3be37c09ec1af98610bbc3587e78e82a19a6a8d5aabceaa0d28b7f2239cba3  machine/cpp/machine/devices/cartridge/controller.h
1f4af6a9b07d0f441fba7200cdd74a9a38d8f2bf3529e48907ac28b2412664a5  machine/cpp/machine/devices/cartridge/controller.cpp
bb70c1a2faf8d62bbff55f3484ac6471ec5e345f33e36d7399ea97292e7070eb  machine/ts/machine/devices/cartridge/card.ts
d571c5196fe53d08559b55cef8f84f4482e4085af47e2326e920a1650feaf33c  machine/cpp/machine/devices/cartridge/card.h
9221cbd52f167b6671ed52cfadf379a6b3c4411a3b8d4cac7ab947ca920b8146  machine/cpp/machine/devices/cartridge/card.cpp
adaa925c1f185c0f66f10f266c7df98be9200c9df21c653a19ec4bc07507bee0  machine/ts/machine/devices/cartridge/mailbox.ts
4f43766892a88004f8d009fa7185d2f3320e6bfc0dd754b81a4f88bd90fb01d3  machine/cpp/machine/devices/cartridge/mailbox.h
f4d3de8bb5fb0c9502e99893f5f3e9b532a4a2a1ef0033102abd63441eb5536f  machine/cpp/machine/devices/cartridge/mailbox.cpp
e8d451139af8dcd1355c6ad13a88896cc377bde71ef1a9cbcff7f5add16d9e68  machine/ts/machine/devices/irq/controller.ts
008227ebcdfa226de15b572c53b3733ff7de7cced124a6726220e391c50953c2  machine/cpp/machine/devices/irq/controller.cpp
cbc021d8307355d4cf0718bbc83756bccd77b4579b90520b54c13ebda72ae423  machine/ts/machine/devices/dma/controller.ts
6291e7768b1e20f547cc4840516913bc29ac426c1829ca922ef3187d5e7c6bf5  machine/cpp/machine/devices/dma/controller.cpp
1c20c933db94865182e8f590cb4953ac575e76ce4eb1c813afab73f253aed065  machine/ts/machine/memory/memory.ts
d485cbbdb063a1351f2d57e70457a2e553cb67c83150518e5f00f0a57a35bd97  machine/cpp/machine/memory/memory.h
8a57ccc60424c0b4f0014711353a97afbeabf400a4436b1db2c0c3a714a004f4  machine/cpp/machine/memory/memory.cpp
ad164b21e26dc1fbd19961321d7cf8eadd23da4c2d43f195fa75b17176edb10a  machine/ts/machine/memory/bus_signals.ts
b8b9f1e4a04b5119600b17049ce60dcd39c311cce8ae42e90c615f5c2ce5bda1  machine/cpp/machine/memory/bus_signals.h
e0968b94a62d8d38cd8d4563d7af6467c04ba3978f3ce8cfaf080832372b4b91  machine/ts/machine/cpu/cpu.ts
4fd9a24d035d671237bd68fa146e9fc7c2405268d838cca1aa8442398bc46f83  machine/cpp/machine/cpu/cpu.cpp
9fb0fb4d89ba40de5e48af23d315686a959f243db3ce0b5e9bf619ff239a6114  machine/cpp/machine/cpu/cpu_dispatch.inl
dcda32765c31da5ce42d92091035368d071401c698a47aa25bba829b909fa273  machine/ts/common/endian.ts
bae6cdb920df76dc65c7962483db98aed3caa7b904da61b24f757cbfa1e042d2  machine/cpp/common/endian.h
d35f9639654bc6f87fc2a7198f82a658fcded5f7475bfac9704f2b44be3e11c2  machine/ts/machine/machine.ts
099d29e3f674c0e23a97dc1c4892f8dc603ba0dfbbb42ec3c306518eb6483d62  machine/cpp/machine/machine.cpp
6225c1c5dacc0bd061d30adfd7636b4900d4346ee8c21679c849a6492a1c24d0  machine/ts/machine/runtime/runtime.ts
8567688be5302d24846155a3d5a91ffa1affffc1eadc993fc84a7483383daf63  machine/cpp/machine/runtime/runtime.cpp
bcf8d2f9e802f596ca88dd91614efc5d235131ff5c146aac93874355761dfac2  scripts/bootrom/platforms/node_entry.ts
4983c35b7bb2762dd53e3f8c9c36208590c787ecfbd3c740df3a771aafecf288  hosts/libretro/content.cpp
2d3cf43e256f7b460998c64fe45f6c46554daec85cb57870ada484bd2aeb89bb  carts/cartridge_manual/cart.lua
1ef3c8318084fcc2850d576ec61979f4af8483fa68836248f0c90d66fe2ad6da  carts/cartridge_manual/results.lua
327ba268a8ecb10d88edd843aa59e2105090e83eb840a7ad03c603cd55f9e632  carts/cartridge_manual/res/manifest/manifest.rommanifest
c523c85e1801a0e03adb7755dfb4233845e09c1a7a9e8f5faf21e4cb294bd778  carts/cartridge_manual_data/res/manifest/manifest.rommanifest
0737ad2d04789b0e91b6ed7d3d54cbacb39a9700df4f9f85c29d8810624078f8  tests/carts/cartridge_manual/cartridge_manual_assert.lua
```

## Final bounded delta review

**Delta PASS.** Final chapter RAM composition row (`docs/book3/cartridge.md:13`) says `Optional; 1–15,728,640 bytes in the card definition`. TS `machine/ts/rompack/manifest.ts:82-87` and C++ `machine/cpp/rompack/manifest.cpp:124-136` admit integer RAM bytes from 1 through CART_RAM_SIZE; paired definitions are `0x00f00000` = 15,728,640 (`machine/ts/spec/bmsx/memory_map.ts:16`, `machine/cpp/spec/bmsx/memory_map.h:22`). This row is supported. The notified word-space and keep-together markup changes add no technical claims; prior bounded acceptance otherwise stands.

Final chapter SHA-256: `95d027012ba873ab15c3f5b00c849a8267106d33fa9f3713c1b48c3088837e27`. This addendum supersedes the earlier chapter hash only; no full re-audit or repository edit performed.

## Executed programming and public reconstruction evidence

The separate [program review](cartridge-program.md) found no code/expectation
failure. Quality-enabled ordinary cartridge validation, data-only build and
the existing derived-image guest case pass. All retained assertions in
`two_sockets_local_edges_and_cross_socket_dma` pass, including both sockets'
RAM/IRQ states, raw selector/status, all four payload words, independent DMA
end addresses, DONE/count/masked pending, and zero bus fault. The unchanged
ordinary-ROM player route is separately executed with both cards/TTL2; its
normal exit is not payload proof. The public development guide explicitly
requires fresh card RAM, bootable slot0/data slot1 and both manifests/builds.

Ten existing focused TS card/controller/manifest tests, three current native
CTest suites and19 manual-publishing tests pass. These are owner/publishing
checks, not native execution of the full cartridge or a physical matrix.
Public-only reconstruction produces both modules and manifests with exact
byte identity to actual sources. No runtime/compiler/BIOS/publisher/CSS/helper
or new harness change was needed; one catalog-membership assertion extends
the existing publication test. Final `git diff --check` is recorded separately.

Ordinary artifact SHA256 values:
- Program ROM `cd4a649a8319c8b84cfca40bd3671869d4ab71b8b010b6cf86014b72602fe1c0`.
- Data card `e7bbf17daedd9e38577a4924c429622dbbcab50d36aaa7a2157436b7054bd508`.
- BIOS `01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664`.
- Node tooling `a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470`.

Before implementation, MAME's
[MSX HALNOTE cartridge owner](https://github.com/mamedev/mame/blob/master/src/devices/bus/msx/cart/halnote.cpp)
was studied for owned ROM/RAM mapping and reset separation, not foreign mapper
addresses, behavior or timing. This is editorial provenance, not chapter facts.
The known reusable cross-topology capture-storage API issue stays separately
recorded in the facts/follow-up; no normal cartridge-visible effect is proved.
Whole-console, full Book III/SDK/new-installation and portable-PDF navigation
acceptance remain open. This source pass does not erase those boundaries.

The [public-only reader](cartridge-reader.md) gives a bounded supplied-checkout
PASS without opening implementation, carts, tests/assertion, facts or reviews.
Root separately compared all four reconstructed artifacts with actual source
bytes: every comparison passed. The reader's document-only assessment and
root's execution/equality checks remain different evidence, not one inferred
from the other. No essential hidden programming step was found in this route.

## Memory-header link — bounded delta, 2026-10-18

The existing boot paragraph's visible text and all cartridge facts/programs
are unchanged. Its Memory link now targets the explicit `rom-header-fields`
anchor, whose new authoritative layout has a separate
[Memory source review](../../book1/reviews/memory-source.md). An independent
actual-source reviewer checked the new subsection and this target; no unsupported
sentence or dead source target was found. This is not a new cartridge runtime,
whole-boot, malformed-header or portable-PDF-navigation approval.
