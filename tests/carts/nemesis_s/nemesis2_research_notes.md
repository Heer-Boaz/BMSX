# Nemesis 2 Research Notes (for `nemesis_s`)

## ROM provenance

- File used for byte-level analysis:
  - `.external/nemesis2rom/extracted/Nemesis2[File-Hunter.com].rom`
  - Size: `131072` bytes
  - SHA1: `d63e20369f98487767810a0c57603bef6a2a07e5`
  - MD5: `abbcfc00f71051434e0e82e29b6ea1ef`
- Important: this checksum does **not** match the checksum listed in FRS patch docs (`ab30cdea...` / `ee3e6a50...`), so this is likely a different dump/revision.

## Disassembly workflow

- Decoder: the Z80 decoder from the pinned `.external/py-msx-emulator`
  checkout (`c509f70076d5309dead6617362cb926014f53ff7`). The generic ROM-window,
  mapper-bank and byte-search primitives live in
  `scripts/research/msx/z80_rom.py`.
- Nemesis 2 address profile:
  - `scripts/nemesis_s/disassemble_nemesis2.py`
  - Run with: `python3 -m scripts.nemesis_s.disassemble_nemesis2`
- Entry disassembly output:
  - `.external/nemesis2rom/disasm_entry_0x4090.txt`
- Targeted segment disassembly output:
  - `.external/nemesis2rom/disasm_segments_candidate.txt`
- Mapper-aware stage-4 disassembly output:
  - `.external/nemesis2rom/disasm_stage4_banked.txt`
- SNSMAT call-site scan output:
  - `.external/nemesis2rom/snsmat_call_sites.txt`
- Mapper-window formula used by the stage-4 dump:
  - physical ROM offset = `bank * 0x2000 + (cpu_address & 0x1fff)`
- Runtime branch/state traces and screenshots use the same pinned emulator:
  - `scripts/nemesis_s/trace_nemesis2.py`
  - `python3 -m scripts.nemesis_s.trace_nemesis2 stage1_sodom`
  - `python3 -m scripts.nemesis_s.trace_nemesis2 stage4_ray_open`
  - `python3 -m scripts.nemesis_s.trace_nemesis2 stage4_ray_lifecycle`
  - `python3 -m scripts.nemesis_s.trace_nemesis2 stage4_volcano`
  - outputs are written below `.external/nemesis2rom/traces/` as compact JSON
    plus native `256x192` RGB24 PPM frames.
- The trace script retains the deterministic input route, stage-4 admission
  patch and trainer writes needed to reproduce the observations. Actor ids,
  RAM records and frame windows remain in that Nemesis-specific owner; the
  generic research modules contain no game addresses.
- Static operands and runtime transitions were compared before translating a
  cadence into cart code.

## Concrete findings reused in BMSX baseline

- Player/game-space geometry and movement constants were taken from the public `nemesis-s-bdx` source (used as controlled reference model):
  - `MetallionWidth=16`
  - `MetallionHeight=10`
  - `Player1StartPos=(80,60)`
  - `MetalionMovementSpeed=1`
  - `MetalionMovementSpeedIncrease=0.5`
  - `KogeltjeMovementSpeed=6`
  - `MaxProjectilesPerPlayerVessel=2`
  - `GameScreenWidth=256`
  - `GameScreenHeight=176`
  - `MSXScreenHeight=192`
- Input behavior reused from that model:
  - Fire on trigger (edge), not continuous hold.
  - Up sprite has priority over down sprite (`if up ... else if down ... else neutral`).

## Raw ROM observations

- Entry at `0x4090` initializes mapper and jumps into a long orchestrated update loop (`0x417F` onward in linear dump).
- Sequence around `0x781C` writes values including `0x50` and `0xA0` into state bytes (`EA99`/`EA9A` region in linear mapping), treated as initialization constants in runtime state.
- Input scan usage is visible via BIOS call `CALL 0x0141` (SNSMAT). Current dump contains call sites at:
  - `0x5930`, `0x5944`, `0x5A24`, `0x5A32`, `0x5D4A`, `0x5D57`, `0xBECF`
