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
