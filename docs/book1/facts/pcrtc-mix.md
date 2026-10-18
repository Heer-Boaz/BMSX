# PCRTC composition: finite paired-source fact sheet
The paired-source results below are mathematical derivations; separate actual execution observations follow. No architecture document, reference PDF, renderer repair, or physical-clock claim used.
## Paired source key (repository-relative paths)
- ST=`machine/ts/spec/gx/pcrtc.ts`; SC=`machine/cpp/spec/gx/pcrtc.h`.
- PT=`machine/ts/machine/devices/gx/gpu_pcrtc.ts`; PC=`machine/cpp/machine/devices/gx/gpu_pcrtc.cpp`; PH=`machine/cpp/machine/devices/gx/gpu_pcrtc.h`.
- GT=`machine/ts/machine/devices/gx/gpu.ts`; GC=`machine/cpp/machine/devices/gx/gpu.cpp`.
- RT=`machine/ts/render/backend/software/gx_gpu_scanout.ts`; RS=`machine/ts/render/backend/software/gx_gpu_scanout_specialized.generated.ts`; RC=`machine/cpp/render/backend/software/gx_gpu_scanout.cpp`.
- LT=`machine/ts/render/backend/software/gx_gpu_scanout_palette.ts`; LC=`machine/cpp/render/backend/software/gx_gpu_scanout_palette.cpp`.
- VT=`machine/ts/render/backend/software/gx_gpu_vram.ts`; VC=`machine/cpp/render/backend/software/gx_gpu_vram.h`.
## Register/representation facts
- PMODE_LOW index 0; PMODE_HIGH index 1. Use `gxGpuPcrtcRegisterAddress(0/1)`; ST:12–13,100–104 and SC:13–14,94–98 are the paired BMSX address mapping, not inherited Sony addresses. Numeric base literals are imported from IO spec and were outside this packet's leaf-only scope.
- LOW: EN1 bit0, EN2 bit1, MMOD bit5, AMOD bit6, SLBG bit7, ALP bits8–15; ALP decode masks 0xff. ST:39–47 / SC:40–48; PT:448–449,479–481 / PC:204–205,233–235.
- Both PMODE words are full raw 32-bit R/W configuration words, reset 0. TypeScript retains programmed/presentation Uint32Arrays; C++ retains paired std::array<u32,22>. Unknown/unused bits survive readback, with no PMODE datapath use beyond listed fields. ST:75–77 / SC:69–71; PT:539–541,560–562,580–599 / PH:185–187, PC:305–307,325–343.
- A changed PMODE write updates programmed readback immediately and marks presentation dirty; PMODE is not a beam-timing word and does not restart beam. PT:223–227,580–599 / PC:58–62,325–343.
- Ordinary VBlank presentation copies programmed words to retained words and publishes decoded scanout. Reset installs both banks and publishes immediately. PT:560–571,723–730,825–827 / PC:305–316,446–453,548–550; VBlank caller GT:1493–1500 / GC:975–982. This is not a claim that restore/context paths cannot publish.
## Datapath facts
- Composition order is background, circuit 2, circuit 1; BGCOLOR RGB is low24 bits, background alpha zero. RT:13–24,35–44 / RC:95–117,185–210; PT:448 / PC:204.
- MMOD=0 selects circuit-1 source-sample coefficient; MMOD=1 selects ALP constant. Constant ALP255 bypasses RGB blending; ALP0 leaves destination RGB while AMOD0 still writes circuit-1 sample alpha. PT:492–509 / PC:246–263.
- Software blend per channel: `Q=(S*k+D*(255-k)+127) div 255` (nonnegative integer division). Thus denominator255, multiply/add first, +127 before division, no post-blend clamp needed for byte S,D,k. RS:38–43 / RC:99–104.
- Source mode coefficient is `k=min(2*a1,255)`, not a1/255 and not ALP. Source-alpha saturation occurs before the RGB equation. RS:1328–1332 / RC:244–251. Linear GX16 specializes this to source-or-destination selection. RS:224–229 / RC:156–165.
- GX16 word bits0–4=R5,5–9=G5,10–14=B5; expand channel `(v<<3)|(v>>2)`. Bit15 supplies sample alpha 0x80 if set, 0 if clear, not 255. LT:5–11 / LC:7–13; VT:21–23 / VC:33–35.
- AMOD=0: circuit2 supplies RGB only; circuit1 writes its original sample alpha, independently of constant/source coefficient. AMOD=1: circuit2 supplies RGBA; circuit1 changes RGB only, preserving destination alpha. PT:482–509 / PC:236–263; RS:224–229,255–258,284–290 / RC:139–165.
- SLBG=0 permits circuit2 RGB; SLBG=1 suppresses circuit2 RGB, so background remains the RGB destination. With AMOD1, circuit2 may still supply alpha. PT:482–490 / PC:236–244. This selector does not disable either reading circuit or alter window geometry.
## Controlled 256x192 candidates (all PMODE_HIGH=0)
- Both reading windows cover the same full 256x192 output; no window/source/timing changes between plates. Exact optional geometry from reset: DISPLAY1/2_LOW=0x018252A8, HIGH=0x000BF3FF, SMODE2_LOW=0; reset signal step4 and magnification4 give 1024/4=256 by192. ST:80–90 / SC:74–84; PT:230,379–382,426–437 / PC:140–143,184–193; PH:104.
- Immutable source1: GX16 red0x001F left128 columns, red0x801F right128 columns. Immutable source2: GX16 blue0xFC00 throughout. BG=0x0000FF00 (green). Color/sample-alpha deductions use LT:5–11 / LC:7–13, VT:21–23 / VC:33–35; composition uses facts above.
- A `PMODE_LOW=0x00008023`: EN1=EN2=1, MMOD1, AMOD0, SLBG0, ALP128. RGB everywhere `(128,0,127)` because `(255*128+127) div255=128`, `(255*127+127) div255=127`; output a left0/right128. Source1 bit15 does not control the constant RGB coefficient.
- B `PMODE_LOW=0x00008003`: only MMOD changes to0; stored ALP128 is ignored. Left a1=0 ->k0 ->blue `(0,0,255)`, output a0. Right a1=128 ->k255 ->red `(255,0,0)`, output a128. The raw sample alpha128 is not half strength.
- C `PMODE_LOW=0x00008083`: B plus SLBG1. Left RGB becomes background green `(0,255,0)`, a0; right stays red `(255,0,0)`, a128. Circuit2 remains enabled but supplies no RGB.
- D `PMODE_LOW=0x00008043`: B plus AMOD1. RGB remains blue-left/red-right; output a128 throughout from circuit2's 0xFC00 sample. Not evidence obtainable by merely reading PNG transparency.
- A–D words/results are direct mathematical evaluations of ST:39–47 / SC:40–48; PT:448–509 / PC:204–263; RS:38–43,224–229,284–290 / RC:99–104,139–165,185–210.
## Finite finding/stop boundary
No contradiction found between inspected PMODE leaf constants and paired PCRTC/software owners. No other backend parity claim made. Stop names if future evidence conflicts: `PMODE-WORD-LAYOUT`, `PMODE-PUBLISH-BOUNDARY`, `PMODE-COEFFICIENT-ARITHMETIC`, `PMODE-RESULT-ALPHA`; report the precise owner/spec disagreement instead of repairing runtime in the lesson slice.