- Around `0x5D37`:
  - routine combines keyboard matrix scans (SNSMAT rows `4` and `8`) plus a PSG/joystick read helper (`0x5D72`, via BIOS `0x0093`/`0x0096`) into one packed input byte.
- Around `0x5928`:
  - routine checks row `6`, masks bit `0x20`, stores it in `E30A`, and compares with previous frame (`XOR` with old value). Carry is set only on edge transition, which is consistent with trigger-style (press-edge) behavior.
- Around `0x5A22` and `0x5A30`:
  - direct checks against SNSMAT row `7` bit `1` and row `8` bit `0` set state flags (`E22D`, `E22E`) when pressed.
- Around `0xBECA`:
  - debug/diagnostic input routine scans rows `0..7`, then maps first active bit to a character table (`"0123456789-^...A..Z"`), consistent with keyboard diagnostics.

## Scroll model constraint (important correction)

- MSX stage scrolling in this scope is treated as **tile-quantized**:
  - no per-frame fractional horizontal map shift,
  - foreground stage advances by 1 tile (`8px`) when the stage gate opens.
- Concrete ROM evidence:
  - `0x6941`: `LD (0xE202),A` with `A=1` initializes a rotating gate byte.
  - `0x485E..0x4866`: `RLCA` on `E202`, then `AND 1`; return when zero.
  - `0x4867..0x4868`: only when gate bit is `1`, `E203` is incremented by `1`.
  - Since `E202` starts at `1`, the `RLCA` sequence is `2,4,8,16,32,64,128,1`, so gate-open occurs every 8 updates in gated mode.
- Therefore, scroll cadence should be modeled as **frame/tick-gated**, not as a fixed millisecond timer constant.

The deterministic stage-1 route also establishes why the cart must not run the
gameplay schedule at its unconstrained nominal 25 Hz. On the Japanese MSX1
machine the original game admitted 174 top-level game passes over 500 VBlanks:
an average of 2.867 VBlanks per pass, or 20.93 Hz at 60 Hz. The same trace observed stage
tile advances at 20.73 pixels per second. The work spans multiple VBlanks; this
is CPU saturation in the original 3.58 MHz machine, not an authored delay in an
individual enemy.

The BMSX cart therefore accumulates virtual gameplay time at an exact `5/6`
rate while retaining its fixed two-VBlank, 40.192 ms simulation quantum. That
yields 20.73 admitted gameplay updates per second on the machine's 49.76 Hz
VBlank cadence. Frame-clock input, presentation and cinematics remain at their
existing cadence. Combined with the original eight-update `E202` gate,
foreground scrolling becomes 20.73 pixels per second without per-enemy speed
corrections or a millisecond scroll timer.

## Stage-4 ray chimney and cloud volcano

The relevant stage-4 actor code is mapped as bank `0x0b` in the CPU
`0xa000..0xbfff` window. Cloud vertical tracking jumps to bank `0x02` routine
`0x9b62`.

### Ray chimney (`0xBADC`, dispatcher `0xBB06`)

- `0xBAF1` admits the actor with an initial counter of `0x30` (48 actor
  updates).
- `0xBB25..0xBB2F` performs an unsigned horizontal player-window test equivalent
  to `player_x - chimney_x + 0x20 < 0x40`.
- The retained opening states increment and alternate the visual over the
  traced update sequence before `0xBB95` fires.
- `0xBBC2..0xBBC9` spawns actor type `0x41` and submits sound command `0x26`.
- `0xBB98` retains a six-update post-fire hold. The emitter then closes over
  three one-update visual steps and returns to its 32-update cooldown at
  `0xBBEF`.
- Ray lifetime is independent of the emitter. The emitter never waits for an
  actor-`0x41` completion callback.

Actor `0x41` was traced as one admitted tile followed by ten expansion updates
of four tiles each. Contraction removes four tiles per update from the emitter
side while retaining the far endpoint. A terrain hit clamps the visible length;
it does not shorten the ten-update expansion phase.

### Cloud volcano (`0xBE49`, dispatcher `0xBE62`)

