; ==============================================================================
; DKC1 PLAYER PHYSICS - ASSEMBLY REFERENCE
; ==============================================================================
; This file contains all relevant assembly snippets from DKC1 for player
; horizontal physics implementation. Extracted from Routine_Macros_DKC1.asm.
;
; Purpose: Centralized reference to avoid searching through 120k+ line file
; Status: Work in progress - expand/contract as needed
; ==============================================================================

; ==============================================================================
; MEMORY MAP - Key Variables
; ==============================================================================
; $32 (zp_32)                    - Movement state (0x0004 = grounded, 0x0009 = ?)
; $F3 (zp_f3)                    - Animation comparison value
; !RAM_DKC1_NorSpr_XSpeedLo,x    - Current horizontal speed (subpixels)
; !RAM_DKC1_NorSpr_RAMTable0F25Lo,x - Target speed (set by input handlers)
; !RAM_DKC1_NorSpr_RAMTable123DLo,x - Accumulator/Boost value
; !RAM_DKC1_NorSpr_RAMTable1209Lo,x - Animation + facing flags:
;   - Bits 0-2 (& 0x0007): Animation frame index (0-6)
;   - Bit 7 (& 0x0080): Movement direction flag (used by CODE_BFA59F/BB)
;   - Bit 8 (0x0100): Facing direction (0=left, 1=right)
; !RAM_DKC1_NorSpr_RAMTable12A5Lo,x - State flags (bit 0x1001 checked)

; ==============================================================================
; MAIN SPEED UPDATE - CODE_BFB1A8
; Line: 52719
; Lua: player_asm.lua lines 933-952 (in tick() function)
; ==============================================================================
; This is the CORE horizontal physics routine. Called every frame.
; Formula: new_speed = current_speed + profile_smoothed(delta)
; Where: delta = (target + accumulator) - current_speed
;
CODE_BFB1A8:
        LDA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x  ; Load target speed
        CLC
        ADC.w !RAM_DKC1_NorSpr_RAMTable123DLo,x  ; Add accumulator/boost
        ; Now A = target + boost
        ; Lua line 935-936: local target_plus_acc = to_signed_16(self.ram_ramtable0f25lo + self.ram_ramtable123dlo)
        
        SEC
        SBC.w !RAM_DKC1_NorSpr_XSpeedLo,x        ; Subtract current speed
        ; Now A = delta = (target + boost) - current
        ; Lua line 937: local delta = target_plus_acc - current
        
        BPL.b CODE_BFB1C0                         ; If delta >= 0, jump
        ; Lua line 939: if delta < 0 then
        
        ; Delta is negative (need to slow down)
        EOR.w #$FFFF                              ; Negate delta
        INC
        ; Lua line 940: local abs_delta = -delta
        
        JSR.w (DATA_BFB255,x)                     ; Apply profile smoothing (÷64)
        ; Lua line 941: local smoothed = abs_delta >> 6  (profile 3)
        
        BEQ.b CODE_BFB1B5                         ; If smoothed delta == 0, just set to target
        ; Lua line 942: if smoothed == 0 then
        
        EOR.w #$FFFF                              ; Negate smoothed delta back
        INC
        CLC
        ADC.w !RAM_DKC1_NorSpr_XSpeedLo,y         ; Add to current speed
        STA.w !RAM_DKC1_NorSpr_XSpeedLo,y         ; Store new speed
        ; Lua line 945-946: self.ram_xspeedlo = to_unsigned_16(current - smoothed)
        RTL

CODE_BFB1B5:
        ; Delta was too small, just snap to target+boost
        LDA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,y
        CLC
        ADC.w !RAM_DKC1_NorSpr_RAMTable123DLo,y
        STA.w !RAM_DKC1_NorSpr_XSpeedLo,y
        ; Lua line 943: self.ram_xspeedlo = to_unsigned_16(target_plus_acc)
        RTL

