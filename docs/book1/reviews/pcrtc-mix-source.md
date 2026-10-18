# PCRTC composition lesson: bounded acceptance

## Scope and authority

Section7 only: exact PMODE contrasts, constant versus source-sample RGB
coefficient, independent output alpha, one complete125-line BLua cartridge,
three unique actual output plates and the linked ordinary development route.
Current paired software is authority. The [fact sheet](../facts/pcrtc-mix.md)
retains exact producer/consumer references and separates derivation from
execution. No architecture document or historical-console PDF supplied facts.
No runtime, BIOS, compiler, renderer, publisher, CSS, schema, helper or framework
was changed. Whole-volume and newcomer acceptance remain open.

## Actual ordinary execution

Root ran the ordinary headless-tooling product build, cart/BIOS export, supplied
guest and separate ordinary-ROM timeline. All pass. The guest checks four
complete mode words, three full C0 source words, unchanged configuration,
firmware exclusion, drained readback/GPU idle and fresh post-write callbacks.
It does not check composed RGB/alpha. Both sources remain immutable throughout;
no source reuse/release or multiword atomicity is assumed. Two extra callbacks
hold each early phase for viewing, not a latency guarantee.

Logs: `/tmp/bmsx-pcrtc-mix-product.log` and
`/tmp/bmsx-pcrtc-mix-{cart,guest,capture}-final.log`. The only initial clarification
was timeline B's wording: sample alpha0/128 selects coefficient0/255. There was
no runtime repair or failing program result. Additional regression evidence:
all78 tests in `tests/lua/gx_gpu.test.ts` pass, log
`/tmp/bmsx-pcrtc-mix-gpu-tests.log`; not substitute guest/image proof.

| Artifact | SHA-256 |
|---|---|
| Cart artifact | 5ffb7595ce8d128f84df568c565863d12074b893a3c887ae4bb56a61848f83f9 |
| Ordinary ROM | da9da422c171f2ff5c30ea7c9a73b675c4a966b33ba65a55302742f16fedcebc |
| Installed BIOS ROM | 01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664 |
| Headless-tooling product | a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470 |
| Entry module | 6ca04a347d49f98c089fb80fc24449878cfc1ed0b0063c2984f3abcb1161fc88 |
| Results module | 4b4a82e78a5a197f4d8b202d30dd52f7c7d2b2461a736339ea887ac7379640c9 |
| A PNG | efdead535f3bb164a434ea86557c3abc56eba5542d76ffdf87da9276788b5f11 |
| B/D PNG | 9d22f8c15b889f590ec3d708cd81a3f04d18aebde3f5330f95686db217323ab0 |
| C PNG | 0565a6db407569502c2f754353d82adb55570f8c2f5fef5e56ee98445a83328f |

## RGB plates versus actual output alpha

Root individually viewed all three unique native256×192 captures and checked
every49,152 RGBA pixels in each of four captures against the exact scene:
A uniform(128,0,127), B/D blue-left/red-right, C green-left/red-right, all PNG
alpha255. Public assets are unchanged copies. B/D are byte-identical; a fourth
image would not show AMOD. Record `/tmp/bmsx-pcrtc-mix-image-check.json`.

Separate actual Memory-MMIO → GPU VBlank publication → device output → production
software-render execution checks all196,608 raw RGBA pixels across four modes.
The fixture uses exactly the ordinary program's FA000/FA040 framebuffers,
pitch1024, zero relative origins, full256×192 windows, green background and
immutable raw001F/801F/FC00 source snapshot. All table rows pass, including
B-left output alpha0 versus D-left128. Existing screenshot encoding of each raw
result produces the ordinary capture hash. Evidence:
`/tmp/bmsx-pcrtc-alpha-replay.{ts,json}`, successful exact-geometry log
`/tmp/bmsx-pcrtc-alpha-replay-exact.log`. A preliminary pitch256 fixture was
corrected and rerun before acceptance; it is not program-specific evidence.

This executes actual owners/rendering, not copied blend arithmetic or a guest
composed-output register. It is not CPU guest execution in that scratch replay;
the ordinary cartridge execution above is separate. Opaque PNGs never establish
raw output alpha. No native, accelerated-backend matrix, physical timing/display
or fresh-OS/SDK acceptance is claimed.

## Separation of authorship and checking

