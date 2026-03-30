# Nemesis 2 Research Notes (for `nemesis_s`)

## ROM provenance

- File used for byte-level analysis:
  - `.external/nemesis2rom/extracted/Nemesis2[File-Hunter.com].rom`
  - Size: `131072` bytes
  - SHA1: `d63e20369f98487767810a0c57603bef6a2a07e5`
  - MD5: `abbcfc00f71051434e0e82e29b6ea1ef`
- Important: this checksum does **not** match the checksum listed in FRS patch docs (`ab30cdea...` / `ee3e6a50...`), so this is likely a different dump/revision.

## Disassembly workflow

- Tool: Python package `z80dis` in `.external/py`.
- Script:
  - `src/carts/nemesis_s/test/disassemble_nemesis2.py`
  - Run with: `.external/py/bin/python src/carts/nemesis_s/test/disassemble_nemesis2.py`
- Entry disassembly output:
  - `.external/nemesis2rom/disasm_entry_0x4090.txt`
- Targeted segment disassembly output:
  - `.external/nemesis2rom/disasm_segments_candidate.txt`
- SNSMAT call-site scan output:
  - `.external/nemesis2rom/snsmat_call_sites.txt`

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

## Interpretation limits

- These observations are from linear-bank static disassembly of one ROM dump variant.
- Precise runtime semantics can still differ per mapper bank/context; therefore, behavior claims above are only used where confirmed by both:
  - disassembly pattern, and
  - headless telemetry in `nemesis_s`.

## Why this baseline is scoped as "player-only"

- Current `nemesis_s` intentionally implements:
  - one scrolling in-game segment,
  - player movement,
  - player shot behavior,
  - deterministic headless telemetry and assertions.
- Not implemented in this scope:
  - stage collision map and enemy logic,
  - title/map/powerup screens,
  - full Nemesis 2 event scripting.

## Stage data loading model

- `nemesis_s` now loads stage geometry from a ROM data asset instead of hardcoded Lua math:
  - asset file: `src/carts/nemesis_s/res/data/nemesis_s_stage.yaml`
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

## ASM -> Lua mapping now applied (`src/carts/nemesis_s/player.lua`)

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