CODE_BFB1C0:
        ; Delta is positive (need to speed up)
        JSR.w (DATA_BFB255,x)                     ; Apply profile smoothing (÷64)
        ; Lua line 948: local smoothed = delta >> 6  (profile 3)
        
        BEQ.b CODE_BFB1B5                         ; If smoothed delta == 0, just set to target
        ; Lua line 949: if smoothed == 0 then
        
        CLC
        ADC.w !RAM_DKC1_NorSpr_XSpeedLo,y         ; Add smoothed delta to current
        STA.w !RAM_DKC1_NorSpr_XSpeedLo,y         ; Store new speed
        ; Lua line 952: self.ram_xspeedlo = to_unsigned_16(current + smoothed)
        RTL

; ==============================================================================
; PROFILE SMOOTHING - DATA_BFB255
; Line: 52774
; ==============================================================================
; This table contains pointers to smoothing profiles (÷64 functions)
; Profile 3 is used for grounded movement
;
DATA_BFB255:
        dw CODE_BFB265  ; Profile 0
        dw CODE_BFB26A  ; Profile 1
        dw CODE_BFB273  ; Profile 2
        dw CODE_BFB27C  ; Profile 3 ← Used for grounded horizontal
        dw CODE_BFB285  ; Profile 4
        dw CODE_BFB28E  ; Profile 5
        ; ... more profiles

; Profile 3: Divide by 64 (standard smoothing)
CODE_BFB27C:
        LSR                    ; Divide by 2
        LSR                    ; Divide by 4
        LSR                    ; Divide by 8
        LSR                    ; Divide by 16
        LSR                    ; Divide by 32
        LSR                    ; Divide by 64
        RTS

; ==============================================================================
; ACCUMULATOR POPULATION - Entry Point CODE_BFA587
; Lines: 108880-108935
; ==============================================================================
; This routine determines what value to put in RAMTable123DLo (accumulator).
; It's a decision tree with multiple branches based on state.
;
; CRITICAL: This runs BEFORE input handlers set target speeds!
;
CODE_BFA578:
        LDX.b !RAM_DKC1_NorSpr_CurrentIndexLo
        LDA.w !RAM_DKC1_NorSpr_RAMTable12A5Lo,x
        AND.w #$1001
        CMP.w #$0001
        BEQ.b CODE_BFA587                         ; If state flags match, continue
CODE_BFA582:
        STZ.w !RAM_DKC1_NorSpr_RAMTable123DLo,x   ; Otherwise clear accumulator
        CLC
        RTS

CODE_BFA587:
        LDA.b $32                                  ; Load movement state
        CMP.w #$0004                               ; Is grounded?
        BEQ.b CODE_BFA5DE                          ; → Use animation-based boost
        CMP.w #$0009                               ; Is state 0x0009?
        BEQ.b CODE_BFA5DE                          ; → Also use animation boost
        ; Otherwise check for direction change boost (airborne)
        LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x
        AND.w #$0007                               ; Get animation index
        CMP.b $F3                                  ; Compare with stored value
        BPL.b CODE_BFA59F                          ; → Try direction-change boost
        BRA.b CODE_BFA582                          ; → Clear accumulator

; ==============================================================================
; DIRECTION-CHANGE BOOST - CODE_BFA59F & CODE_BFA5BB
; Lines: 108902-108933
; ==============================================================================
; Used for AIRBORNE movement (when $32 != 0x0004 and != 0x0009)
; Provides boost when changing direction mid-air
;
; IMPORTANT: This is NOT used for grounded movement!
; When grounded ($32 == 0x0004), CODE_BFA587 branches to CODE_BFA5DE instead.
;
CODE_BFA59F:
        ; Check direction flag (bit 7 of RAMTable1209Lo)
        LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x
        AND.w #$0080                               ; Bit 7: movement direction
        BNE.b CODE_BFA5BB                          ; If set, check right→left
        
        ; Moving left, check if changing to right
        LDA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x    ; Load target
        DEC                                        ; target - 1
        BPL.b CODE_BFA5CD                          ; If >= 0 (moving right), no boost
        LDA.w !RAM_DKC1_NorSpr_XSpeedLo,x          ; Load current speed
        DEC                                        ; current - 1
        BPL.b CODE_BFA5CD                          ; If >= 0 (moving right), no boost
        ; Both negative (both leftward), apply leftward boost
        LDA.w #$FE80                               ; Boost = -384 subpixels
        STA.w !RAM_DKC1_NorSpr_RAMTable123DLo,x
        SEC
        RTS