Fresh paired-source extraction, two facts-only prose authors, actual-source
program review, ordinary execution/captures and raw-RGBA replay are distinct.
Before implementation, gsKit's basic example and PCSX2's merge organization
were inspected for source/draw/output ownership, not BMSX numbers or behavior;
links are retained in the companion README. Actual PDF acceptance is separate
in [pcrtc-print.md](pcrtc-print.md).


## Fresh public-only reconstruction

A fresh-context reader used only new Section7, its linked public development
subsection and the three PNGs. It reconstructed results.lua16 lines,
cart.lua109 lines from all five ordered fences, and the three-line manifest.
Root's `cmp` checks establish all three files byte-equal the executed originals;
no private producer or missing block was needed. No reader-blocking gap found.
The guide explicitly requires the supplied assertion/timeline from the checkout;
those are not presented as literal test sources supplied by this chapter.
This is not fresh-SDK installation or whole-book acceptance.

# PCRTC composition public-reader review

## Bounded result: PASS for complete cartridge reconstruction

The new Section 7 and its linked development-guide section provide a complete literal cartridge. I found no reader-blocking missing definition, path, ordering instruction, unit, or example-specific assumption needed to reconstruct its three authored files. No earlier example cartridge or reverse engineering is needed for that reconstruction.

Final layout-only recheck: the manifest definition now follows `results.lua` and precedes the entry declarations. All three file definitions remain explicit, and the instruction to concatenate the following five Lua blocks still applies unambiguously to the five entry-program blocks. Re-extraction from the final public text is byte-identical to the prior public-only extraction for all three files.

## Inputs reviewed

- `docs/book1/pcrtc.md:1611-1861` only: the `pcrtc-composition-output` anchor through EOF.
- `docs/programming/getting-started.md:1108-1146` only: “Build and inspect PCRTC composition”.
- `docs/book1/figures/pcrtc-mix-constant.png` — 256×192; visibly uniform purple.
- `docs/book1/figures/pcrtc-mix-source.png` — 256×192; visibly blue left/red right.
- `docs/book1/figures/pcrtc-mix-background.png` — 256×192; visibly green left/red right.

No implementation owners, specifications, historical references, tests, or private source were consulted. This is a finite lesson/readability review, not a runtime or compiler verdict.

## Literal extracted files

The output directory is `/tmp/bmsx-pcrtc-mix-reader-files/`, treated as the cartridge root. Every fence body's characters and blank lines were retained; the five `cart.lua` bodies were concatenated directly in the specified order, without adding code or separators.

| Extracted file | Lines | Bytes | Source body lines |
| --- | ---: | ---: | --- |
| `/tmp/bmsx-pcrtc-mix-reader-files/results.lua` | 16 | 284 | `docs/book1/pcrtc.md:1667-1682` |
| `/tmp/bmsx-pcrtc-mix-reader-files/cart.lua` | 109 | 3028 | `1706-1726`, `1738-1750`, `1762-1782`, `1794-1823`, `1835-1858` |
| `/tmp/bmsx-pcrtc-mix-reader-files/res/manifest/manifest.rommanifest` | 3 | 66 | `docs/book1/pcrtc.md:1692-1694` |

SHA-256:

- `results.lua`: `4b4a82e78a5a197f4d8b202d30dd52f7c7d2b2461a736339ea887ac7379640c9`
- `cart.lua`: `6ca04a347d49f98c089fb80fc24449878cfc1ed0b0063c2984f3abcb1161fc88`
- `res/manifest/manifest.rommanifest`: `b58cb84c13af5c365dea0336b081db3efc0b933252aa344acb3180a2d370d178`

The guide explicitly maps those files into `carts/pcrtc_mix_manual/`, names the build/run commands and outputs, and explains that the assertion observes registers/sources rather than composed output. The lesson supplies the source words, source placement/pitch units, PMODE sequence, expected RGB and independent output-alpha values. It also explicitly limits VBlank/hold timing claims and explains why the three RGB pictures cannot distinguish B from D.

## Limits, not findings

- The guide names supplied checkout assertion/timeline files under `tests/carts/pcrtc_mix_manual/`; their bodies are not part of this lesson. I did not inspect those files, verify their existence, reconstruct them, or run the test/demo commands. They are named external inputs to the inspection route, not missing cartridge definitions.
- Checkout/toolchain prerequisites are linked rather than repeated. This review does not claim a fresh installation works.
- The three PNGs were visually inspected and their dimensions checked; no claim is made that their opaque presentation proves output alpha.
- No compilation, runtime execution, hardware semantic validation, or repository edit was performed.


