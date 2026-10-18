# Cartridge public-only newcomer reconstruction review

## Verdict and scope

**Bounded PASS: no blocking reader gap found for this supplied-checkout two-card example.** An unfamiliar BMSX programmer can reconstruct the complete authored files, put them in the documented projects, build both cards, boot the program in socket 0 with the data card in socket 1, and run the existing named result assertion without reverse-engineering source, tests, or tools.

This is a document-only recoverability review, not successful build/run evidence, comparison with the repository's actual authored files, a complete SDK/manual review, or physical-hardware/native/bandwidth acceptance. I did not run the builds or inspect the assertion. The root reviewer must perform any actual-source byte comparison and execution separately.

## Read boundary

Read only:

- `docs/book3/cartridge.md` (the complete public chapter).
- `docs/programming/getting-started.md`: headings to find the matching subsection; prerequisites (lines 5–14); “Build and inspect two cartridge sockets” (line 1182 onward).
- Public chapters linked by the cartridge chapter, only to resolve relevant prerequisites: Memory startup, typed storage/address views, cartridge execution domains, and the short explanation of imported struct names; Interrupt controller delivery/HALT; DMA programming, fields, admission/service, ownership, faults, and timing.

No implementation, actual cart source, tests/assertion source, architecture document, fact/review files, PDFs, or other scratchfacts were read. No repository files were edited and no new harness was made.

## Literal reconstruction artifacts

The code-fence bodies from the cartridge chapter were extracted as bytes. `results.lua` is its one complete Lua listing; `cart.lua` is the direct concatenation, in order, of its three consecutive entry listings. Leading blank lines in continuation listings, tabs, casing, comments, and final newlines were retained. The two YAML bodies were copied without normalization.

All artifacts are in `/tmp/bmsx-cartridge-reader-files/`:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `results.lua` | 596 | `1ef3c8318084fcc2850d576ec61979f4af8483fa68836248f0c90d66fe2ad6da` |
| `cart.lua` | 3005 | `2d3cf43e256f7b460998c64fe45f6c46554daec85cb57870ada484bd2aeb89bb` |
| `slot0.rommanifest` | 119 | `327ba268a8ecb10d88edd843aa59e2105090e83eb840a7ad03c603cd55f9e632` |
| `slot1.rommanifest` | 105 | `c523c85e1801a0e03adb7755dfb4233845e09c1a7a9e8f5faf21e4cb294bd778` |

These hashes identify the recovered public text, not verified equality with actual cart files.

## Newcomer's concrete route

### File placement and media ownership

The companion gives every project-relative destination:

- `carts/cartridge_manual/cart.lua`: all three consecutive entry listings, beginning with `module<entry>`.
- `carts/cartridge_manual/results.lua`: the complete result module, project-relative import name `results`.
- `carts/cartridge_manual/res/manifest/manifest.rommanifest`: socket-0 manifest, with ROM, 256 RAM bytes and mailbox.
- `carts/cartridge_manual_data/res/manifest/manifest.rommanifest`: socket-1 manifest, with 256 RAM bytes and mailbox, **no ROM and no Lua entry**.

The separate data package's `.rom` filename does not install a ROM device. Neither socket occupancy nor the 15 MiB RAM aperture implies installed RAM capacity. The manifest's 256 bytes is the capacity declaration. No additional manifest setting, undocumented port binding, loader flag, module registration, or hand-authored ROM offset is needed in the documented route.

The supplied assertion is explicitly identified as `tests/carts/cartridge_manual/cartridge_manual_assert.lua`, to be present before the debug build. Its source is not needed to author or understand the ordinary two-module example and was not inspected.

### Prerequisites and build/check commands

The shared prerequisite section identifies a POSIX shell at the repository root, Node.js 22 or later, npm, repository development dependencies (`npm install -D`), and a working native `canvas` binding. It explicitly does not claim fresh dependency installation or every OS has been tested. That is an acceptance limitation, not a hidden example-specific prerequisite.

The documented command sequence is sufficient:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- cartridge_manual --debug
npm run build:toolchain:cart -- cartridge_manual_data --debug
npm run headless:test -- cartridge_manual \
  tests/carts/cartridge_manual/cartridge_manual_assert.lua \
  --slot1 dist/cartridge_manual_data.debug.rom