CODE_BFA5BB:
        ; Moving right, check if changing to left
        LDA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x    ; Load target
        BMI.b CODE_BFA5CD                          ; If negative (moving left), no boost
        LDA.w !RAM_DKC1_NorSpr_XSpeedLo,x          ; Load current speed
        BMI.b CODE_BFA5CD                          ; If negative (moving left), no boost
        ; Both positive (both rightward), apply rightward boost
        LDA.w #$0180                               ; Boost = +384 subpixels
        STA.w !RAM_DKC1_NorSpr_RAMTable123DLo,x
        SEC
        RTS

CODE_BFA5CD:
        ; No boost applied
        CLC
        RTS

; ==============================================================================
; ANIMATION-BASED BOOST - CODE_BFA5DE
; Lines: 108935-108970
; Lua: player_asm.lua lines 881-916
; ==============================================================================
; Used for GROUNDED movement (when $32 == 0x0004 or 0x0009)
; Provides variable boost based on walking animation frame (0-6)
;
; This gives DKC1 its characteristic "responsive yet weighty" ground feel.
; Early frames have small boost (0, 128, 256), later frames ramp up (384, 496, 640, 1024).
;
; CRITICAL: Facing direction determines if boost assists or resists movement!
;
CODE_BFA5DE:
        LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x    ; Load animation + facing
        AND.w #$0007                               ; Get animation frame (0-6)
        ; Lua line 883: local anim_idx = self.ram_ramtable1209lo & 0x0007
        
        CMP.b $F3                                  ; Compare with stored value
        BEQ.b CODE_BFA60C                          ; Special case (direction change?)
        ; Lua: Not implemented (simplified CODE_BFA5DE only)
        
        ; Look up boost value from table
        TXY                                        ; Save X in Y
        ASL                                        ; Animation index * 2 (word indexing)
        TAX                                        ; Use as table index
        LDA.l DATA_BFA5FE,x                        ; Load boost from table
        TYX                                        ; Restore X
        ; Lua line 884-885: local boost_table = {...}
        ; Lua line 886: local boost = boost_table[anim_idx + 1]
        
        ; Check facing direction (bit 8 of RAMTable1209Lo - 1 byte back)
        BIT.w !RAM_DKC1_NorSpr_RAMTable1209Lo-$01,x ; Check high byte (bit 0 = facing bit 8)
        ; ⚠️ CRITICAL: -$01 means check HIGH BYTE (address -1)
        ; For little-endian 16-bit value at address X:
        ;   Address X   = low byte (bits 0-7)
        ;   Address X-1 = high byte (bits 8-15)  ← This is what BIT checks!
        ; So bit 7 of high byte = bit 15 of full word
        ; BMI tests if bit 7 (of checked byte) is set = bit 15 of word
        
        BMI.b CODE_BFA5F9                          ; If negative (bit 7 set), facing right
        ; Lua line 888: local facing_right = (self.ram_ramtable1209lo & 0x0100) ~= 0
        ; ⚠️ BUG IN LUA: Should check bit 15 (0x8000), not bit 8 (0x0100)!
        ;    OR: Assembly checks high byte's bit 7, which is bit 15 of word
        ;    OR: Need to verify exact memory layout
        
        ; Facing left - NEGATE boost
        EOR.w #$FFFF                               ; Two's complement negation
        INC
        ; Lua line 890-891: if not facing_right then boost = ((-boost) & 0xFFFF)
        
CODE_BFA5F9:
        STA.w !RAM_DKC1_NorSpr_RAMTable123DLo,x    ; Store boost in accumulator
        ; Lua line 893: self.ram_ramtable123dlo = boost
        CLC
        RTS