## Independent actual-source and image review

# PCRTC mix manual: independent finite source review

Completed against the live cartridge/assert/timeline and actual TS/C++ specs and GPU/PCRTC/IRQ/software-scanout owners on 2026-10-18. No repository edits; no architecture docs, historical PDFs or prior fact packets used. No concrete program defect found in this scope. The earlier ambiguous B timeline wording was corrected by the root agent to distinguish source alpha 0/128 from RGB coefficient 0/255.

## Completed source findings

- The mirrored PCRTC spec (`machine/{ts,cpp}/spec/gx/pcrtc.{ts,h}`) agrees: EN1/EN2 bits 0/1, MMOD bit5, AMOD bit6, SLBG bit7, ALP bits8..15. Four raw words decode to:

  | Phase | PMODE | MMOD | AMOD | SLBG | ALP |
  |---|---|---:|---:|---:|---:|
  | A | 0x8023 | 1 | 0 | 0 | 128 |
  | B | 0x8003 | 0 | 0 | 0 | 128 (not selected) |
  | C | 0x8083 | 0 | 0 | 1 | 128 (not selected) |
  | D | 0x8043 | 0 | 1 | 0 | 128 (not selected) |

- `DISPFB1=0x000fa000` / `DISPFB2=0x000fa040` decode in both PCRTC owners to PSM31/GX16, FBW16/pitch1024 words, FBP0/baseWord0 and FBP64/baseWord262144. Both high words are zero: source XY=(0,0), **relative to the respective framebuffer base**, not raw source-Y256. Circuit2 therefore reads raw rows256..447. Circuit1 reads rows0..191; sources do not overlap.
- Both DISPLAY low words `0x018252a8` give DX680,DY37,MAGH4,MAGV1. Both high words `0x000bf3ff` give DW1023,DH191. Reset timing signalStepX4 and progressive SMODE2 produce identical full 256x192 windows, source phase0 and linear GX16 sampling. No crop/window mismatch between phases. Background `0x0000ff00` is green.
- GP0 source production is real untextured variable-size rectangle work (`0x60`), not fill/readback fabrication. E1=0x400 permits drawing displayed fields; E2 is zero; E3/E4 clip exactly to the appropriate source. E5 is initially zero and later Y+256. E6=0 writes red0x001f in x0..127; E6=1 writes red0x801f in x128..255. The unchanged E6=1 then writes blue0xfc00 in x0..255/rawY256..447. Mask-before-draw remains clear, so existing destination bit15 does not suppress these writes. The mirrored command/raster/VRAM datapaths agree on offset, color quantization and forced bit15.
- C0 probes are raw absolute positions (64,96),(192,96),(64,352), unaffected by E5. Mirrored readback activation and software readback use only C0 position, size and GP1 Y-address-extension state. Size0x00010001 means one pixel; `readWord()` starts from that pixel's 16 bits and adds a high pixel only if a second pixel exists. Therefore the **entire GPUREAD words**, not masked halves, are 0x0000001f,0x0000801f,0x0000fc00. The assertion compares complete words. Each transfer is consumed before the next; the port returns to IDLE. Final GPUSTAT checks require IDLE bit26 and no READY_TO_SEND_VRAM bit27.
- There are no GP0/source/window/framebuffer/background changes after the three probes. Only PMODE changes. Sources are not recycled between phases. Readback establishes initial representative pixels; source lifetime thereafter is a source/control-flow finding, not a second post-phase pixel readback test.
- Each phase masks IRQ delivery, writes PMODE, reads its **active** word, ACKs old VBlank, records sequence, unmasks VBlank only, and waits for a changed handler-owned sequence. Both runtime VBlank owners call `presentReadyFrameOnVblankEdge()` (which latches PCRTC words) **before** raising IRQ_VBLANK. Both IRQ owners retain masked pending flags and clear written ACK bits. Consequently a sequence advance after this ACK proves a post-programming publication edge; active-word readback alone does not. Two extra fresh edges hold phases A/B/C before advancing. The assert verifies four mode words, fresh sequences, hold gaps, all relevant active words and idle state.
- `gpu/system_vram_region` is the actual exported BIOS query, not a cart-local reservation constant. It bounds the terminal surface (`tty/layout`: x704,y720,width320,height240) and the actual packed system texture upload header (producer origin x768,y960). Thus both sources end below the reserved region regardless of packed texture height. Cart retains the query's two words; assert requires reserved top>=448 and size0x00fc0140. The exact size depends on the actual packed upload extent; its runtime confirmation belongs to the ordinary guest run, not this source-only audit.