```

The first cartridge build resolves the matching BIOS automatically; the reader is told not to invent a separate BIOS build requirement. `cartridge_manual` remains the socket-0 program and `--slot1` installs the separately built data package in physical socket 1. The test route's socket-0 suite lookup is explicitly distinguished from BIOS's general first-ready-card scan: swapping arguments is not a supported way to test socket-1 boot here.

The exact success line is given:

```text
[test] two_sockets_local_edges_and_cross_socket_dma: passed
```

### Fresh provisioning is not warm reset

Both chapter and companion require fresh card RAM and identify the owned resources: DMA0, both mailboxes, central cartridge bits 9/10, and card-RAM bytes 0–31 in both sockets. No competing producer may use them during the sequence. Logical card reset retains card RAM; a warm reset or rerun cannot establish the untouched socket-0 destination's required initial zero words. The existing test command is explicitly documented as starting a fresh machine with fresh card RAM.

This is separate from generated startup clearing the program's declared main-RAM BSS. The result does not borrow an assumed free or reserved address.

## Understanding the declarations and payload

The complete chapter includes every `*word` port address, both module declarations, the static import, the result struct, BSS allocation, and the four-word RODATA payload. There is no need to discover these in implementation.

The linked Memory chapter supplies the relevant language/storage prerequisites:

- A static storage name denotes a linked byte address. `bss result: cartridge_manual_result` allocates writable main-RAM storage and generated startup zeroes it.
- The returned `{ result = result }` table exports that address, not a serialized hardware result. The entry's `: *cartridge_manual_result` annotation supplies the layout for field access. The imported struct name is available to that typed view without adding it to the returned table.
- `: *word` gives a typed address view; unary `*` reads/writes the addressed scalar. `<const>` freezes the local address binding, not the underlying port or memory.
- A word occupies four bytes. Typed indexing is zero-based and advances by the element size. Thus `card_ram[4 + index]` addresses byte offsets 16–28, and the final incrementing DMA destination is `30000020H`.
- `rodata seed: word[4]` encodes actual readonly image bytes, rather than constructing an ordinary runtime Lua table. Its storage name provides the actual linked source address; it is not a guessed offset. RODATA remains in the ROM image.

The exact payload and retained expected values are printed. The four socket-1 destination words must become `01234567 89ABCDEF 55AA33CC F00DCAFE`; the same offsets in socket 0 remain four zero words. The independently written RAM sentinels and the data-only card's zero ROM read make the per-card distinction observable.

## IRQ, DMA, access safety, and timing

The public text makes the program's intended protocol reconstructible:

- Raw `SELECT` retains `80000001H`; only bit 0 selects the ordinary socket. STATUS derives presence and selection (`00010003H`). SELECT is not an instruction-fetch/initialization handoff; execution remains bound to socket 0.
- Mailbox addresses, retained DATA/CONTROL, nonretained trigger bit, local pending latch, local IRQ_ACK action, word-store requirements, and central IRQ addresses/masks are given. CONTROL is a full replacement word, not an independent bit-set/clear operation.
- Central ACK clears only central pending; local IRQ_ACK rearms only the source. The chapter's trace and retained fields explain suppressed retrigger after central ACK alone and a fresh edge after local acknowledgement. Pending bits are neither counters nor remote-work completion protocols.
- IRQ delivery is deliberately masked, while raw pending/status is polled. The final HALT loop is parking after `completed = 1`, not an attempt to wait for a masked DMA interrupt to deliver. The linked IRQ chapter explicitly separates raw pending, CPU acceptance, HALT, and predicate completion.
- Mailbox CONTROL `2` asserts socket-0 READ and `4` asserts socket-1 WRITE. DMA source selector 8 and destination selector 9 independently override socket routing. `00000E63H` is fully derived in the chapter: increment both endpoints, read request 8, write request 9, four-word block. No FIFO occupancy or per-word request protocol is implied.
- DMA0 is programmed while owned/idle from fresh startup, receives count 4, START 1, and polls BUSY bit 0 until completion. DMA register addresses, count units, STATUS meanings, trigger behavior, and control fields are available in the linked DMA chapter. No callback/service setup is needed.
- Admission captures configuration, not source payload; service performs the mapped reads/writes and publishes final addresses/count. Both explicit endpoint overrides remain correct while CPU selection is 1. The ROM payload stays unchanged; destination data is read only after BUSY clears.
- Ordinary scalar alignment and mapped bus faults are explained. The listed ports/word accesses are aligned and destination range is wholly inside installed 256-byte card RAM. DMA DONE alone does not establish valid accesses; the documented supplied check additionally checks bus fault zero and actual destination words.
- The timing derivation is conditional and explicit: each cartridge endpoint costs `8N + 4`; two cartridge endpoints add, yielding `16N + 8 = 72` cycles for this four-word admitted block at 33,868,800 Hz. Card RAM/MMIO are not priced as main RAM. Region crossings, request waiting, contention, setup/polling, and software stores are separate. Neither retained observations nor the test line measures exact admission, CPU-to-completion elapsed time, IRQ entry latency, sustainable bandwidth, or physical electrical behavior.

## Derived guest result versus ordinary playback

The integration command builds a derived socket-0 image containing program and assertion while preserving the two media definitions. Its linked seed/result addresses may differ from the ordinary image; both depend on actual linked storage rather than a guessed numeric ROM address.

The companion separately documents ordinary playback:

```sh
npm run build:product:node-headless-player -- --debug
npm run headless:game -- cartridge_manual \
  --slot1 dist/cartridge_manual_data.debug.rom --ttl 2
```

That route yields loading/game-loop/TTL messages, not a printed payload, image, or value assertion. Normal player exit is not evidence that the retained words are correct. Unchanged display/silence is not evidence either. The named supplied integration case is the bounded result check.

## Missing information

**None necessary for the bounded reconstruction/build/socket-placement/existing-assertion route was found.** General language and hardware concepts used by the declarations can be resolved in the expressly linked public Memory/IRQ/DMA chapters. No hidden control word, ownership precondition, port address, manifest device, physical socket assignment, expected payload, test invocation, or warm-reset limitation had to be inferred from private sources.

Still unproved by this review: actual reconstructed-file equality with repository cart sources; tool availability and command success in this checkout; assertion execution; fresh OS installation; a complete SDK/debugger workflow; whole-manual correctness; native execution of the complete cartridge; and physical hardware or performance acceptance.