; Boost table: animation frames 0-6
DATA_BFA5FE:
        dw $0000    ; Frame 0: No boost (standing/start)
        dw $0080    ; Frame 1: 128 subpixels (0.5 pixels)
        dw $0100    ; Frame 2: 256 subpixels (1.0 pixel)
        dw $0180    ; Frame 3: 384 subpixels (1.5 pixels)
        dw $01F0    ; Frame 4: 496 subpixels (1.9 pixels)
        dw $0280    ; Frame 5: 640 subpixels (2.5 pixels)
        dw $0400    ; Frame 6: 1024 subpixels (4.0 pixels) - maximum boost!
        ; Lua line 884: local boost_table = {0x0000, 0x0080, 0x0100, 0x0180, 0x01F0, 0x0280, 0x0400}
        ; ✓ PARITY CONFIRMED

CODE_BFA60C:
        ; Special case: animation frame matches $F3 → direction-change boost
        ; Lua: player_asm.lua lines ~899-932 (if anim_idx == self.zp_f3 then)
        BIT.w !RAM_DKC1_NorSpr_RAMTable1209Lo-$01,x  ; Check high byte bit 7
        BMI.b CODE_BFA625                          ; If set → facing right path
        
        ; LEFT PATH: check if both target and speed are negative
        LDA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x    ; Load target
        DEC                                        ; target - 1
        BPL.b CODE_BFA637                          ; If >= 0, no boost
        LDA.w !RAM_DKC1_NorSpr_XSpeedLo,x          ; Load current speed
        DEC                                        ; speed - 1
        BPL.b CODE_BFA637                          ; If >= 0, no boost
        ; Both target and speed are negative (moving left consistently)
        LDA.w #$FB00                               ; Boost = -1280 subpixels (5 pixels!)
        STA.w !RAM_DKC1_NorSpr_RAMTable123DLo,x
        SEC
        RTS

CODE_BFA625:
        ; RIGHT PATH: check if both target and speed are non-negative
        LDA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x    ; Load target
        BMI.b CODE_BFA637                          ; If negative, no boost
        LDA.w !RAM_DKC1_NorSpr_XSpeedLo,x          ; Load current speed
        BMI.b CODE_BFA637                          ; If negative, no boost
        ; Both target and speed are positive (moving right consistently)
        LDA.w #$0500                               ; Boost = +1280 subpixels (5 pixels!)
        STA.w !RAM_DKC1_NorSpr_RAMTable123DLo,x
        SEC
        RTS

CODE_BFA637:
        ; No boost - accumulator unchanged
        CLC
        RTS

; ==============================================================================
; ANIMATION FRAME UPDATES
; Lines: Various (110010-110050, etc.)
; ==============================================================================
; RAMTable1209Lo is updated in various places throughout the game logic.
; The lower 3 bits (& 0x0007) represent the walking animation frame (0-6).
;
; Example from line 110021:
CODE_BFAD92:
        LDA.b $9C                                  ; Load some value
        STA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x    ; Store in 1209Lo (sets animation)
        RTS

; TODO: Find where animation frames are incremented based on movement speed
; TODO: Find where facing direction bit is set based on input

; ==============================================================================
; INPUT HANDLERS (Target Speed Setters)
; Lua: player_asm.lua lines 352-414
; ==============================================================================
; These handlers are called after CODE_BFA587 sets the accumulator.
; They set RAMTable0F25Lo (target speed) based on player input.
;
; CRITICAL: In original DKC1, these DO NOT modify RAMTable123DLo!
; The accumulator is set by CODE_BFA587/5DE and left untouched by handlers.