## Owner-derived output (not PNG alpha evidence)

Actual software GX16 source-alpha is binary RGB selection: bit15 maps stored A to 0 or128; the general datapath saturates the doubled coefficient at255, and the GX16 specialization directly selects destination/source. **A1=128 selects full red, not half red.** Constant blend instead uses ALP128 with denominator255 and +127 rounding.

| Phase | Left RGB | Right RGB | Left output alpha | Right output alpha |
|---|---|---|---:|---:|
| A | (128,0,127) | (128,0,127) | 0 | 128 |
| B | (0,0,255) | (255,0,0) | 0 | 128 |
| C | (0,255,0) | (255,0,0) | 0 | 128 |
| D | (0,0,255) | (255,0,0) | 128 | 128 |

This follows the palette, selected composition paths and implementations in TS `render/backend/software/gx_gpu_scanout{,_palette,_specialized.generated}.ts` and C++ `gx_gpu_scanout{,_palette}.cpp`; their byte/packed-word output layouts differ but the channel values agree. B and D have identical visible RGB, with D changing output alpha only on the left. `hosts/node/headless/screenshot.ts::encodeScreenshotPng` explicitly overwrites every PNG alpha with255, so an ordinary PNG cannot establish AMOD output-alpha correctness.

## Limits

This was an actual-source review, not another build, guest execution, screenshot/capture inspection, command replay, native execution or backend matrix. Root owns those independent evidence streams. No fake guest readback register, runtime fix, compiler/general chapter audit, or broader runtime change is proposed. `git diff --check` passed at completion.

## Final public section and actual published images: follow-up

Completed failures-only review of the final new `docs/book1/pcrtc.md` Section7 at `pcrtc-composition-output`, including the small deletion of its redundant paragraph. **No factual, formula, table, code, caption or image failure found.** The section agrees with the paired source owners already inspected: constant coefficient128 versus saturating doubled source-alpha coefficient0/255; independently selected output alpha; B/D RGB equivalence; C/D changing two fields, not one; base-relative source(0,0), pitch1024 and circuit2 base0x40000; absolute C0 probes; query versus allocation/ownership; fresh publication without atomicity or fixed-latency claims. The text explicitly avoids treating C0 as composed-output readback or PNG opacity as output-alpha evidence.

Own observed evidence in this follow-up:

- Extracted all six Lua fences: complete `results.lua` and the five sequential `cart.lua` blocks match the canonical files after blank-line normalization only. The YAML fence matches the complete actual manifest. No missing setup dependency was introduced.
- Independently opened each **actual published file** using original-resolution `view_image`: A is uniform purple; B is a precise blue/red vertical split; C is a precise green/red vertical split.
- Independently decoded all three published PNGs using `pngjs`, required256x192 and checked **all49152 RGBA pixels per image** against exact scene expectations. Zero mismatches in every image. A has49152 pixels(128,0,127,255). B has24576 pixels(0,0,255,255) at x<128 and24576(255,0,0,255) at x>=128. C has24576 pixels(0,255,0,255) at x<128 and24576(255,0,0,255) at x>=128. Every PNG alpha byte is255; these image checks deliberately prove no hardware/output-alpha claim.
- Exact PNG SHA256 values: constant=`efdead535f3bb164a434ea86557c3abc56eba5542d76ffdf87da9276788b5f11`; source=`9d22f8c15b889f590ec3d708cd81a3f04d18aebde3f5330f95686db217323ab0`; background=`0565a6db407569502c2f754353d82adb55570f8c2f5fef5e56ee98445a83328f`.
- `git diff --check` passed again. No repository edits.

Evidence separation: the ordinary guest run, exact FA000/FA040/pitch1024/window018252A8/BF3FF raw-RGBA command replay and image provenance/capture run are root/replay-agent evidence, not executions performed by this reviewer. I independently checked actual public PNG contents, canonical code equivalence and owner-derived alpha semantics. I did not run or rely on the old pitch256/origin0 replay fixture. No native/backend-matrix or rendered-PDF acceptance claim is made here.
