# DKC1 Physics Implementation Reference

**Date:** 2026-02-10
**Source:** `.external/DKC1/Routine_Macros_DKC1.asm`
**Target:** `src/carts/esther/player.lua`

---

## Table of Contents

1. [Overview](#overview)
2. [Assembly Routines Reference](#assembly-routines-reference)
3. [Subpixel System](#subpixel-system)
4. [Movement Constants](#movement-constants)
5. [Smoothing Profile System](#smoothing-profile-system)
6. [Jump Mechanics](#jump-mechanics)
7. [Gravity System](#gravity-system)
8. [Horizontal Control Flow](#horizontal-control-flow)
9. [Implementation Notes](#implementation-notes)

---

## Overview

Donkey Kong Country uses a sophisticated fixed-point physics system where all speeds and positions are represented in **subpixels**. The conversion factor is:

```
0x0100 subpixels = 1.0 pixel
```

Movement uses a **target speed + smoothing profile** approach rather than direct acceleration. The "smoothing" is implemented via bit-shift division (LSR chains) that gradually approach the target speed.

---

## Assembly Routines Reference

### CODE_BFB159 - Profile Selection
**Location:** `.external/DKC1/Routine_Macros_DKC1.asm:110537`

**Purpose:** Determines which smoothing profile (divisor) to use based on player state.

**Logic:**
```asm
CODE_BFB159:
    LDY.b !RAM_DKC1_NorSpr_CurrentIndexLo
    LDA.b $32                           ; Load current state
    CMP.w #$0004                        ; State 4 = grounded movement
    BEQ.b CODE_BFB167
    CMP.w #$0009                        ; State 9 = grounded movement alt
    BNE.b CODE_BFB187                   ; If airborne/other → Profile 0

CODE_BFB167:                            ; Grounded state detected
    LDA.w !RAM_DKC1_NorSpr_RAMTable12A5Lo,y
    AND.w #$0001                        ; Check if grounded bit set
    BEQ.b CODE_BFB187                   ; If not grounded → Profile 0
    LDY.b $84
    LDA.w $1699,y                       ; Load player flags
    AND.w #$0004                        ; Check run flag (bit 2)
    BEQ.b CODE_BFB180                   ; If walking → Profile 3
    LDA.w #$0008                        ; Running → Profile 8
    LDY.b !RAM_DKC1_NorSpr_CurrentIndexLo
    BRA.b CODE_BFB191

CODE_BFB180:                            ; Walking
    LDA.w #$0003                        ; Profile 3
    LDY.b !RAM_DKC1_NorSpr_CurrentIndexLo
    BRA.b CODE_BFB191

CODE_BFB187:                            ; Default (airborne/roll)
    LDA.w #$0000                        ; Profile 0
    BRA.b CODE_BFB191
```

**Profile Selection Table:**

| Condition | Profile ID | Divisor | Use Case |
|-----------|------------|---------|----------|
| State $04/$09 + Grounded + Run flag ($1699 & $0004) | 8 | ÷21.33 | Running |
| State $04/$09 + Grounded + No run flag | 3 | ÷64 | Walking |
| Airborne / Roll / Other | 0 | ÷8 | Fast response |

**Lua Implementation:** `src/carts/esther/player.lua:565-575`
```lua
function player:select_ground_profile()
    if (self.dkc_1699_flags & 0x0004) ~= 0 then
        return constants.profile.ground_run -- 8
    end
    return constants.profile.ground_walk -- 3
end
```

---

### DATA_BFB255 - Profile Divisor Table
**Location:** `.external/DKC1/Routine_Macros_DKC1.asm:110688-110720`

**Purpose:** Jump table for smoothing division routines using cascading LSR (Logical Shift Right) operations.

```asm
DATA_BFB255:
    dw CODE_BFB278    ; Profile 0: ÷8
    dw CODE_BFB277    ; Profile 1: ÷16
    dw CODE_BFB276    ; Profile 2: ÷32
    dw CODE_BFB275    ; Profile 3: ÷64
    dw CODE_BFB274    ; Profile 4: ÷128
    dw CODE_BFB273    ; Profile 5: ÷256
    dw CODE_BFB279    ; Profile 6: ÷4
    dw CODE_BFB27A    ; Profile 7: ÷2
    dw CODE_BFB267    ; Profile 8: ÷32 + ÷64 ≈ ÷21.33

CODE_BFB267:        ; Profile 8 (Run): divide by ~21.33
    LSR             ; ÷2  = value/2
    LSR             ; ÷4  = value/4
    LSR             ; ÷8  = value/8
    LSR             ; ÷16 = value/16
    LSR             ; ÷32 = value/32
    STA.b $4C       ; Store (value/32)
    LSR             ; ÷64 = value/64
    CLC
    ADC.b $4C       ; Add (value/32) + (value/64) = value * (1/32 + 1/64) ≈ value/21.33
    RTS

CODE_BFB273:        ; Profile 5: ÷256
    LSR
CODE_BFB274:        ; Profile 4: ÷128
    LSR
CODE_BFB275:        ; Profile 3: ÷64 (walking)
    LSR
CODE_BFB276:        ; Profile 2: ÷32
    LSR
CODE_BFB277:        ; Profile 1: ÷16
    LSR
CODE_BFB278:        ; Profile 0: ÷8 (air control)
    LSR
CODE_BFB279:        ; Profile 6: ÷4
    LSR
CODE_BFB27A:        ; Profile 7: ÷2
    LSR
    RTS
```

**How it works:**
1. Calculate `abs(target_speed - current_speed)`
2. Call appropriate divisor routine from table
3. Add/subtract result to current speed (approaching target)

**Lua Implementation:** `src/carts/esther/player.lua:37-48`
```lua
local function profile_step(abs_diff, profile_id)
    if profile_id == 0 then return math.floor(abs_diff / 8) end
    if profile_id == 1 then return math.floor(abs_diff / 16) end
    if profile_id == 2 then return math.floor(abs_diff / 32) end
    if profile_id == 3 then return math.floor(abs_diff / 64) end
    if profile_id == 4 then return math.floor(abs_diff / 128) end
    if profile_id == 5 then return math.floor(abs_diff / 256) end
    if profile_id == 6 then return math.floor(abs_diff / 4) end
    if profile_id == 7 then return math.floor(abs_diff / 2) end
    if profile_id == 8 then return math.floor(abs_diff / 32) + math.floor(abs_diff / 64) end
    return 0
end
```

---

### CODE_BFB4E3 - Get Target Speed
**Location:** `.external/DKC1/Routine_Macros_DKC1.asm:111058-111140`

**Purpose:** Returns the target horizontal speed based on Y-button state and Animal Buddy.

**Main Entry Point:**
```asm
CODE_BFB4E3:
    LDY.b $84
    LDA.b $7E                       ; Held buttons
    AND.w #$4000                    ; Check Y-button (run)
    BEQ.b CODE_BFB522              ; If not held → walk speed
    ; ... (run speed path)
CODE_BFB522:                        ; Walk speed path
    JSR.w CODE_BFB573              ; Get walk speed
    ; ...
```

**CODE_BFB538 - Run Speed Table** (Line 111093):
```asm
CODE_BFB538:
    LDA.w $0512,y                   ; Check if riding Animal Buddy
    BEQ.b CODE_BFB55D              ; If not → normal run speed
    TAX
    LDA.w !RAM_DKC1_NorSpr_SpriteIDLo,x
    CMP.w #!Define_DKC1_NorSpr0A_Expresso
    BEQ.b CODE_BFB557              ; Expresso → $0400
    CMP.w #!Define_DKC1_NorSpr0B_Winky
    BEQ.b CODE_BFB551              ; Winky → $0300
    LDA.w #$0380                    ; Other buddy (Rambi) → $0380
    RTS
CODE_BFB551:
    LDA.w #$0300                    ; Winky run: 3 px/frame
    RTS
CODE_BFB557:
    LDA.w #$0400                    ; Expresso run: 4 px/frame
    RTS
CODE_BFB55D:                        ; Not on buddy
    LDA.w #$0300                    ; Normal run: 3 px/frame
    RTS
```

**CODE_BFB573 - Walk Speed Table** (Line 111141):
```asm
CODE_BFB573:
    LDA.w $0512,y                   ; Check if riding Animal Buddy
    BEQ.b CODE_BFB598              ; If not → normal walk speed
    TAX
    LDA.w !RAM_DKC1_NorSpr_SpriteIDLo,x
    CMP.w #!Define_DKC1_NorSpr0A_Expresso
    BEQ.b CODE_BFB592              ; Expresso → $0300
    CMP.w #!Define_DKC1_NorSpr0B_Winky
    BEQ.b CODE_BFB58C              ; Winky → $0200
    LDA.w #$0200                    ; Other buddy (Rambi) → $0200
    RTS
CODE_BFB58C:
    LDA.w #$0200                    ; Winky walk: 2 px/frame
    RTS
CODE_BFB592:
    LDA.w #$0300                    ; Expresso walk: 3 px/frame
    RTS
CODE_BFB598:                        ; Not on buddy
    LDA.w #$0200                    ; Normal walk: 2 px/frame
    RTS
```

**CODE_BFB503 - Diddy Speed Multiplier** (Line 111104):
```asm
CODE_BFB503:
    STA.b $4C                       ; Store base target speed
    ; ... (flag check)
    LDA.b $4C
    LDX.b !RAM_DKC1_NorSpr_CurrentIndexLo
    CPX.w #$0004                    ; Sprite #4 = Diddy
    BNE.b CODE_BFB51E              ; If not Diddy → return base speed
    STA.b $4C
    LSR                             ; Divide by 2
    LSR                             ; Divide by 4
    LSR                             ; Divide by 8
    CLC
    ADC.b $4C                       ; Add base: speed × (1 + 1/8) = speed × 1.125
CODE_BFB51E:
    RTS
```

**Lua Implementation:** `src/carts/esther/player.lua:544-564`
```lua
function player:CODE_BFB4E3_GET_TARGET_SPEED()
    local ref = constants.dkc
    if (self.dkc_1699_flags & 0x0004) ~= 0 then
        return ref.run_target_subpx  -- 0x0300 when Y-button held
    end
    return ref.walk_target_subpx     -- 0x0200 otherwise
end
```

---

### CODE_BFB94F - Ground Jump
**Location:** `.external/DKC1/Routine_Macros_DKC1.asm:111659-111680`

**Purpose:** Initialize a jump from the ground (walk/run state).

```asm
CODE_BFB94F:
    LDY.b $84
    LDA.w $1699,y
    ORA.w #$0003                    ; Set jump flags (bits 0 and 1)
    STA.w $1699,y
    LDA.w $16CD,y
    ORA.w #$0001                    ; Set airborne flag
    STA.w $16CD,y
    LDA.w #$FFB8                    ; Gravity while holding jump: -72 dec ($FFB8)
    CPY.w #$0000                    ; Check if DK (Y=0) or Diddy (Y≠0)
    BEQ.b CODE_BFB96E
    LDA.w #$FFA6                    ; Diddy gravity: -90 dec ($FFA6)
CODE_BFB96E:
    STA.w $16F9,y                   ; Store "hold jump" gravity value
    LDA.w #$0000
    STA.w $16E5,y
    LDA.w #$00C1                    ; Animation script ID $C1
    STA.w !RAM_DKC1_NorSpr_RAMTable11A1Lo,x
    STZ.w $1E17
    JSR.w CODE_BFBEC5              ; Clear flag bit $0010
    LDY.b $84
    LDA.w $1699,y
    AND.w #$FF7F                    ; Clear flag bit $0080
    STA.w $1699,y
```

**Note:** The initial Y velocity is **not directly set in this routine**. The animation script ($00C1) likely triggers the velocity assignment via animation events. Empirical testing suggests approximately **$0600** for ground jump initial velocity.

**Jump Flags:**
- `$1699 & $0003`: Jump active flags
- `$16CD & $0001`: Airborne state
- `$16F9`: Gravity value while holding jump button

**Lua Implementation:** `src/carts/esther/player.lua:764-775`
```lua
function player:CODE_BFB94F_START_JUMP(from_roll)
    self.y_speed_subpx = constants.dkc.jump_ground_subpx  -- $0600 (approx)
    self.dkc_1699_flags = self.dkc_1699_flags | 0x0003
    self.dkc_16f9_jump_gravity_subpx = constants.dkc.gravity_hold_subpx
    self.grounded = false
    self.debug_jump_started = true
    self.debug_jump_from_roll = from_roll
    self.debug_jump_launch_sy = self.y_speed_subpx
    self:play_timeline(jump_timeline_id, { rewind = true, snap_to_start = true })
end
```

---

### CODE_BFBA88 - Rope/Bounce Jump
**Location:** `.external/DKC1/Routine_Macros_DKC1.asm:111806-111841`

**Purpose:** Initialize a rope/tire bounce jump (higher velocity).

```asm
CODE_BFBA88:
    LDX.b !RAM_DKC1_NorSpr_CurrentIndexLo
    LDA.w #$0700                    ; Y velocity: $0700 (1792 dec)
    STA.w !RAM_DKC1_NorSpr_YSpeedLo,x
    LDY.b $84
    LDA.w $1699,y
    ORA.w #$0203                    ; Set jump flags + special flag
    STA.w $1699,y
    LDA.w $16CD,y
    ORA.w #$0001
    STA.w $16CD,y
    LDA.w #$FFB8                    ; Same gravity as ground jump
    STA.w $16F9,y
    LDA.w #$0000
    STA.w $16E5,y
    LDA.w #$00C1
    STA.w !RAM_DKC1_NorSpr_RAMTable11A1Lo,x
    JSR.w CODE_BFBEC5
    ; ... (animation setup continues)
```

**Key Difference:** Direct Y velocity assignment of **$0700** (7 pixels upward).

**Lua Implementation:** `src/carts/esther/player.lua:750-762`
```lua
function player:CODE_BFBA88_START_JUMP(from_roll)
    self.y_speed_subpx = constants.dkc.jump_initial_subpx  -- $0700
    self.dkc_1699_flags = self.dkc_1699_flags | 0x0203
    self.dkc_16f9_jump_gravity_subpx = constants.dkc.gravity_hold_subpx
    self.grounded = false
    -- ... (rest omitted)
end
```

---

### CODE_BFBA39 - Airborne Neutral Handler
**Location:** `.external/DKC1/Routine_Macros_DKC1.asm:111765-111766`

**Purpose:** Handle no directional input while airborne.

```asm
CODE_BFBA39:
    RTS         ; Does NOTHING - just returns!
```

**Critical Insight:** This routine **literally does nothing**. When the player is airborne and releases directional input, the target speed is **not changed**. This is the key to DKC's "committed jump arc" feel - you maintain momentum in the air.

**Contrast with Ground Neutral:** On the ground, neutral input sets target speed to 0, causing deceleration.

**Lua Implementation:** `src/carts/esther/player.lua:577-619`
```lua
function player:apply_horizontal_control(airborne)
    local prev_target = self.target_x_speed_subpx
    local new_target = 0

    if airborne then
        if self.move_axis == -1 then
            new_target = -self:CODE_BFB4E3_GET_TARGET_SPEED()
        elseif self.move_axis == 1 then
            new_target = self:CODE_BFB4E3_GET_TARGET_SPEED()
        else
            -- CODE_BFBA39_AIR_NEUTRAL: Retain previous target!
            new_target = prev_target  -- <-- Key difference!
        end
    else
        if self.move_axis == -1 then
            new_target = -self:CODE_BFB4E3_GET_TARGET_SPEED()
        elseif self.move_axis == 1 then
            new_target = self:CODE_BFB4E3_GET_TARGET_SPEED()
        else
            -- CODE_BFC18A_GROUND_NEUTRAL: Decelerate to 0
            new_target = 0
        end
    end

    self.target_x_speed_subpx = new_target
    -- ... (profile selection continues)
end
```

---

### CODE_BFAF38 - Air Gravity
**Location:** `.external/DKC1/Routine_Macros_DKC1.asm:110236-110264`

**Purpose:** Apply gravity while airborne, with different values for holding/releasing jump button.

```asm
CODE_BFAF38:
    LDX.b !RAM_DKC1_NorSpr_CurrentIndexLo
    LDY.b $84
    LDA.w $1699,y
    AND.w #$0002                    ; Check jump-hold flag
    BEQ.b CODE_BFAF4E              ; If not holding → use release gravity
    LDA.w $16F9,y                   ; $FFB8 or $FFA6 (hold gravity)
    BRA.b CODE_BFAF56

CODE_BFAF49:
    LDA.w #$FF90                    ; -112 dec (release gravity)
    BRA.b CODE_BFAF56

CODE_BFAF4E:
    CPX.w #$0004                    ; Special check for sprite #4
    BEQ.b CODE_BFAF49
    LDA.w #$FF90                    ; Release gravity
CODE_BFAF56:
    CLC
    ADC.w !RAM_DKC1_NorSpr_YSpeedLo,x  ; Add gravity to Y speed
    BPL.b CODE_BFAF64              ; If positive (falling down)
    CMP.w #$F800                    ; Clamp to max fall speed
    BCS.b CODE_BFAF64
    LDA.w #$F800                    ; -2048 dec max fall
CODE_BFAF64:
    STA.w !RAM_DKC1_NorSpr_YSpeedLo,x
    RTS
```

**Gravity Values:**

| State | Value (hex) | Value (dec) | Pixels/frame |
|-------|-------------|-------------|--------------|
| Hold jump (DK) | $FFB8 | -72 | -0.28 px |
| Hold jump (Diddy) | $FFA6 | -90 | -0.35 px |
| Release jump | $FF90 | -112 | -0.44 px |
| Max fall speed | $F800 | -2048 | -8.0 px |

**Lua Implementation:** `src/carts/esther/player.lua:622-635`
```lua
function player:CODE_BFAF38_AIR_GRAVITY()
    local ref = constants.dkc
    local gravity = ref.gravity_release_subpx  -- $FF90
    if (self.dkc_1699_flags & 0x0002) ~= 0 then
        gravity = self.dkc_16f9_jump_gravity_subpx  -- $FFB8 or $FFA6
    end
    self.active_gravity_subpx = gravity
    self.y_speed_subpx = self.y_speed_subpx + gravity
    if self.y_speed_subpx < ref.max_fall_subpx then  -- $F800
        self.y_speed_subpx = ref.max_fall_subpx
    end
end
```

---

### CODE_BFB27C - Horizontal Control Entry
**Location:** `.external/DKC1/Routine_Macros_DKC1.asm:110733-110850`

**Purpose:** Top-level input processing and delegation to directional handlers.

```asm
CODE_BFB27C:
    STA.w $180F                     ; Store control context (0=ground, 1=air)
    STZ.w $1E19
    ; ... (input clearing/flag management)
CODE_BFB2C7:
    LDA.b $44                       ; Player index
    ASL
    TAY
    LDA.w !RAM_DKC1_Global_PressedButtonsLoP1,y
    STA.b $80                       ; Store pressed buttons
    LDA.w !RAM_DKC1_Global_HeldButtonsLoP1,y
    STA.b $7E                       ; Store held buttons
    ; ... (store to player RAM)

    ; Up/Down handling
    LDA.b $7E
    AND.w #!Joypad_DPadU
    BEQ.b CODE_BFB2F6
    JSR.w CODE_BFB38A              ; Up handler
    BRA.b CODE_BFB305

CODE_BFB2F6:
    LDA.b $7E
    AND.w #!Joypad_DPadD
    BEQ.b CODE_BFB302
    JSR.w CODE_BFB3FE              ; Down handler
    BRA.b CODE_BFB305

CODE_BFB302:
    JSR.w CODE_BFC1A1              ; Vertical neutral
CODE_BFB305:
    ; Left/Right handling
    LDA.b $7E
    AND.w #!Joypad_DPadL
    BEQ.b CODE_BFB311
    JSR.w CODE_BFB5AE              ; Left handler
    BRA.b CODE_BFB320

CODE_BFB311:
    LDA.b $7E
    AND.w #!Joypad_DPadR
    BEQ.b CODE_BFB31D
    JSR.w CODE_BFB6C5              ; Right handler
    BRA.b CODE_BFB320

CODE_BFB31D:
    JSR.w CODE_BFC18A              ; Horizontal neutral (ground: target=0)
    ; ... (button handlers A, B, X, Y continue)
```

**Jump Table Reference:**
- Up: CODE_BFB38A
- Down: CODE_BFB3FE
- Left: CODE_BFB5AE
- Right: CODE_BFB6C5
- Horizontal Neutral: CODE_BFC18A (ground) / CODE_BFBA39 (air)

**Lua Equivalent:** Input is sampled in `player:sample_input()` at `src/carts/esther/player.lua:460-525`.

---

## Subpixel System

All positions and velocities use **16-bit signed integers** representing subpixels:

```
0x0100 subpixels = 1.0 pixel
0x0200 subpixels = 2.0 pixels
0x0080 subpixels = 0.5 pixels
```

**Conversion:**
```lua
pixels = subpixels / 0x0100
subpixels = pixels * 0x0100
```

**Example:**
- Walk speed `0x0200` = 2 pixels/frame
- Run speed `0x0300` = 3 pixels/frame
- Jump velocity `0x0700` = 7 pixels/frame (upward)
- Gravity `0xFF90` = -0.4375 pixels/frame (downward)

**Implementation:** `src/carts/esther/constants.lua:13`
```lua
constants.dkc = {
    subpixels_per_px = 0x0100,
    -- ...
}
```

---

## Movement Constants

**Location:** `src/carts/esther/constants.lua:24-40`

```lua
constants.dkc = {
    walk_target_subpx = 0x0200,           -- 2.0 px/frame
    run_target_subpx = 0x0300,            -- 3.0 px/frame
    roll_entry_min_subpx = 0x0100,        -- 1.0 px/frame
    roll_entry_dpad_subpx = 0x0300,       -- 3.0 px/frame
    roll_entry_cap_subpx = 0x0400,        -- 4.0 px/frame
    roll_chain_step_subpx = 0x0100,       -- +1.0 px/frame per chain
    roll_chain_cap_subpx = 0x0800,        -- 8.0 px/frame max
    roll_dash_window_frames = 0x0010,     -- 16 frames
    jump_initial_subpx = 0x0700,          -- 7.0 px/frame (rope jump)
    jump_ground_subpx = 0x0600,           -- 6.0 px/frame (ground jump, approx)
    gravity_hold_subpx = -0x0048,         -- -0.28 px/frame (DK)
    gravity_hold_diddy_subpx = -0x005A,   -- -0.35 px/frame (Diddy)
    gravity_release_subpx = -0x0070,      -- -0.44 px/frame
    max_fall_subpx = -0x0800,             -- -8.0 px/frame
    jump_buffer_frames = 0x000C,          -- 12 frames
    diddy_speed_mult_shift = 3,           -- ×1.125 (speed + speed>>3)
}
```

**Assembly References:**
- `walk_target_subpx`: `.external/DKC1/Routine_Macros_DKC1.asm:111183` (CODE_BFB573, `LDA.w #$0200`) ✓
- `run_target_subpx`: `.external/DKC1/Routine_Macros_DKC1.asm:111107` (CODE_BFB538, `LDA.w #$0300`) ✓
- `jump_initial_subpx`: `.external/DKC1/Routine_Macros_DKC1.asm:111809` (`LDA.w #$0700`)
- `gravity_hold_subpx`: `.external/DKC1/Routine_Macros_DKC1.asm:111665` (`LDA.w #$FFB8`)
- `gravity_hold_diddy_subpx`: `.external/DKC1/Routine_Macros_DKC1.asm:111667` (`LDA.w #$FFA6`)
- `gravity_release_subpx`: `.external/DKC1/Routine_Macros_DKC1.asm:110244` (`LDA.w #$FF90`)
- `max_fall_subpx`: `.external/DKC1/Routine_Macros_DKC1.asm:110259` (`CMP.w #$F800`)
- `jump_buffer_frames`: `.external/DKC1/Routine_Macros_DKC1.asm:111613` (`CMP.w #$000C`)
- `roll_chain_step_subpx`: `.external/DKC1/Routine_Macros_DKC1.asm:112255` (CODE_BFBDE7, `ADC.w #$0100`)
- `roll_chain_cap_subpx`: `.external/DKC1/Routine_Macros_DKC1.asm:112257` (CODE_BFBDE7, `CMP.w #$0800`)

### Movement Speed Context

**Walk vs Run Speeds:**

| Character/Buddy | Walk Speed | Run Speed (Y-button) | Assembly Reference |
|-----------------|------------|---------------------|--------------------|
| DK/Diddy (base) | 0x0200 (2 px/frame) | 0x0300 (3 px/frame) | CODE_BFB573:111183 / CODE_BFB538:111107 |
| Diddy (actual)  | 0x0240 (2.25 px/frame) | 0x0360 (3.375 px/frame) | Speed × 1.125 via CODE_BFB503:111109 |
| Expresso | 0x0300 (3 px/frame) | 0x0400 (4 px/frame) | CODE_BFB573:111193 / CODE_BFB538:111093 |
| Winky | 0x0200 (2 px/frame) | 0x0300 (3 px/frame) | CODE_BFB573:111188 / CODE_BFB538:111088 |
| Rambi | 0x0200 (2 px/frame) | 0x0380 (3.5 px/frame) | CODE_BFB573:111178 / CODE_BFB538:111083 |

**Diddy Speed Multiplier:**
```asm
; CODE_BFB503 (line 111109)
LDA.b $4C           ; Load base speed
LSR                 ; ÷2
LSR                 ; ÷4
LSR                 ; ÷8 (shift right 3 times)
CLC
ADC.b $4C           ; speed + (speed >> 3) = speed × 1.125
```
Diddy is **12.5% faster** than DK at all ground speeds.

**Roll Mechanics:**
- **Initial roll speed**: Inherits current horizontal speed ($16F1)
- **Roll chain bonus**: +0x0100 (+1 px/frame) per consecutive roll
- **Max roll speed**: 0x0800 (8 px/frame) - requires **5 consecutive chains!**
- Roll preserves momentum without smoothing profiles (direct speed control)
- **Typical single roll**: 2-3 px/frame (from walk/run start)
- **Achievable max in practice**: ~5-6 px/frame (2-3 chains)

**Practical Speed Comparison:**
- Walk (2 px/frame) @ 60 fps = 120 px/sec = 7.5 tiles/sec
- Run (3 px/frame) @ 60 fps = 180 px/sec = 11.25 tiles/sec
- Single roll from run (3 px/frame) = Same as running
- 2× roll chain (4 px/frame) = 240 px/sec = 15 tiles/sec
- 3× roll chain (5 px/frame) = 300 px/sec = 18.75 tiles/sec
- Theoretical max roll (8 px/frame) = 480 px/sec = 30 tiles/sec (rarely achieved)
- Expresso run (4 px/frame) = **Easier to maintain than roll chains**

### Jump Height Context

**Donkey Kong Sprite Dimensions:**
- Standing height: ~32 pixels (2 tiles @ 16×16)
- Crouching height: ~24 pixels

**Jump Height Comparison:**
- Ground jump (full): **64 pixels** = **2× DK's height**
- Rope/bounce jump: **87 pixels** = **2.7× DK's height**
- Short jump: **16-24 pixels** = **0.5-0.75× DK's height**

This means a full ground jump clears a wall approximately **twice Donkey Kong's standing height**, which matches the feel of DKC1 platforming.

**Practical Examples:**
- 1-tile wall (16px): Easily cleared with any jump
- 2-tile wall (32px): Requires ~half jump or better
- 3-tile wall (48px): Requires near-full ground jump
- 4-tile wall (64px): Requires full ground jump (max)
- 5-tile wall (80px): Requires rope/bounce jump
- 6-tile gap (96px): Run + hold jump for ~1.5 seconds airtime

---

## Smoothing Profile System

### Profile Configuration

**Location:** `src/carts/esther/constants.lua:43-60`

```lua
constants.profile = {
    ground_walk = 3,   -- ÷64: Heavy inertia (Authentic)
    ground_run = 8,    -- ÷21: Medium inertia (Authentic)
    default = 0,       -- ÷8:  Air control (Authentic)
}
```

### How Smoothing Works

Given:
- `current_speed`: Current X speed in subpixels
- `target_speed`: Desired X speed in subpixels
- `profile_id`: Selected smoothing profile (0-8)

**Algorithm:**
```lua
local delta = target_speed - current_speed
local abs_delta = math.abs(delta)
local step = profile_step(abs_delta, profile_id)

if delta > 0 then
    current_speed = math.min(current_speed + step, target_speed)
else
    current_speed = math.max(current_speed - step, target_speed)
end
```

**Example (Walking):**
```
Initial: current_speed = 0, target_speed = 0x0200 (512), profile = 3 (÷64)

Frame 1: step = 512 / 64 = 8  → current_speed = 8
Frame 2: step = 504 / 64 = 7  → current_speed = 15
Frame 3: step = 497 / 64 = 7  → current_speed = 22
...
Frame ~60: current_speed ≈ 512 (reached target)
```

This creates a smooth exponential approach curve, giving DKC its characteristic "heavy" feel when walking.

---

## Jump Mechanics

### Jump Buffer System

**Assembly Reference:** `.external/DKC1/Routine_Macros_DKC1.asm:111604-111622`

```asm
CODE_BFB8F7:
    LDX.b !RAM_DKC1_NorSpr_CurrentIndexLo
    LDY.b $84
    LDA.b $80                       ; Pressed buttons this frame
    AND.w #$8000                    ; Check B button pressed
    BNE.b CODE_BFB919              ; If pressed → record timestamp
    LDA.w $1699,y
    ORA.w #$0001                    ; Set "want jump" flag
    STA.w $1699,y
    LDA.b $28                       ; Current frame counter
    SEC
    SBC.w $16A5,y                   ; Subtract last B-press frame
    BMI.b CODE_BFB918              ; If negative → no buffered jump
    CMP.w #$000C                    ; 12-frame window
    BMI.b CODE_BFB91E              ; If within window → allow jump
CODE_BFB918:
    RTS

CODE_BFB919:
    LDA.b $28
    STA.w $16A5,y                   ; Record B-press timestamp
CODE_BFB91E:
    ; ... (jump trigger logic)
```

**Lua Implementation:** `src/carts/esther/player.lua:498-502`
```lua
local buf = constants.dkc.jump_buffer_frames  -- 12
self.jump_buffer_active = self.jump_held and
    ((self.debug_frame - self.dkc_16a5_last_b_press_frame) < buf)
```

### Jump Height Control

Jump height is determined by:
1. **Initial velocity**: `0x0600` (ground) or `0x0700` (rope)
2. **Gravity while holding**: `-0x0048` (slower fall)
3. **Gravity after release**: `-0x0070` (faster fall)

Releasing the jump button early switches to higher gravity, resulting in a shorter jump.

**Assembly:** See CODE_BFAF38 above.

---

## Roll Mechanics

### CODE_BFBDA9 - Roll Initiation
**Location:** `.external/DKC1/Routine_Macros_DKC1.asm:112223-112242`

**Purpose:** Start a roll using current horizontal speed.

```asm
CODE_BFBDA9:
    LDA.w #$0012                    ; Set state to rolling
    STA.w !RAM_DKC1_NorSpr_RAMTable1029Lo,x
    LDA.w $16F1,y                   ; Load current X speed ($16F1)
    BIT.w !RAM_DKC1_NorSpr_YXPPCCCTLo,x
    BVC.b CODE_BFBDBB              ; Check direction flag
    EOR.w #$FFFF                    ; Negate if facing left
    INC
CODE_BFBDBB:
    STA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x  ; Store to target speed
    ; ... (set roll animation)
    LDA.w #!Define_DKC1_AnimationID_DK_Roll
    JSL.l CODE_BE80A4
    RTS
```

**Key Insight:** Roll **inherits current speed** from `$16F1`, not a fixed value. This means:
- Rolling from standstill → slow roll (~0 speed)
- Rolling from walk → moderate roll (~2 px/frame)
- Rolling from run → fast roll (~3 px/frame)

### CODE_BFBDE7 - Roll Chain (Consecutive Rolls)
**Location:** `.external/DKC1/Routine_Macros_DKC1.asm:112246-112260`

**Purpose:** Increase speed when chaining rolls (Y-button roll during existing roll).

```asm
CODE_BFBDE7:
    LDX.b !RAM_DKC1_NorSpr_CurrentIndexLo
    LDY.b $84
    LDA.w #$0003
    STA.w $16E5,y                   ; Set some roll state
    LDA.b $28
    STA.w $16A1,y                   ; Record timestamp
    LDA.w $16F1,y                   ; Load current X speed
    CLC
    ADC.w #$0100                    ; Add 0x0100 (1 pixel/frame bonus)
    CMP.w #$0800                    ; Compare with max (8 px/frame)
    BMI.b CODE_BFBE05              ; If below max → use new speed
    LDA.w #$0800                    ; Otherwise cap at 0x0800
CODE_BFBE05:
    STA.w $16F1,y                   ; Store boosted speed
    JSL.l CODE_BFBDA9              ; Initiate new roll with boosted speed
    RTS
```

**Roll Speed Progression:**
```
Initial roll from run:    0x0300 (3.0 px/frame)
After 1st chain (Y tap):  0x0400 (4.0 px/frame)
After 2nd chain:          0x0500 (5.0 px/frame)
After 3rd chain:          0x0600 (6.0 px/frame)
After 4th chain:          0x0700 (7.0 px/frame)
After 5th chain (max):    0x0800 (8.0 px/frame) ← capped
```

**In Practice:**
- Most players achieve **2-3 chains** (4-5 px/frame) before hitting obstacles or losing rhythm
- **5 chains** requires ~120 frames (2 seconds) of uninterrupted rolling with perfect 16-frame timing
- Long straight areas (e.g., Mine Cart levels) make high chain counts feasible
- **Trade-off**: Roll chains are fast but require precise timing and reduce control

**Timing & Duration:**
- **Roll animation duration**: ~24 frames (0.4 seconds @ 60fps)
- **Chain window**: Press Y within **16 frames** of roll start (0.27 seconds)
- **Recovery after roll**: ~8 frames before full control returns

**Distance Traveled per Roll (estimates):**
```
Roll from walk (2 px/frame):
  24 frames × 2 px = 48 pixels = 3 tiles

Roll from run (3 px/frame):
  24 frames × 3 px = 72 pixels = 4.5 tiles

3× Chain roll (6 px/frame, realistic max):
  24 frames × 6 px = 144 pixels = 9 tiles

Theoretical max roll (8 px/frame, after 5 chains):
  24 frames × 8 px = 192 pixels = 12 tiles (!!)
```

**Realistic Roll Usage:**
- **Single roll**: Mostly for attacking enemies (~3-4 px/frame, 4.5 tiles traveled)
- **2-3 chains**: Speedrunning segments (~5-6 px/frame, 7-9 tiles traveled)
- **4-5 chains**: Extremely rare, requires perfect conditions and timing
- **Expresso's 4 px/frame run** is often more practical than chaining rolls

### Roll Constants Summary

| Constant | Value | Meaning | Assembly Ref |
|----------|-------|---------|--------------|
| `roll_entry_min_subpx` | 0x0100 | Minimum speed to roll | (Lua side) |
| `roll_entry_dpad_subpx` | 0x0300 | Speed when rolling from D-pad input | (Lua side) |
| `roll_entry_cap_subpx` | 0x0400 | Cap initial roll speed | (Lua side) |
| `roll_chain_step_subpx` | 0x0100 | Speed bonus per chain | CODE_BFBDE7:112255 |
| `roll_chain_cap_subpx` | 0x0800 | Max roll speed | CODE_BFBDE7:112257 |
| `roll_dash_window_frames` | 0x0010 | Frames to chain next roll | (Empirical) |

**Lua Implementation:** `src/carts/esther/player.lua` (roll FSM states)

**Roll vs Walk/Run Comparison:**
- Walk smoothing: ÷64 (very slow acceleration)
- Run smoothing: ÷21.33 (medium acceleration)
- Roll smoothing: **None** (direct speed assignment, no inertia)

This is why rolling feels **immediate and snappy** compared to walking/running.

---

## Gravity System

### Gravity State Machine

```
┌─────────────────┐
│  Jump Started   │
│  Flag $0002 Set │
└────────┬────────┘
         │
         │ Holding Jump Button
         ▼
┌─────────────────────┐
│  Hold Gravity       │
│  $FFB8 (DK)         │
│  $FFA6 (Diddy)      │
└────────┬────────────┘
         │
         │ Release Jump Button → Clear $0002
         ▼
┌─────────────────────┐
│  Release Gravity    │
│  $FF90              │
│  (Faster fall)      │
└────────┬────────────┘
         │
         │ Y Speed < $F800
         ▼
┌─────────────────────┐
│  Clamp to Max Fall  │
│  $F800 (-8.0 px)    │
└─────────────────────┘
```

**Implementation:** `src/carts/esther/player.lua:622-635` (CODE_BFAF38_AIR_GRAVITY)

---

## Horizontal Control Flow

### Ground Control

```
Input Sampling (CODE_BFB27C)
    ↓
Left/Right/Neutral Detection
    ↓
    ├─ Left  → Set target = -walk_speed or -run_speed
    ├─ Right → Set target = +walk_speed or +run_speed
    └─ Neutral → Set target = 0 (decelerate)
    ↓
Profile Selection (CODE_BFB159)
    ├─ Run flag set → Profile 8 (÷21)
    └─ Run flag clear → Profile 3 (÷64)
    ↓
Smoothing (DATA_BFB255)
    Approach target speed via LSR division
    ↓
Update X Speed
```

### Air Control

```
Input Sampling
    ↓
Left/Right/Neutral Detection
    ↓
    ├─ Left  → Set target = -walk_speed or -run_speed
    ├─ Right → Set target = +walk_speed or +run_speed
    └─ Neutral → DO NOTHING (CODE_BFBA39 returns immediately)
                 Target remains unchanged!
    ↓
Profile = 0 (÷8, fast response)
    ↓
Smoothing
    Approach target speed via LSR division
    ↓
Update X Speed
```

**Key Difference:** Neutral input in air does **not** change target speed, preserving momentum!

### Critical Implementation Updates (2026-02-10)

1.  **Fundamental Input Bug Fixed**
    *   **Problem**: Joypad bit masks were incorrectly defined (left/right shared bits with X/A).
    *   **Fix**: Corrected masks to standard SNES bits: `joypad_dpadl = 0x0200` (bit 9), `joypad_dpadr = 0x0100` (bit 8).
    *   **Impact**: D-pad input now registers correctly; `code_bfb27c` directional branches finally execute.

2.  **Native Action Mapping**
    *   To ensure responsiveness in the BMSX engine, assembly routines now call `action_triggered()` directly instead of relying on manually synced memory flags.
    *   `code_bfb27c` (Ground/Air Control) now uses `action_triggered('left[p]')` and `right[p]`.
    *   `code_bfb4e3` (Target Speed) uses `action_triggered('y[p]')` to switch between walk and run targets.

3.  **Profile 3 Deceleration (The "Sliding" Factor)**
    *   **Observation**: From full walk speed (0x0200), Profile 3 (÷64) takes **166 frames** (~2.8 seconds) to reach 0.
    *   **Assembly Match**: This "heavy" feel is authentic to DKC1 ground movement.
    *   **Trigger**: Profile 3 is only used if `ram_ramtable12a5lo` (grounded flag) is set. Otherwise, it defaults to Profile 0 (÷8), which stops in ~20 frames.

4.  **Air Neutral Persistence**
    *   **Verified**: `CODE_BFBA39` (Air Neutral) is a literal `RTS`.
    *   **Behavior**: Releasing the D-pad in mid-air *must not* reset the target speed. The target speed from the last directional press is preserved, maintaining momentum until landing.

5.  **BEQ Instant-Snap Logic**
    *   Successfully implemented the assembly optimization where `step == 0` triggers an instant snap to the target speed. This prevents infinite asymptotic approaches and ensures the player actually reaches 0 when decelerating.

---

## Implementation Notes

### Critical Findings

1. **Air Neutral Handler is Empty**
   `CODE_BFBA39` does nothing (`RTS` immediately). This is the key to DKC's committed jump arc.

2. **Ground Jump Initial Velocity Not in CODE_BFB94F**
   The routine sets up flags and gravity, but the initial Y velocity ($0600) is likely set by animation script $00C1. This is an educated guess based on empirical testing.

3. **Profile 8 Uses Addition, Not Cascading LSR**
   Unlike profiles 0-7 which are pure bit shifts, profile 8 adds (÷32) + (÷64) to create ÷21.33.

4. **Subpixel Precision is Essential**
   All intermediate calculations must remain in subpixel space. Converting to pixels prematurely causes rounding errors that accumulate.

5. **Run Flag ($1699 & $0004) Controls Profile**
   This flag determines if the player uses walk inertia (heavy) or run inertia (medium). It's set by Y-button logic (not shown in this reference).

### Jump Height Calculations

**Ground Jump (Full Hold):**
```
Initial velocity: v₀ = 0x0600 = 1536 subpixels/frame = 6.0 px/frame
Gravity (hold):   g  = 0x0048 = 72 subpixels/frame²  = 0.28125 px/frame²
Frames to apex:   t  = v₀/g = 1536/72 ≈ 21.33 frames
Max height:       h  = v₀²/(2g) = 1536²/(2×72) = 16,384 subpixels = 64 pixels
```

**Rope/Bounce Jump (Full Hold):**
```
Initial velocity: v₀ = 0x0700 = 1792 subpixels/frame = 7.0 px/frame
Gravity (hold):   g  = 0x0048 = 72 subpixels/frame²  = 0.28125 px/frame²
Frames to apex:   t  = v₀/g = 1792/72 ≈ 24.89 frames
Max height:       h  = v₀²/(2g) = 1792²/(2×72) ≈ 22,300 subpixels = 87 pixels
```

**Short Jump (Early Release):**
When the jump button is released, gravity changes to `-0x0070` (release gravity), which is ~1.56× stronger. This dramatically reduces the jump arc height. Minimum jump height is approximately **16-24 pixels** depending on release timing.

### Testing Checklist

- [ ] Walk speed matches DKC (slow acceleration)
- [ ] Run speed matches DKC (medium acceleration)
- [ ] Air control is responsive (÷8 profile)
- [ ] Jump height from ground is ~64 pixels (full hold)
- [ ] Rope/bounce jump height is ~87 pixels (full hold)
- [ ] Short jump (early release) reaches ~16-24 pixels
- [ ] Releasing jump early reduces height appropriately
- [ ] Neutral input in air preserves momentum
- [ ] Neutral input on ground decelerates to stop
- [ ] Roll maintains speed without drift

### Known Approximations

1. **`jump_ground_subpx = 0x0600`**
   This value is estimated. The actual value may be set via animation events. Adjust if jump height is incorrect.

2. **Profile Usage May Vary by State**
   The code shows state IDs $04 and $09 as "grounded movement." Other states (climbing, swimming, etc.) may use different profiles.

3. **Diddy Speed Multiplier Not Implemented**
   Assembly shows Diddy gets 1.125× speed via `(speed + speed>>3)`. Not yet added to Lua implementation.

### Future Work

- [ ] Investigate animation script $00C1 for actual ground jump velocity
- [ ] Implement Diddy speed multiplier (×1.125)
- [ ] Add roll momentum system
- [ ] Add hand slap / ground pound
- [ ] Port barrel throwing physics

---

## Quick Reference Table

| Assembly Label | File Location | Line | Lua Function | Description |
|----------------|---------------|------|--------------|-------------|
| `CODE_BFB159` | `Routine_Macros_DKC1.asm` | 110537 | `select_ground_profile()` | Profile selection |
| `DATA_BFB255` | `Routine_Macros_DKC1.asm` | 110688 | `profile_step()` | Divisor table |
| `CODE_BFB94F` | `Routine_Macros_DKC1.asm` | 111659 | `CODE_BFB94F_START_JUMP()` | Ground jump |
| `CODE_BFBA88` | `Routine_Macros_DKC1.asm` | 111806 | `CODE_BFBA88_START_JUMP()` | Rope jump |
| `CODE_BFBA39` | `Routine_Macros_DKC1.asm` | 111765 | (in `apply_horizontal_control()`) | Air neutral (does nothing) |
| `CODE_BFAF38` | `Routine_Macros_DKC1.asm` | 110236 | `CODE_BFAF38_AIR_GRAVITY()` | Gravity application |
| `CODE_BFB27C` | `Routine_Macros_DKC1.asm` | 110733 | `sample_input()` + `apply_horizontal_control()` | Input processing |

---

**End of Reference Document**
*Last Updated: 2026-02-10*