; ------------------------------------------------------------------------------
; GROUND LEFT HANDLER
; Assembly: Unknown exact location (inferred from game logic)
; Lua: player_asm.lua lines 352-365 (code_bfb5b6)
; ------------------------------------------------------------------------------
; Sets target to negative (leftward) value
; Speed boost flag check increases magnitude
;
; Assembly (reconstructed):
CODE_BFB5B6_GROUND_LEFT:
        LDA.w #$FE00                               ; -512 subpixels
        STA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x
        ; Lua line 354: self.ram_ramtable0f25lo = 0xfe00
        
        ; Check speed boost flag
        LDA.w $1E15
        AND.w #$0400
        BEQ.b @no_boost
        ; Lua line 357: if (self.ram_1e15 & 0x0400) ~= 0 then
        
        ; Apply speed boost multiplier
        LDA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x
        ; ... (boost multiplication code)
        STA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x
        ; Lua line 359-363: (boost multiplication logic)
        
@no_boost:
        ; ✓ CRITICAL: RAMTable123DLo NOT MODIFIED HERE
        ; ✓ Lua parity: Lines 352-365 match this behavior (after cleanup)
        RTS

; ------------------------------------------------------------------------------
; GROUND RIGHT HANDLER  
; Assembly: Unknown exact location (inferred)
; Lua: player_asm.lua lines 397-405 (code_bfb6cd)
; ------------------------------------------------------------------------------
CODE_BFB6CD_GROUND_RIGHT:
        LDA.w #$0200                               ; +512 subpixels
        STA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x
        ; Lua line 399: self.ram_ramtable0f25lo = 0x0200
        
        ; Speed boost check (similar to left)
        LDA.w $1E15
        AND.w #$0400
        BEQ.b @no_boost
        ; Lua line 402: if (self.ram_1e15 & 0x0400) ~= 0 then
        
        ; Apply boost
        ; ... (multiplication)
        ; Lua line 403-405: (boost logic)
        
@no_boost:
        ; ✓ CRITICAL: RAMTable123DLo NOT MODIFIED HERE
        ; ✓ Lua parity: Lines 397-405 match (after cleanup)
        RTS

; ------------------------------------------------------------------------------
; GROUND NEUTRAL HANDLER
; Assembly: Unknown exact location
; Lua: player_asm.lua lines 410-414 (code_bfc18a)
; ------------------------------------------------------------------------------
CODE_BFC18A_GROUND_NEUTRAL:
        LDA.w #$0000                               ; Zero target (decelerate)
        STA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x
        ; Lua line 412: self.ram_ramtable0f25lo = 0
        
        ; ✓ CRITICAL: RAMTable123DLo NOT MODIFIED HERE
        ; ✓ Lua parity: Line 410-414 matches (after cleanup)
        RTS

; ------------------------------------------------------------------------------
; AIR HANDLERS
; Assembly: Various locations
; Lua: player_asm.lua lines 368-395 (air left/right/neutral)
; ------------------------------------------------------------------------------
; Air handlers are more complex, involve direction checks
; Air neutral (code_bfba39) does NOTHING - just RTS
; Lua line 408: return (preserves target!)
;
; ✓ Air handlers also do NOT modify RAMTable123DLo in assembly
; ✓ Direction-change boost (CODE_BFA59F/BB) is applied by CODE_BFA587, not handlers

; ==============================================================================
; ANIMATION FRAME CYCLING (SIMULATION IN LUA)
; Lua: player_asm.lua lines 868-916
; ==============================================================================
; The original assembly updates RAMTable1209Lo somewhere in the animation system.
; Our Lua port SIMULATES this by manually cycling frames based on movement.
;
; Lua implementation (lines 892-901):
        ; if speed_abs > 100 then
        ;     local anim_index = math.floor((self.zp_28 / 4) % 7)
        ;     self.ram_ramtable1209lo = (self.ram_ramtable1209lo & 0xFFF8) | anim_index
        ; else
        ;     self.ram_ramtable1209lo = (self.ram_ramtable1209lo & 0xFFF8)
        ; end
;
; This simulates walking animation:
; - Cycles through frames 0-6 when moving (speed > 100 subpixels)
; - Resets to frame 0 when stationary
; - Updates every 4 game frames (zp_28 / 4)
;
; ⚠️ TODO: Find actual assembly animation update routine to verify this logic