- `0xBE59` admits the generator with an initial counter of `0x30` (48 actor
  updates).
- `0xBE86..0xBEA0` opens it over four actor updates and primes a five-cloud
  formation.
- `0xBEA1..0xBECF` spawns actor type `0x40` every eight updates, exactly five
  times, with sound command `0x15`. After the fifth cloud it retains the open
  visual for 64 updates and primes the next formation.
- The complete first-spawn-to-next-first-spawn period is 97 actor updates:
  spawn frames `0, 8, 16, 24, 32`, then the retained post-formation hold.
- `0xBEE6..0xBF08` selects rise counters `12, 16, 20, 24, 28` and writes raw
  vertical Q8.8 velocity `-0x0300`. At three pixels per actor update this gives
  rise distances `36, 48, 60, 72, 84` pixels; the generator emits them in the
  reverse formation order.
- `0xBF31` selects raw horizontal Q8.8 velocity `0x0280` toward the player.
- Bank-`0x02` routine `0x9B62` adds signed raw `0x0016` to vertical velocity
  toward the retained player Y each actor update.
- `0xBF47..0xBF5F` advances each cloud's own three-frame animation every four
  actor updates. It is not one global animation phase shared by all clouds.

## Stage-7 Abaddon movement and super laser

The Stage-7 second boss controller is mapped in bank `0x0b`; its retained
record occupies `EA00..EA1F`. The reusable trace profiles
`stage7_abaddon_controller` and `stage7_abaddon_ray` reproduce the forced-stage
route and record the controller and actor-`0x24` beam separately.

- `0xAEAA..0xAECE` decrements the beam cadence byte at `IX+18`, reloads it with
  `0x28`, and spawns actor type `0x24`. Consecutive beams are therefore admitted
  every 40 boss updates. Their source position is boss Y plus `0x30` and boss X
  minus `8`; sound command `0x18` is submitted at the same boundary.
- `0xAF20..0xAF35` admits one beam tile. `0xAF36..0xAF6F` then reads the boss Y
  every actor update, extends the beam eight pixels toward the left edge, and
  adds one tile. Once its X coordinate reaches zero, it retains the completed
  beam for 16 updates and disposes it; there is no contraction pass or
  completion callback to the boss.
- Movement segment setup chooses down when the boss is partly above the screen
  or its vertical center is above the primary player; otherwise it chooses up.
  It writes a counter of `8 + (R & 3)` and primes an eight-bit phase accumulator
  with `0xff`.
- The movement pass adds `0x46` to that accumulator. Only an overflow consumes
  the pre-decremented counter and advances the boss by eight pixels. The final
  counter transition does not move, so one segment contains 7..10 visible
  advances followed by a 16-update stationary pause.
- The controller reflects downward movement at Y `96` and upward movement at
  signed Y `-48`. Direction is selected toward the player only when the next
  segment begins, rather than continuously steering during a segment.
- Actor type `0x26` is the short-lived boss hit effect produced by the weapon
  collision routines. It is not part of the super-laser controller.

The BMSX Moon keeps its cart-owned art and other attacks. Its death-ray branch
translates the controller above: movement is a concurrent FSM region, waits are
timeline frame boundaries, and the ray remains an independent world object.

## Interpretation limits

- The ROM checksum above identifies the analyzed revision; another dump can
  contain different banks or operands.
- Stage-4 claims combine mapper-aware static disassembly with runtime ROM
  traces. BMSX headless assertions validate the translated cart behavior, not
  the source ROM interpretation by themselves.
- The custom XNA stage layout, art, multiplayer extensions and audio assets
  remain cart-owned where the original MSX game has no corresponding content.

## 50 Hz story presentation

- The story cadence was traced on a 50 Hz European MSX1 configuration using
  the European C-BIOS ROM
  (`cbios_main_msx1_eu.rom`, SHA1
  `baf2e9c69252fd9b350b488d89c71887b9d05eec`) and the cartridge checksum above.