## Executed ordinary cartridge

- Actual source: `carts/pcrtc_mix_manual/cart.lua:1–109`,
  `results.lua:1–16`; six public Lua fences contain the complete125 lines.
  Manifest: `res/manifest/manifest.rommanifest:1–3` under the same cart.
- Both source origins stay zero. Framebuffer words000FA000/000FA040 select
  pitch1024, bases0/40000H and raw rows0–191/256–447. Windows stay
  018252A8/000BF3FF; background stays0000FF00. The program changes only PMODE
  after its initial draws/readback/idle: `cart.lua:35–109`.
- GP0(E6) controls the bit15 written by actual opaque60H rectangles:001F and
  801F in circuit1, FC00 in circuit2. Full-word C0 probes at raw(64,96),
  (192,96),(64,352) recover0000001F/0000801F/0000FC00, including zero upper
  halves; C0 coordinates are absolute, not E5-relative: `cart.lua:24–26,50–84`.
  Source readback does not sample composed RGB or output alpha.
- Actual firmware reservation query, not a local allocator:
  `machine/bios/gpu/system_vram_region.lua:5–28`. The supplied guest verifies
  reserved top>=448 and packed size00FC0140 separately from source ownership:
  `tests/carts/pcrtc_mix_manual/pcrtc_mix_manual_assert.lua:40–43`.
- Mask/write/readback/ACK-old/sample-sequence/unmask/wait establishes a fresh
  post-write callback for each phase. Two extra increments hold A/B/C for
  viewing, not a minimum latency. Sources are never rewritten/recycled:
  `cart.lua:28–33,86–109`. Paired event ordering: GT:1493–1500 / GC:975–982;
  paired IRQ acknowledgement: `machine/ts/machine/devices/irq/controller.ts:107–115`,
  `machine/cpp/machine/devices/irq/controller.cpp:76–84`.
- Ordinary supplied guest case `composition_words_and_source_lifetime` passes
  all four words, three complete source words, retained configurations, idle,
  firmware exclusion and fresh sequences; assertion source as above:18–48.
  This is not composed-output proof. Build/guest/capture logs and artifact
  identities are retained in [the bounded review](../reviews/pcrtc-mix-source.md).
- Ordinary ROM captures at frames1/4/7/10 match the four derived RGB scenes
  above at every49,152 pixels per image. The three public PNGs are unchanged
  copies of A/B/C; D is byte-identical to B. Timeline source:
  `tests/carts/pcrtc_mix_manual/pcrtc_mix_manual_demo.json:1–6`. The capture
  producer explicitly sets alpha255:
  `hosts/node/headless/screenshot.ts:10–15`; PNG alpha is not output alpha.

## Separate actual raw-RGBA observation

- Actual Memory mapped writes → Machine GPU VBlank presentation → device
  output → production `renderGxGpuSoftwareFrame` consume the exact ordinary
  cart's framebuffer/source/window/background words and immutable raw pixels.
  Producer boundaries are GT/PT above; renderer:
  `machine/ts/render/backend/software/gx_gpu.ts` and RT/RS above. The actual
  scratch run is `/tmp/bmsx-pcrtc-alpha-replay.ts`; successful exact-geometry
  log `/tmp/bmsx-pcrtc-alpha-replay-exact.log`, observed full RGBA bytes and
  decoded state `/tmp/bmsx-pcrtc-alpha-replay.json`.
- All196,608 output pixels across A/B/C/D match the derived RGB **and alpha**
  rows above. Both decoded pitches are1024, bases0/262144, origins0 and
  full output256×192. Raw VRAM snapshot hash remains unchanged across phases.
  This replaces the preliminary pitch256 fixture; that fixture is not used as
  program-specific evidence.
- Passing raw RGBA through the existing capture producer yields exactly the
  four ordinary capture hashes. B/D RGB matches while left output alpha
  differs0/128. No guest composed-output register, copied renderer arithmetic,
  CPU program execution in the scratch replay, native/accelerated-backend or
  physical-display conformance is claimed. Actual guest execution is separate.