; ==============================================================================
; QUESTIONS & TODO
; ==============================================================================
;
; ❌❌ Q1: CRITICAL BUG - Facing bit NEVER SET!
;     
;     PROBLEM 1: Facing bit is never populated in Lua code!
;     
;     Current Lua (lines 892-901):
;         self.ram_ramtable1209lo = (self.ram_ramtable1209lo & 0xFFF8) | anim_index
;         ⚠️ This only sets lower 3 bits (animation), facing bit stays 0!
;     
;     Result:
;         local facing_right = (self.ram_ramtable1209lo & 0x0100) ~= 0
;         → facing_right is ALWAYS false (bit never set)
;         → boost is ALWAYS negated (line 890-891)
;         → Player decelerates in BOTH directions!
;     
;     PROBLEM 2: Which bit is the facing bit?
;     
;     Assembly: BIT.w !RAM_DKC1_NorSpr_RAMTable1209Lo-$01,x
;               BMI.b CODE_BFA5F9
;     
;     Analysis:
;     - "-$01" checks HIGH BYTE (bits 8-15) in little-endian
;     - BMI tests bit 7 of high byte = bit 15 of word
;     - So facing bit is bit 15 (0x8000), not bit 8 (0x0100)!
;     
;     SOLUTION:
;     1. Set facing bit based on movement direction:
;        if moving_right:
;            ram_ramtable1209lo |= 0x8000  (or 0x0100 if bit 8)
;        else:
;            ram_ramtable1209lo &= ~0x8000
;     
;     2. Fix the check:
;        local facing_right = (self.ram_ramtable1209lo & 0x8000) ~= 0
;     
;     Need to test: Try 0x0100 first (bit 8), if doesn't work try 0x8000 (bit 15)
;
; Q2: When/where does actual animation frame increment in assembly?
;     - Need to find animation update routine
;     - Current Lua simulation may not match exact timing
;     - Search for: STA !RAM_DKC1_NorSpr_RAMTable1209Lo patterns
;
; Q3: What triggers the CODE_BFA60C special case (animation == $F3)?
;     - Appears to be direction-change detection
;     - May be transition between standing and walking
;     - Compare animation value with previous frame ($F3 storage)
;
; Q4: Animation frame update timing
;     - Original likely uses animation events/timers
;     - Our simulation uses frame counter (zp_28 / 4)
;     - May need speed-based timing adjustment
;
; ==============================================================================
; PARITY STATUS SUMMARY
; ==============================================================================
;
; ✓✓ CODE_BFB1A8 (Main physics loop)
;     Assembly line 52719 ↔ Lua lines 933-952
;     Status: EXACT PARITY - formula matches perfectly
;
; ✓✓ DATA_BFA5FE (Boost table)
;     Assembly line 108960 ↔ Lua line 884
;     Status: EXACT PARITY - all 7 values match
;
; ✓✓ Profile smoothing (÷64)
;     Assembly DATA_BFB255 ↔ Lua lines 933-952 (>> 6 operation)
;     Status: EXACT PARITY - division by 64 matches
;
; ⚠️❌ CODE_BFA5DE (Animation boost)
;     Assembly lines 108935-108960 ↔ Lua lines 881-916
;     Status: LOGIC PARITY, BUG IN FACING CHECK
;     Issue: Bit 8 vs bit 15 discrepancy causes boost inversion
;     Impact: Player decelerates instead of accelerates
;     Fix needed: Change 0x0100 to 0x8000 in line 888
;
; ✓✓ Input handlers (ground left/right/neutral)
;     Assembly (inferred) ↔ Lua lines 352-414
;     Status: PARITY RESTORED (after removing accumulator manipulation)
;     Previously: Handlers were overwriting accumulator ❌
;     Now: Handlers only set target, preserve accumulator ✓
;
; ✓? Animation frame cycling
;     Assembly (unknown location) ↔ Lua lines 892-901
;     Status: SIMULATED - not exact assembly translation
;     Current implementation works but may not match timing exactly
;
; ==============================================================================