- Successive visible panel starts occur at VBlanks `832`, `2089`, `2627`,
  `3107`, `3526`, `3893`, `4907`, `7008`, `8210`, and `9049`. The first nine
  source-panel intervals are consequently `1257`, `538`, `480`, `419`, `367`,
  `1014`, `2101`, `1202`, and `839` VBlanks. The cart deliberately omits the
  original title-card panel beginning at `9049`.
- Inside the Venom panel (relative to VBlank `3893`), the portrait begins at
  frame `126`, reaches its open pose at `158`, starts closing at `246`, and is
  closed at `310`. The vertical wipe spans frames `330..630`, the second text
  reveal spans `651..663`, the exit begins at `961`, and the panel is black at
  `1003` before the next visible panel starts at `1014`.
- The replacement portrait has six opening/closing positions and 106 wipe
  positions instead of the source image geometry. Those authored values are
  distributed over the observed VBlank spans; the runtime does not recreate
  the old XNA millisecond timers.

## Stage-1 Sodom steering

- The stage-1 flying-disc formation is actor type `0x09`. The visual identity
  matches Sodom, the Nemesis 2 flying-disc enemy; motion facts below come from
  the ROM trace and disassembly rather than from the enemy catalog.
- Initializer `0x9B4C` writes raw horizontal Q8.8 velocity `-0x0300` and zero
  vertical velocity. The four observed actors entered at X `248`; the actor
  table was already partially occupied, so this capture does not establish the
  formation's authored admission count.
- Update `0x9B59` falls through to `0x9B62`. It compares retained player Y at
  `E404` with actor Y at `IX+4`, selects signed raw acceleration `+/-0x0016`,
  and adds it to the actor's vertical velocity.
- The common actor pass then integrates both Q8.8 axes through `0x64E1` and
  `0x6509`. Horizontal speed stays at three pixels per admitted actor update;
  vertical motion continuously curves toward the player's current Y.
- `mijter_foe` retains its cart-owned red/blue art and red capsule drop, but its
  movement now follows this Sodom datapath instead of the unrelated XNA
  random-distance/dominant-axis attack.

## Stage data loading model

- `nemesis_s` now loads stage geometry from a ROM data asset instead of hardcoded Lua math:
  - asset file: `carts/nemesis_s/res/data/nemesis_s_stage.yaml`
  - source of map rows: `nemesis-s-bdx` `StageFactory.Stage0Map` (22 rows, 554 columns)
- Runtime loader:
  - `stage.lua` reads `assets.data['nemesis_s_stage']`
  - map symbols are converted to tile/collision tapes during cart boot/reset
- Scroll gate and tape-head progression stay tied to disassembly-derived behavior (`E202` rotate gate + `E203` increment), while stage layout source is externalized as data.

## Weapon-routine mapping used for current implementation

- Main loop call order (from `0x4245..0x425A`) confirms a dedicated weapon/collision pass block:
  - `CALL 0x90C6`
  - `CALL 0x9167`
  - `CALL 0x88A2`
  - `CALL 0x8A43`
  - `CALL 0x8DF9`
  - `CALL 0x8DB4`
  - `CALL 0x8E43`
  - `CALL 0x8D5E`
- Segment observations used directly:
  - `0x90C6`/`0x9167`: repeated overlap checks against active object tables (`E470` stride `0x10`) with per-hit side effects, consistent with weapon-hit/collision dispatch loops.
  - `0x88A2`: iterates `E600` entries (stride `0x40`) with `BIT 1,(IX+0x10)` gate and hitbox compare helper (`0x88CE`), matching conditional projectile-vs-target processing.
  - `0x8A43`: iterates `E500` entries (stride `0x10`) with target-table overlap checks (`IY=E470`), consistent with another weapon class collision pass.
  - `0x8DF9`/`0x8DB4`/`0x8E43`/`0x8D5E`: player-position-relative collision windows (`E404`/`E406`), entity scan over `E900` (10 entries), and state transitions via `E400`/`E401`, used to keep player-weapon/stage-collision handling segmented per routine.
- Weapon-flag dispatch split (important for `double` vs `uplaser`):
  - `0xAC30..0xAC6D` routes per-equipped weapon flag:
    - `E431 -> 0xACF6` (double-family spawn path)
    - `E434 -> 0xADBA` (up-laser-family spawn path)
    - `E435 -> 0xADEF` (down-laser-family spawn path)
  - Dispatcher table bytes at `0xABC2` decode to update-routine pointers (type id -> routine):
    - `0x0A -> 0xAEB7`
    - `0x0C -> 0xAEDB`
    - (table sequence around `0xABC2`: `D4 AC E0 AC 1F AD FB B0 FB B0 AF B1 07 AE 85 AE 37 AF B7 AE CB AE DB AE FE AE ...`)
  - `double` evidence:
    - spawn at `0xACF6` writes object type `0x03`
    - update at `0xAD1F` is the diagonal step routine (`-6/+6` axis pair per tick)
  - `uplaser` evidence:
    - spawn at `0xADBA` selects object type `0x0A` (level 1) or `0x0C` (level 2)
  - level 1 update (`0xAEB7`) is a simpler upward step path
  - level 2 update (`0xAEDB`) wraps the level 1 step and adds extra size/phase handling each few ticks (`DEC (IY+1)` gate plus adjustments via `0xAE40`)
- Gameplay constants still anchored to controlled reference implementation (`nemesis-s-bdx`) where disassembly does not expose symbolic names:
  - movement speed base/increment,
  - laser speed/length model,
  - missile gravity/floor-crawl model,
  - option follow-delay queue.

## ASM -> Lua mapping now applied (`carts/nemesis_s/player/player.lua`)

- `AEB7`:
  - `SUB 6` on `(IY+5)` -> `uplaser.y = uplaser.y - 6` every update tick.
- `AEDB..AEE2`:
  - `DEC (IY+1)` gate and reset to `4` -> `gate_counter` countdown with 4-tick cadence.
- `AEE6..AEF1`:
  - when `(IY+5) != 0`, subtract `8` and use growth increment `2` -> extra rise + larger growth on gated ticks.
- `AEEA..AEEC` + `AEF4..AEF8`:
  - when `(IY+5) == 0`, growth increment is `1` -> reduced growth when near top.
- `ADDx/AND` coarse alignment used in spawn/update paths (`ADDx` + `AND 0xF8`):
  - Lua keeps tile-aligned beam placement by snapping draw/start coordinates to tile grid with half-tile render phase where needed.

## Missile two-tile probes

- `B0FB` probes the missile at `(x, y + 8)`, `(x + 8, y + 8)`, and
  `(x + 8, y)` through `B1A6 -> 8388`.
- `5C92` maps the pixel coordinate in `HL` to the corresponding tile address.
- `8388` calls `8395` for the sampled tile. If that tile is clear, it increments
  the tile address and falls through to `8395` once for the adjacent tile;
  `(E & 0x1f) == 0` suppresses the second probe at the row boundary.
- The `RET` instructions in `8395` return directly to the caller of `8388` on
  that fallthrough path. They do not form a row loop. Each missile probe
  therefore covers at most two adjacent tiles without allocating collision
  geometry per update.

## Enemy aimed-shot datapath

- `938F` offsets the source X coordinate by eight pixels, selects a base speed
  of `0x50 + 2 * difficulty` (capped at `0x60`), and calls the shared aimed-shot
  setup at `93F8`. Normal difficulty therefore uses `0x50`.
- `945B..94BA` takes the absolute player delta, rejects targets whose coarse X
  distance plus exact Y distance is below `0x30`, and indexes the 16x16 angle
  table at `94D9` with `(abs_x & 0xf0) + (abs_y >> 4)`.
- `93FD..9456` reads the two complementary entries from the 64-byte sine table
  at `95D9`; `94BB..94CC` multiplies each sample by the retained speed and emits
  signed Q8.8 X/Y velocity words at `F012` and `F014`.
- The cart retains the resulting normal-difficulty angle and velocity tables as
  ROM data. Enemy bullets write those raw Q8.8 words once when admitted; their
  scheduled update performs no trigonometry, normalization, or division.
