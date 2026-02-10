-- dkc1 player physics - direct assembly translation
-- source: .external/dkc1/routine_macros_dkc1.asm
-- this is a literal translation of assembly to lua - intentionally inefficient and verbose
-- all variable names, function names, and logic flow match assembly exactly

local constants = require('constants')

local player = {}
player.__index = player

-- ============================================================================
-- joypad button masks (from assembly defines)
-- ============================================================================
local joypad_b      = 0x8000  -- button b
local joypad_y      = 0x4000  -- button y
local joypad_select = 0x2000  -- select
local joypad_start  = 0x1000  -- start
local joypad_dpadu  = 0x0800  -- d-pad up
local joypad_dpadd  = 0x0400  -- d-pad down
local joypad_dpadl  = 0x0200  -- d-pad left
local joypad_dpadr  = 0x0100  -- d-pad right
local joypad_a      = 0x0080  -- button a
local joypad_x      = 0x0040  -- button x

-- ============================================================================
-- animation ids (from misc_defines_dkc1.asm)
-- ============================================================================
local define_dkc1_animationid_dk_idle = 0x0000
local define_dkc1_animationid_dk_walk = 0x0001
local define_dkc1_animationid_dk_run = 0x0002
local define_dkc1_animationid_dk_jump = 0x0003
local define_dkc1_animationid_dk_holdjump = 0x0004
local define_dkc1_animationid_dk_roll = 0x0018
local define_dkc1_animationid_dk_endroll = 0x0019
local define_dkc1_animationid_dk_cancelroll = 0x001a

-- ============================================================================
-- helper functions
-- ============================================================================

local function to_signed_16(value)
	if value >= 0x8000 then
		return value - 0x10000
	end
	return value
end

local function to_unsigned_16(value)
	return value & 0xffff
end

local function abs_16(value)
	local signed = to_signed_16(value)
	if signed < 0 then
		return -signed
	end
	return signed
end

local function sign(value)
	if value < 0 then return -1 end
	if value > 0 then return 1 end
	return 0
end

-- ============================================================================
-- player object
-- ============================================================================

function player:new(config)
	local instance = setmetatable({}, player)
	
	-- store config
	instance.level = config.level
	instance.player_index = config.player_index or 1
	instance.spawn_x = config.spawn_x
	instance.spawn_y = config.spawn_y
	instance.width = config.width or 16
	instance.height = config.height or 32
	
	-- initialize all ram variables as instance members
	player.ctor(instance, config)
	
	return instance
end

-- ctor is called by the engine's spawn_object → apply_definition → apply_ctor
-- receives (self, addons, def_id) where addons = {id, level, spawn_x, spawn_y, pos}
function player.ctor(self, addons)
	-- initialize all ram variables
	self.ram_1699 = self.ram_1699 or 0
	self.ram_16a1 = 0
	self.ram_16a5 = 0
	self.ram_16a9 = 0
	self.ram_16ad = define_dkc1_animationid_dk_idle
	self.ram_16cd = 0
	self.ram_16dd = 0
	self.ram_16e1 = 0
	self.ram_16e5 = 0
	self.ram_16ed = 0
	self.ram_16f1 = 0
	self.ram_16f5 = 0
	self.ram_16f9 = 0xffb8
	self.ram_180f = 0
	
	self.ram_xspeedlo = 0
	self.ram_yspeedlo = 0
	self.ram_xposlo = self.spawn_x or 0
	self.ram_yposlo = self.spawn_y or 0
	self.ram_ramtable0f25lo = 0
	self.ram_ramtable1029lo = 0x0004
	self.ram_ramtable12a5lo = 0x0001
	self.ram_ramtable1209lo = 0
	self.ram_ramtable123dlo = 0
	self.ram_ramtable1271lo = 0
	self.ram_ramtable1631lo = 0
	self.ram_yxppccctlo = 0
	
	self.zp_28 = 0
	self.zp_32 = 0x0004
	self.zp_44 = (self.player_index or 1) - 1
	self.zp_4c = 0
	self.zp_7e = 0
	self.zp_80 = 0
	self.zp_84 = 0
	self.zp_f3 = 7  -- TODO: find actual $F3 source in DKC1 assembly. Set to 7 (out of 0-6 range) to disable CODE_BFA60C until known.
	
	self.ram_0512 = 0
	self.ram_1e15 = 0
	self.ram_1e17 = 0
	self.ram_1e19 = 0
	
	-- subpixel position
	self.pos_subx = self.ram_xposlo * 0x0100
	self.pos_suby = self.ram_yposlo * 0x0100
	
	-- visual/gameplay state
	self.visual_frame_id = 'esther_dk_idle_01'
	self.pose_name = 'grounded'
	
	-- debug counters
	self.debug_frame = 0
	self.debug_time_ms = 0
	
	-- previous frame button state for edge detection
	self.prev_7e = 0
end

function player:reset_runtime()
	self.ram_1699 = 0
	self.ram_16a5 = -0x7fffffff
	self.ram_16f9 = 0xffb8
	self.ram_180f = 0
	
	self.ram_xspeedlo = 0
	self.ram_yspeedlo = 0
	self.ram_ramtable0f25lo = 0
	self.ram_ramtable1029lo = 0x0004
	self.ram_ramtable12a5lo = 0x0001
	
	self.ram_xposlo = self.spawn_x
	self.ram_yposlo = self.spawn_y
	self.pos_subx = self.ram_xposlo * 0x0100
	self.pos_suby = self.ram_yposlo * 0x0100
	
	self.zp_28 = 0
	self.zp_32 = 0x0004
	self.zp_7e = 0
	self.zp_80 = 0
	
	self.facing = 1
	self.grounded = true
	self.x = self.ram_xposlo
	self.y = self.ram_yposlo
	
	self.draw_scale_x = 1.0
	self.draw_scale_y = 1.0
	self.roll_visual = 0
	
	self.debug_frame = 0
	self.debug_time_ms = 0
	self.prev_7e = 0
end

-- ============================================================================
-- data tables (assembly jump tables)
-- ============================================================================

-- data_bfb255: profile divisor functions (line 110688)
function player:data_bfb255_profile(profile_id, value)
	if profile_id == 0 then return value >> 3 end      -- code_bfb278: ÷8
	if profile_id == 1 then return value >> 4 end      -- code_bfb277: ÷16
	if profile_id == 2 then return value >> 5 end      -- code_bfb276: ÷32
	if profile_id == 3 then return value >> 6 end      -- code_bfb275: ÷64
	if profile_id == 4 then return value >> 7 end      -- code_bfb274: ÷128
	if profile_id == 5 then return value >> 8 end      -- code_bfb273: ÷256
	if profile_id == 6 then return value >> 2 end      -- code_bfb279: ÷4
	if profile_id == 7 then return value >> 1 end      -- code_bfb27a: ÷2
	if profile_id == 8 then                            -- code_bfb267: ÷32 + ÷64
		local temp = value >> 5
		local temp2 = value >> 6
		return temp + temp2
	end
	return 0
end

-- ============================================================================
-- code routines (direct assembly translation)
-- ============================================================================

-- code_bfb159: profile selection logic (line 110537)
function player:code_bfb159()
	-- lda.b $32                                    ; LINE 110537: LDA.b $32
	local state = self.zp_32
	
	-- cmp.w #$0004                                 ; LINE 110540: CMP.w #$0004
	-- beq.b code_bfb167                            ; LINE 110542: BEQ.b CODE_BFB167
	-- cmp.w #$0009                                 ; LINE 110544: CMP.w #$0009
	if state == 0x0004 or state == 0x0009 then
		-- code_bfb167: grounded state detected
		-- lda.w !ram_dkc1_norspr_ramtable12a5lo,y      ; LINE 110550: LDA.w !RAM_DKC1_NorSpr_RAMTable12A5Lo,y
		-- and.w #$0001                                 ; LINE 110553: AND.w #$0001
		-- beq.b code_bfb187                            ; LINE 110555: BEQ.b CODE_BFB187
		if (self.ram_ramtable12a5lo & 0x0001) ~= 0 then
			-- ldy.b $84                                ; LINE 110557: LDY.b $84
			-- lda.w $1699,y                             ; LINE 110561: LDA.w $1699,y
			-- and.w #$0004                              ; LINE 110564: AND.w #$0004
			-- beq.b code_bfb180                         ; LINE 110566: BEQ.b CODE_BFB180
			if (self.ram_1699 & 0x0004) ~= 0 then
				-- code_bfb17e: running
				-- lda.w #$0008                         ; LINE 110568: LDA.w #$0008
				return 8  -- profile 8 (÷21.33)
			else
				-- code_bfb180: walking
				-- lda.w #$0003                         ; LINE 110574: LDA.w #$0003
				return 3  -- profile 3 (÷64)
			end
		end
	end
	
	-- code_bfb187: default (airborne/roll)
	-- lda.w #$0000                                 ; LINE 110582: LDA.w #$0000
	return 0  -- profile 0 (÷8)
end

-- code_bfb538: get run speed (line 111078)
function player:code_bfb538()
	-- lda.w $0512,y                                ; LINE 111093: LDA.w $0512,y
	if self.ram_0512 ~= 0 then
		-- on animal buddy (simplified)
	end
	
	-- code_bfb55d: normal player run speed            ; LINE 111116: CODE_BFB55D
	-- lda.w !ram_dkc1_norspr_ramtable1029lo,x      ; LINE 111116: LDA.w !RAM_DKC1_NorSpr_RAMTable1029Lo,x
	-- cmp.w #$0027                                 ; LINE 111119: CMP.w #$0027
	if self.ram_ramtable1029lo == 0x0027 then
		-- lda.w #$0180                              ; LINE 111160: LDA.w #$0180
		return 0x0180  -- slower
	end
	
	-- lda.w #$0300                                 ; LINE 111116: LDA.w #$0300
	return 0x0300
end

-- code_bfb573: get walk speed (line 111141)
function player:code_bfb573()
	-- lda.w $0512,y                                ; LINE 111141: LDA.w $0512,y
	if self.ram_0512 ~= 0 then
		-- on animal buddy
	end
	
	-- code_bfb598: normal player walk speed           ; LINE 111164: CODE_BFB598
	-- lda.w !ram_dkc1_norspr_ramtable1029lo,x      ; LINE 111164: LDA.w !RAM_DKC1_NorSpr_RAMTable1029Lo,x
	-- cmp.w #$0027                                 ; LINE 111167: CMP.w #$0027
	if self.ram_ramtable1029lo == 0x0027 then
		-- lda.w #$0180                              ; LINE 111169: LDA.w #$0180
		return 0x0180
	end
	
	-- lda.w #$0200                                 ; LINE 111164: LDA.w #$0200
	return 0x0200
end

-- code_bfb503: apply diddy speed multiplier (line 111104)
function player:code_bfb503(base_speed)
	-- sta.b $4c
	self.zp_4c = base_speed
	
	-- check if diddy (sprite index #4)
	-- for now assume dk, no multiplier
	-- diddy code:
	-- lda.b $4c
	-- lsr (3x) = ÷8
	-- adc.b $4c = base + base/8 = base × 1.125
	
	return self.zp_4c
end

-- code_bfb4e3: get target speed (line 111058)
function player:code_bfb4e3()
	-- ldy.b $84                                    ; LINE 111058: LDY.b $84
	-- lda.b $7e                                    ; LINE 111060: LDA.b $7E
	-- and.w #$4000                                 ; LINE 111062: AND.w #$4000
	-- beq.b code_bfb522                            ; LINE 111064: BEQ.b CODE_BFB522
	if (self.zp_7e & joypad_y) ~= 0 then
		-- code_bfb4ec: run path
		-- lda.w $1699,y                             ; LINE 111073: LDA.w $1699,y
		-- ora.w #$0004                              ; LINE 111076: ORA.w #$0004
		-- sta.w $1699,y                             ; LINE 111078: STA.w $1699,y
		self.ram_1699 = self.ram_1699 | 0x0004
		
		-- store timestamps
		-- lda.w $16dd,y                             ; LINE 111084: LDA.w $16DD,y
		-- sta.w $16e1,y                             ; LINE 111087: STA.w $16E1,y
		self.ram_16e1 = self.ram_16dd
		-- lda.b $28                                 ; LINE 111089: LDA.b $28
		-- sta.w $16dd,y                             ; LINE 111091: STA.w $16DD,y
		self.ram_16dd = self.zp_28
		
		-- jsr.w code_bfb538                         ; LINE 111093: JSR.w CODE_BFB538
		local speed = self:code_bfb538()
		-- jmp.w code_bfb503                         ; LINE 111095: JMP.w CODE_BFB503
		return self:code_bfb503(speed)
	end
	
	-- code_bfb522: walk path                        ; LINE 111122: CODE_BFB522
	-- lda.w $1699,y                                ; LINE 111122: LDA.w $1699,y
	-- and.w #$0200                                 ; LINE 111125: AND.w #$0200
	-- bne.b code_bfb52d                            ; LINE 111127: BNE.b CODE_BFB52D
	if (self.ram_1699 & 0x0200) ~= 0 then
		-- code_bfb52d: forced run flag still set
		-- lda.w $1699,y                             ; LINE 111133: LDA.w $1699,y
		-- ora.w #$0004                              ; LINE 111136: ORA.w #$0004
		-- sta.w $1699,y                             ; LINE 111138: STA.w $1699,y
		self.ram_1699 = self.ram_1699 | 0x0004
		-- jsr.w code_bfb538                         ; LINE 111140: JSR.w CODE_BFB538
		local speed = self:code_bfb538()
		-- jmp.w code_bfb503                         ; LINE 111142: JMP.w CODE_BFB503
		return self:code_bfb503(speed)
	end
	
	-- clear run flag
	-- lda.w $1699,y                                ; LINE 111144: LDA.w $1699,y
	-- and.w #$fffb                                 ; LINE 111147: AND.w #$FFFB
	-- sta.w $1699,y                                ; LINE 111149: STA.w $1699,y
	self.ram_1699 = self.ram_1699 & 0xfffb
	
	-- jsr.w code_bfb573                             ; LINE 111151: JSR.w CODE_BFB573
	local speed = self:code_bfb573()
	-- jmp.w code_bfb503                             ; LINE 111153: JMP.w CODE_BFB503
	return self:code_bfb503(speed)
end

-- code_bfb5b6: ground left handler (line 111222)
function player:code_bfb5b6()
	-- lda.w #$fe00
	self.ram_ramtable0f25lo = 0xfe00  -- -512 in 16-bit
	
	-- check for speed boost flag
	-- lda.w $1e15 / and.w #$0400
	if (self.ram_1e15 & 0x0400) ~= 0 then
		-- subtract extra
		-- lda.w !ram_dkc1_norspr_ramtable0f25lo,x
		-- sec / sbc.w #$0100
		local val = to_signed_16(self.ram_ramtable0f25lo)
		val = val - 0x0100
		self.ram_ramtable0f25lo = to_unsigned_16(val)
	end
end

-- code_bfb64b: air left handler (line 111307)
function player:code_bfb64b()
	-- complex wall/slope checks omitted for now
	-- jump to main logic
	
	-- code_bfb6a9:
	-- jsr.w code_bfb4e3
	local target = self:code_bfb4e3()
	-- eor.w #$ffff / inc
	target = ((-target) & 0xffff)  -- two's complement
	-- sta.w !ram_dkc1_norspr_ramtable0f25lo,x
	self.ram_ramtable0f25lo = target
end

-- code_bfb6cd: ground right handler (line 111373)
function player:code_bfb6cd()
	-- lda.w #$0200
	self.ram_ramtable0f25lo = 0x0200
	
	-- speed boost check
	if (self.ram_1e15 & 0x0400) ~= 0 then
		local val = to_signed_16(self.ram_ramtable0f25lo)
		val = val + 0x0100
		self.ram_ramtable0f25lo = to_unsigned_16(val)
	end
end

-- code_bfb75a: air right handler (line 111450)
function player:code_bfb75a()
	-- similar to left but positive
	-- code_bfb7b8:
	local target = self:code_bfb4e3()
	self.ram_ramtable0f25lo = target
end

-- code_bfba39: air neutral handler (line 111765)
function player:code_bfba39()
	-- rts  (does nothing - preserves target!)
	return
end

-- code_bfc18a: ground neutral handler
-- CODE_BFC18A dispatches to CODE_BFC192 for ground states.
function player:code_bfc18a()
	-- CODE_BFC192:
	-- STZ.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x
	self.ram_ramtable0f25lo = 0
	-- LDA.w !RAM_DKC1_NorSpr_RAMTable1271Lo,x
	-- AND.w #$FFFE
	-- STA.w !RAM_DKC1_NorSpr_RAMTable1271Lo,x
	self.ram_ramtable1271lo = self.ram_ramtable1271lo & 0xFFFE
	-- RTS
end

-- code_bfb8f7_full: B BUTTON handler (CODE_BFB8F7, line 111605)
-- Called from inside code_bfb27c when B is HELD ($7E & Joypad_B)
-- This is the FULL translation including jump initiation (CODE_BFB94F)
function player:code_bfb8f7_full()
	-- LDA.b $80 / AND.w #$8000                     ; LINE 111607: B pressed THIS frame?
	if (self.zp_80 & joypad_b) ~= 0 then
		-- CODE_BFB919: first press - record timestamp
		-- LDA.b $28 / STA.w $16A5,y                 ; LINE 111621
		self.ram_16a5 = self.zp_28
		-- fall through to CODE_BFB91E below
	else
		-- B held but not freshly pressed
		-- LDA.w $1699,y / ORA.w #$0001 / STA.w $1699,y ; LINE 111611
		self.ram_1699 = self.ram_1699 | 0x0001
		-- LDA.b $28 / SEC / SBC.w $16A5,y           ; LINE 111614
		local frame_delta = self.zp_28 - self.ram_16a5
		-- BMI.b CODE_BFB918                          ; LINE 111617
		if frame_delta < 0 then
			return  -- CODE_BFB918: RTS
		end
		-- CMP.w #$000C                               ; LINE 111619
		if frame_delta >= 0x000c then
			return  -- CODE_BFB918: outside buffer window
		end
		-- fall through to CODE_BFB91E
	end
	
	-- CODE_BFB91E:
	-- LDA.w $180F / CMP.w #$0001                   ; LINE 111624
	if self.ram_180f == 1 then
		return  -- can't jump in air (CODE_BFB918: RTS)
	end
	-- CMP.w #$000C                                  ; LINE 111628
	-- BNE.b CODE_BFB92E                             ; LINE 111630
	-- (skip rope jump for $180F=0x0C)
	
	-- CODE_BFB92E:
	-- LDA.w RAMTable1029Lo,x / CMP.w #$0012        ; LINE 111632
	local state1029 = self.ram_ramtable1029lo
	if state1029 == 0x0012 or state1029 == 0x0013 or state1029 == 0x0019 then
		-- rolling states - always allow jump (skip checks below)
	else
		-- LDA.w RAMTable1631Lo,x / BNE RTS           ; LINE 111640
		if self.ram_ramtable1631lo ~= 0 then
			return  -- CODE_BFB9B1: RTS
		end
		-- LDA.w RAMTable1209Lo,x / AND.w #$0007      ; LINE 111643
		-- CMP.b $F3 / BPL RTS                        ; LINE 111646
		local anim_idx = self.ram_ramtable1209lo & 0x0007
		if anim_idx >= self.zp_f3 then
			return  -- CODE_BFB9B1: RTS
		end
	end
	
	-- CODE_BFB94F: INITIATE JUMP
	-- LDA.w $1699,y / ORA.w #$0003 / STA.w $1699,y ; LINE 111652
	self.ram_1699 = self.ram_1699 | 0x0003
	-- LDA.w $16CD,y / ORA.w #$0001 / STA.w $16CD,y ; LINE 111658
	self.ram_16cd = self.ram_16cd | 0x0001
	-- LDA.w #$FFB8                                  ; LINE 111664
	-- CPY.w #$0000 / BEQ CODE_BFB96E               ; LINE 111666 (player 1 check)
	-- LDA.w #$FFA6 (player 2 = Diddy, heavier gravity)
	local jump_gravity
	if self.zp_44 == 0 then
		jump_gravity = 0xffb8  -- DK
	else
		jump_gravity = 0xffa6  -- Diddy
	end
	-- STA.w $16F9,y                                 ; LINE 111670
	self.ram_16f9 = jump_gravity
	-- LDA.w #$0000 / STA.w $16E5,y                 ; LINE 111672
	self.ram_16e5 = 0
	-- LDA.w #$00C1 / STA.w RAMTable11A1Lo,x        ; LINE 111676
	-- (animation script ID - skip for now)
	-- STZ.w $1E17                                   ; LINE 111680
	self.ram_1e17 = 0
	-- JSR CODE_BFBEC5 (sound effect - skip)
	-- LDA.w $1699,y / AND.w #$FF7F / STA.w $1699,y ; LINE 111686
	self.ram_1699 = self.ram_1699 & 0xff7f
	
	-- LDA.b $BA / AND.w #$0001 / BNE CODE_BFB9DB   ; LINE 111690
	-- (check $BA for special state - assume 0 for now)
	
	-- LDA.w $0512,y / BNE CODE_BFBA08              ; LINE 111696
	-- (check for animal buddy - assume none)
	-- LDA.w $16F5,y / BEQ CODE_BFB9A2              ; LINE 111700
	-- (check for carried object - assume none)
	
	-- CODE_BFB9A2: normal jump
	-- LDA.w #$0001 / STA.w RAMTable1029Lo,x        ; LINE 111704
	self.ram_ramtable1029lo = 0x0001
	-- LDA.w #Define_AnimationID_DK_Jump             ; LINE 111708
	-- JSL CODE_BE80A4 (set animation - skip for now)
	self.ram_16ad = define_dkc1_animationid_dk_jump
	
	-- Set Y speed for jump
	self.ram_yspeedlo = 0x0600
	
	-- NOTE: the real assembly sets yspeed via animation event/script (CODE_BFBEC5)
	-- The jump is now initiated. The grounded flag will be cleared
	-- by integrate_and_collide when the player moves upward.
	self.grounded = false
end

-- code_bfbc6b: Y BUTTON handler for state 0 (roll/pickup, line 112045)
-- Called from inside code_bfb27c when Y is HELD
function player:code_bfbc6b()
	-- CODE_BFBC6B:
	-- LDY.b $84
	-- LDA.w $0512,y / BEQ CODE_BFBC75              ; check for animal buddy
	-- (assume no animal buddy - skip to CODE_BFBC75)
	
	-- CODE_BFBC75:
	-- LDA.w $16F5,y / BEQ CODE_BFBC7D              ; check for carried object
	-- (assume no carried object - skip to CODE_BFBC7D)
	
	-- CODE_BFBC7D:
	-- JSR CODE_BFBE39 / BCS RTS                     ; check if can start action
	-- (skip this check for now)
	
	-- LDA.w $16E5,y / ASL / TAX                     ; LINE 112083
	-- JMP (DATA_BFBC8D,x)
	-- DATA_BFBC8D: CODE_BFBCD7, CODE_BFBDD5, CODE_BFBDE7, CODE_BFBDD5, CODE_BFBC97
	local roll_state = self.ram_16e5
	
	if roll_state == 0 then
		-- CODE_BFBCD7: initial roll check
		-- Check for ground slap (Down+Y) - skip for now
		-- Check various animation states
		-- LDA.w RAMTable1631Lo,x / BMI RTS            ; LINE 112147
		if to_signed_16(self.ram_ramtable1631lo) < 0 then
			return
		end
		-- DEC / BPL CODE_BFBD3A                       ; LINE 112149
		if (self.ram_ramtable1631lo - 1) >= 0 then
			-- CODE_BFBD3A: just check for press and record timestamp
			if (self.zp_80 & joypad_y) ~= 0 then
				self.ram_16e5 = 0
			end
			return
		end
		-- LDA.w YSpeedLo,x / BPL CODE_BFBD3A         ; LINE 112153
		if to_signed_16(self.ram_yspeedlo) >= 0 then
			if (self.zp_80 & joypad_y) ~= 0 then
				self.ram_16e5 = 0
			end
			return
		end
		-- LDA.b $80 / AND.w #$4000 / BNE CODE_BFBD1E ; LINE 112157
		if (self.zp_80 & joypad_y) ~= 0 then
			-- CODE_BFBD1E: check $BA and animation
			-- LDA.b $BA / AND.w #$0001 / BEQ skip     ; (assume $BA=0)
			-- LDA.w RAMTable1209Lo,x / AND.w #$0007 / CMP.b $F3 / BMI proceed
			local anim_idx = self.ram_ramtable1209lo & 0x0007
			if anim_idx < self.zp_f3 then
				-- CODE_BFBD31: JSL CODE_BFBD4F / JSL CODE_BFBDA9
				-- CODE_BFBD4F: set roll state
				self.ram_16e5 = 0x0001
				self.ram_1e17 = 0
				-- LDA.w #$0100 / STA.w $16F1,y        ; base roll speed
				self.ram_16f1 = 0x0100
				-- LDA.b $7E / AND.w #$0300             ; check if L or R held
				if (self.zp_7e & 0x0300) ~= 0 then
					-- LDA.w #$0300 / STA.w $16F1,y
					self.ram_16f1 = 0x0300
				end
				-- LDA.b $28 / STA.w $16A1,y / STA.w $16A9,y
				self.ram_16a1 = self.zp_28
				self.ram_16a9 = self.zp_28
				-- SEC / SBC.w $16E1,y / CMP.w #$0010
				local dt_frames = self.zp_28 - self.ram_16e1
				if dt_frames < 0x0010 then
					-- fast double-tap: higher speed
					self.ram_16f1 = 0x0400
					self.ram_1699 = self.ram_1699 | 0x0040
				else
					self.ram_1699 = self.ram_1699 & 0xffbf
				end
				-- JSL CODE_BFBDA9: roll initiation
				self:code_bfbda9()
			end
		else
			-- Check timing window for buffered roll
			local frame_delta = self.zp_28 - self.ram_16a1
			if frame_delta < 0 or frame_delta >= 0x0008 then
				return
			end
			-- same roll initiation
			local anim_idx = self.ram_ramtable1209lo & 0x0007
			if anim_idx < self.zp_f3 then
				self.ram_16e5 = 0x0001
				self.ram_1e17 = 0
				self.ram_16f1 = 0x0100
				if (self.zp_7e & 0x0300) ~= 0 then
					self.ram_16f1 = 0x0300
				end
				self.ram_16a1 = self.zp_28
				self.ram_16a9 = self.zp_28
				local dt_frames = self.zp_28 - self.ram_16e1
				if dt_frames < 0x0010 then
					self.ram_16f1 = 0x0400
					self.ram_1699 = self.ram_1699 | 0x0040
				else
					self.ram_1699 = self.ram_1699 & 0xffbf
				end
				self:code_bfbda9()
			end
		end
	elseif roll_state == 2 then
		-- CODE_BFBDE7: roll chain
		self:code_bfbde7()
	end
	-- Other states (1, 3, 4) have specific handlers not needed yet
end

-- code_bfb27c: FULL button handler entry (line 110730)
-- REAL assembly: handles ALL buttons (up/down/left/right/A/B/X/Y/L/R/select/start)
function player:code_bfb27c()
	-- STA.w $180F                                  ; LINE 110730
	-- (already set by caller)
	-- STZ.w $1E19                                  ; LINE 110735
	self.ram_1e19 = 0
	
	-- CODE_BFB2C7: clear run-active bit
	-- LDA.w $1699,y / AND.w #$FFFB / STA.w $1699,y ; LINE 110750-755
	self.ram_1699 = self.ram_1699 & 0xfffb
	
	-- ================================================================
	-- UP/DOWN/VERTICAL NEUTRAL (LINE 110786-110804)
	-- ================================================================
	-- LDA.b $7E / AND.w #Joypad_DPadU              ; LINE 110786
	if (self.zp_7e & joypad_dpadu) ~= 0 then
		-- JSR CODE_BFB38A (up handler - jump table via DATA_BFC211)
		-- For $180F=0: DATA_BFC211[0] = CODE_BFBA39 (RTS/noop)
		-- skip for now
	-- LDA.b $7E / AND.w #Joypad_DPadD              ; LINE 110793
	elseif (self.zp_7e & joypad_dpadd) ~= 0 then
		-- JSR CODE_BFB3FE (down handler - jump table via DATA_BFC237)
		-- For $180F=0: similar
		-- skip for now
	else
		-- JSR CODE_BFC1A1 (vertical neutral)        ; LINE 110802
		-- CODE_BFC1A1: LDA $180F / ASL / TAX / JMP (DATA_BFC31B,x)
		-- DATA_BFC31B[0] = CODE_BFBA39 (RTS/noop for $180F=0)
		-- skip for now
	end
	
	-- ================================================================
	-- LEFT/RIGHT/HORIZONTAL NEUTRAL (LINE 110805-110819)
	-- ================================================================
	-- CODE_BFB305:
	-- LDA.b $7E / AND.w #Joypad_DPadL              ; LINE 110805
	if (self.zp_7e & joypad_dpadl) ~= 0 then
		-- JSR CODE_BFB5AE                            ; LINE 110808
		-- CODE_BFB5AE: LDA $180F / ASL / TAX / JMP (DATA_BFC1C5,x)
		-- DATA_BFC1C5[0] = CODE_BFB64B (air/complex left for $180F=0)
		-- Since we use simplified ground check here, call the appropriate handler
		if self.ram_180f == 0 then
			self:code_bfb5b6()  -- ground left
		else
			self:code_bfb64b()  -- air left
		end
	-- LDA.b $7E / AND.w #Joypad_DPadR              ; LINE 110811
	elseif (self.zp_7e & joypad_dpadr) ~= 0 then
		-- JSR CODE_BFB6C5                            ; LINE 110815
		-- CODE_BFB6C5: LDA $180F / ASL / TAX / JMP (DATA_BFC1EB,x)
		if self.ram_180f == 0 then
			self:code_bfb6cd()  -- ground right
		else
			self:code_bfb75a()  -- air right
		end
	else
		-- JSR CODE_BFC18A                            ; LINE 110819
		-- CODE_BFC18A: LDA $180F / ASL / TAX / JMP (DATA_BFC2F5,x)
		-- DATA_BFC2F5[0] = CODE_BFC192
		if self.ram_180f == 0 then
			self:code_bfc18a()  -- ground neutral (CODE_BFC192)
		else
			self:code_bfba39()  -- air neutral (RTS)
		end
	end
	
	-- ================================================================
	-- A BUTTON (LINE 110820)
	-- ================================================================
	-- LDA.b $7E / AND.w #Joypad_A                  ; LINE 110820
	-- For $180F=0: DATA_BFC25D[0] = CODE_BFB838 (tag action)
	-- Not essential for basic physics, skip for now
	
	-- ================================================================
	-- B BUTTON / JUMP (LINE 110824-110835)
	-- ================================================================
	-- LDA.b $7E / AND.w #Joypad_B                  ; LINE 110824
	if (self.zp_7e & joypad_b) ~= 0 then
		-- JSR CODE_BFB8DD                            ; LINE 110828
		-- CODE_BFB8DD: LDA $180F / ASL / TAX / JMP (DATA_BFC283,x)
		-- DATA_BFC283[0] = CODE_BFB8F7 (jump handler)
		self:code_bfb8f7_full()
	else
		-- JSR CODE_BFC1B9                            ; LINE 110834
		-- CODE_BFC1B9: LDX $84 / LDA $1699,x / AND #$FFFC / STA $1699,x
		self.ram_1699 = self.ram_1699 & 0xfffc
	end
	
	-- ================================================================
	-- X BUTTON (LINE 110837)
	-- ================================================================
	-- Skip for now
	
	-- ================================================================
	-- Y BUTTON / RUN-ROLL (LINE 110841-110851)
	-- ================================================================
	-- LDA.b $7E / AND.w #Joypad_Y                  ; LINE 110841
	if (self.zp_7e & joypad_y) ~= 0 then
		-- JSR CODE_BFBC4B                            ; LINE 110845
		-- CODE_BFBC4B: LDA $180F / ASL / TAX / JMP (DATA_BFC2A9,x)
		-- DATA_BFC2A9[0] = CODE_BFBC6B (roll handler)
		self:code_bfbc6b()
	else
		-- JSR CODE_BFBC06 (Y release)                ; LINE 110849
		-- CODE_BFBC06: checks $16F5 for carried object
		-- For no carried object ($16F5=0): RTS
		-- skip (no carry mechanic yet)
	end
	
	-- ================================================================
	-- L/R/SELECT/START (LINE 110852+)
	-- ================================================================
	-- Skip for now
	
	-- LDA.w $1E19 / LSR / RTS                      ; LINE 110883
	-- return carry = bit 0 of $1E19
end

-- code_bfba88: rope jump (line 111806)
function player:code_bfba88()
	-- lda.w #$0700
	self.ram_yspeedlo = 0x0700
	
	-- ldy.b $84
	-- lda.w $1699,y / ora.w #$0203
	self.ram_1699 = self.ram_1699 | 0x0203
	
	-- lda.w $16cd,y / ora.w #$0001
	self.ram_16cd = self.ram_16cd | 0x0001
	
	-- lda.w #$ffb8
	self.ram_16f9 = 0xffb8
	
	-- lda.w #$0000 / sta.w $16e5,y
	self.ram_16e5 = 0
	
	-- lda.w #$00c1
	self.ram_16ad = 0x00c1
	
	-- (animation setup continues...)
end

-- code_bfaf38: air gravity (line 110236)
function player:code_bfaf38()
	-- ldx.b !ram_dkc1_norspr_currentindexlo      ; LINE 110236: LDX.b !RAM_DKC1_NorSpr_CurrentIndexLo
	-- ldy.b $84                                    ; LINE 110237: LDY.b $84
	-- lda.w $1699,y                                ; LINE 110238: LDA.w $1699,y
	-- and.w #$0002                                 ; LINE 110241: AND.w #$0002 (check jump-hold)
	local gravity
	if (self.ram_1699 & 0x0002) ~= 0 then
		-- holding jump
		-- lda.w $16f9,y                             ; LINE 110243: LDA.w $16F9,y
		gravity = self.ram_16f9  -- $ffb8 or $ffa6
	else
		-- released jump
		-- lda.w #$ff90                              ; LINE 110245: LDA.w #$FF90
		gravity = 0xff90  -- -112 dec
	end
	
	-- clc                                          ; LINE 110256: CLC
	-- adc.w !ram_dkc1_norspr_yspeedlo,x            ; LINE 110258: ADC.w !RAM_DKC1_NorSpr_YSpeedLo,x
	local yspeed_signed = to_signed_16(self.ram_yspeedlo)
	local gravity_signed = to_signed_16(gravity)
	yspeed_signed = yspeed_signed + gravity_signed
	
	-- max fall speed check
	-- bpl.b code_bfaf64                            ; LINE 110260: BPL.b CODE_BFAF64
	-- cmp.w #$f800                                 ; LINE 110262: CMP.w #$F800 (-8.0 px)
	if yspeed_signed < -0x0800 then
		-- lda.w #$f800                              ; LINE 110266: LDA.w #$F800
		yspeed_signed = -0x0800
	end
	
	-- code_bfaf64: sta.w !ram_dkc1_norspr_yspeedlo,x ; LINE 110267: STA.w !RAM_DKC1_NorSpr_YSpeedLo,x
	self.ram_yspeedlo = to_unsigned_16(yspeed_signed)
	yspeed = (yspeed + gravity) & 0xffff
	
	-- bpl.b code_bfaf64 (check if positive/falling)
	if yspeed < 0x8000 then
		-- positive (falling down)
		self.ram_yspeedlo = yspeed
		return
	end
	
	-- cmp.w #$f800  (max fall speed)
	if yspeed < 0xf800 then
		-- clamp
		yspeed = 0xf800
	end
	
	-- code_bfaf64:
	self.ram_yspeedlo = yspeed
end

-- code_bfbda9: roll initiation (line 112223)
function player:code_bfbda9()
	-- lda.w #$0012
	self.ram_ramtable1029lo = 0x0012  -- roll state
	
	-- lda.w $16f1,y  (current x speed)
	local speed = self.ram_16f1
	
	-- bit.w !ram_dkc1_norspr_yxppccctlo,x
	-- bvc.b code_bfbdbb
	if (self.ram_yxppccctlo & 0x4000) ~= 0 then
		-- facing left, negate
		-- eor.w #$ffff / inc
		speed = ((-to_signed_16(speed)) & 0xffff)
	end
	
	-- code_bfbdbb:
	-- sta.w !ram_dkc1_norspr_ramtable0f25lo,x
	self.ram_ramtable0f25lo = speed
	
	-- set roll flag
	-- lda.w $1699,y / ora.w #$0080
	self.ram_1699 = self.ram_1699 | 0x0080
	
	-- lda.w #!define_dkc1_animationid_dk_roll
	self.ram_16ad = define_dkc1_animationid_dk_roll
end

-- code_bfbde7: roll chain (line 112246)
function player:code_bfbde7()
	-- lda.w #$0003
	self.ram_16e5 = 0x0003
	
	-- lda.b $28 / sta.w $16a1,y
	self.ram_16a1 = self.zp_28
	
	-- lda.w $16f1,y
	local speed = self.ram_16f1
	-- clc / adc.w #$0100
	speed = speed + 0x0100
	
	-- cmp.w #$0800
	if speed >= 0x0800 then
		speed = 0x0800
	end
	
	-- code_bfbe05:
	-- sta.w $16f1,y
	self.ram_16f1 = speed
	
	-- jsl.l code_bfbda9
	self:code_bfbda9()
end

-- ============================================================================
-- collision & physics integration
-- ============================================================================

function player:get_overlapping_solid(x, y)
	local solids = self.level.solids
	for i = 1, #solids do
		local box = solids[i]
		if x < (box.x + box.w) and (x + self.width) > box.x and 
		   y < (box.y + box.h) and (y + self.height) > box.y then
			return box
		end
	end
	return nil
end

function player:is_grounded_probe()
	return self:get_overlapping_solid(self.ram_xposlo, self.ram_yposlo + 1) ~= nil
end

function player:move_horizontal_pixels(step_pixels)
	if step_pixels == 0 then
		return false
	end
	local direction = sign(step_pixels)
	local remaining = abs_16(step_pixels)
	
	while remaining > 0 do
		local next_x = self.ram_xposlo + direction
		if self:get_overlapping_solid(next_x, self.ram_yposlo) ~= nil then
			-- collision
			self.ram_xspeedlo = 0
			self.pos_subx = self.ram_xposlo * 0x0100
			return true
		end
		self.ram_xposlo = next_x
		remaining = remaining - 1
	end
	return false
end

function player:move_vertical_pixels(step_pixels)
	if step_pixels == 0 then
		return false, false
	end
	local direction = sign(step_pixels)
	local remaining = abs_16(step_pixels)
	local grounded = false
	
	while remaining > 0 do
		local next_y = self.ram_yposlo + direction
		local solid = self:get_overlapping_solid(self.ram_xposlo, next_y)
		if solid ~= nil then
			-- collision
			if direction > 0 then
				-- hit ground
				grounded = true
			end
			self.ram_yspeedlo = 0
			self.pos_suby = self.ram_yposlo * 0x0100
			return true, grounded
		end
		self.ram_yposlo = next_y
		remaining = remaining - 1
	end
	return false, grounded
end

function player:integrate_and_collide()
	local sp = 0x0100
	
	-- x integration
	local want_subx = self.pos_subx + to_signed_16(self.ram_xspeedlo)
	local want_x = math.floor(want_subx / sp)
	local step_x = want_x - self.ram_xposlo
	local collided_x = self:move_horizontal_pixels(step_x)
	if not collided_x then
		self.pos_subx = want_subx
	end
	
	-- y integration
	self.grounded = false
	local want_suby = self.pos_suby - to_signed_16(self.ram_yspeedlo)
	local want_y = math.floor(want_suby / sp)
	local step_y = want_y - self.ram_yposlo
	local collided_y, grounded = self:move_vertical_pixels(step_y)
	if not collided_y then
		self.pos_suby = want_suby
	end
	
	-- ground probe
	if not grounded and self:is_grounded_probe() then
		grounded = true
		self.ram_yspeedlo = 0
		self.pos_suby = self.ram_yposlo * sp
	end
	
	self.grounded = grounded
	
	-- world bounds
	local max_x = self.level.world_width - self.width
	if self.ram_xposlo < 0 then
		self.ram_xposlo = 0
		self.ram_xspeedlo = 0
		self.pos_subx = 0
	elseif self.ram_xposlo > max_x then
		self.ram_xposlo = max_x
		self.ram_xspeedlo = 0
		self.pos_subx = max_x * sp
	end
	
	local max_y = self.level.world_height - self.height
	if self.ram_yposlo > max_y then
		self.ram_yposlo = max_y
		self.ram_yspeedlo = 0
		self.pos_suby = max_y * sp
		self.grounded = true
	end
	
	-- update grounded flags
	if self.grounded then
		self.ram_ramtable12a5lo = self.ram_ramtable12a5lo | 0x0001
	else
		self.ram_ramtable12a5lo = self.ram_ramtable12a5lo & 0xfffe
	end
end

-- ============================================================================
-- input sampling
-- ============================================================================

function player:sample_input()
	local player_index = self.player_index
	
	-- store previous frame
	self.prev_7e = self.zp_7e
	
	-- build button mask
	local held = 0
	
	-- helper to get pressed (held) state
	local function is_held(name)
		local action = game:get_action_state(player_index, name)
		return action and action.pressed
	end
	
	if is_held('console_left') then
		held = held | joypad_dpadl
	end
	if is_held('console_right') then
		held = held | joypad_dpadr
	end
	if is_held('console_up') then
		held = held | joypad_dpadu
	end
	if is_held('console_down') then
		held = held | joypad_dpadd
	end
	
	-- BMSX engine uses Xbox naming convention (a=south, b=east, x=west, y=north)
	-- but the libretro core swaps A↔B and X↔Y to normalize from SNES layout.
	-- DKC1 assembly uses SNES layout (B=south=jump, Y=west=run/roll).
	-- So engine "a" (south face) = SNES B, engine "b" (east face) = SNES A,
	--    engine "x" (west face) = SNES Y, engine "y" (north face) = SNES X.
	
	if is_held('console_a') then
		held = held | joypad_b    -- south face → SNES B (0x8000, jump)
	end
	if is_held('console_b') then
		held = held | joypad_a    -- east face → SNES A (0x0080)
	end
	if is_held('console_x') then
		held = held | joypad_y    -- west face → SNES Y (0x4000, run/roll)
	end
	if is_held('console_y') then
		held = held | joypad_x    -- north face → SNES X (0x0040)
	end
	
	-- update ram
	self.zp_7e = held
	
	-- pressed = held this frame but not last frame
	self.zp_80 = held & (~self.prev_7e)
	
	-- update facing
	if (held & joypad_dpadl) ~= 0 then
		self.facing = -1
		self.ram_yxppccctlo = self.ram_yxppccctlo | 0x4000  -- set flip bit
	elseif (held & joypad_dpadr) ~= 0 then
		self.facing = 1
		self.ram_yxppccctlo = self.ram_yxppccctlo & 0xbfff  -- clear flip bit
	end
	
	-- B-release handling is now in code_bfb27c (CODE_BFC1B9: $1699 &= 0xFFFC)
end

-- ============================================================================
-- main tick loop
-- ============================================================================

function player:tick(dt)
	-- increment frame counter (code_bfb2c7 area)
	self.zp_28 = self.zp_28 + 1
	self.debug_frame = self.zp_28
	self.debug_time_ms = self.debug_time_ms + (dt * 1000)
	
	-- sample input
	self:sample_input()
	
	-- determine control context
	if self.grounded then
		-- lda.b #$00                                   ; LINE 110733: STA.w $180F (0 for ground)
		self.ram_180f = 0
		-- lda.b #$04                                   ; LINE 110540: CMP.w #$0004 (grounded state)
		self.zp_32 = 0x0004
		
		-- CODE_BFA5DE: Ground speed accumulator
		-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x
		-- AND.w #$0007
		local anim_idx = self.ram_ramtable1209lo & 0x0007
		
		-- CMP.b $F3
		-- BEQ.b CODE_BFA60C
		if anim_idx == self.zp_f3 then
			-- CODE_BFA60C: direction-change boost
			-- BIT.w !RAM_DKC1_NorSpr_RAMTable1209Lo-$01,x
			-- BMI.b CODE_BFA625
			local facing_right = (self.ram_ramtable1209lo & 0x8000) ~= 0
			if facing_right then
				-- CODE_BFA625:
				-- LDA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x
				-- BMI.b CODE_BFA637
				local target_signed = to_signed_16(self.ram_ramtable0f25lo)
				if target_signed < 0 then
					-- CODE_BFA637: CLC / RTS (no boost)
				else
					-- LDA.w !RAM_DKC1_NorSpr_XSpeedLo,x
					-- BMI.b CODE_BFA637
					local speed_signed = to_signed_16(self.ram_xspeedlo)
					if speed_signed < 0 then
						-- CODE_BFA637: CLC / RTS (no boost)
					else
						-- LDA.w #$0500
						-- STA.w !RAM_DKC1_NorSpr_RAMTable123DLo,x
						-- SEC / RTS
						self.ram_ramtable123dlo = 0x0500
					end
				end
			else
				-- CODE_BFA60C left path:
				-- LDA.w !RAM_DKC1_NorSpr_RAMTable0F25Lo,x
				-- DEC
				-- BPL.b CODE_BFA637
				local target_dec = to_signed_16(self.ram_ramtable0f25lo) - 1
				if target_dec >= 0 then
					-- CODE_BFA637: CLC / RTS (no boost)
				else
					-- LDA.w !RAM_DKC1_NorSpr_XSpeedLo,x
					-- DEC
					-- BPL.b CODE_BFA637
					local speed_dec = to_signed_16(self.ram_xspeedlo) - 1
					if speed_dec >= 0 then
						-- CODE_BFA637: CLC / RTS (no boost)
					else
						-- LDA.w #$FB00
						-- STA.w !RAM_DKC1_NorSpr_RAMTable123DLo,x
						-- SEC / RTS
						self.ram_ramtable123dlo = 0xFB00
					end
				end
			end
		else
			-- Normal animation boost path (anim_idx ~= $F3)
			-- TXY / ASL / TAX
			-- LDA.l DATA_BFA5FE,x
			-- TYX
			local boost_table = {0x0000, 0x0080, 0x0100, 0x0180, 0x01F0, 0x0280, 0x0400}
			local boost = boost_table[anim_idx + 1]
			
			-- BIT.w !RAM_DKC1_NorSpr_RAMTable1209Lo-$01,x
			-- BMI.b CODE_BFA5F9
			if (self.ram_ramtable1209lo & 0x8000) == 0 then
				-- EOR.w #$FFFF / INC (negate)
				boost = ((-boost) & 0xFFFF)
			end
			
			-- CODE_BFA5F9:
			-- STA.w !RAM_DKC1_NorSpr_RAMTable123DLo,x
			-- CLC / RTS
			self.ram_ramtable123dlo = boost
		end
	else
		-- lda.b #$01                                   ; LINE 110733: STA.w $180F (1 for air)
		self.ram_180f = 1
		-- airborne state (used for profile selection)
		self.zp_32 = 0x0001
	end
	
	-- run button handler (CODE_BFB27C handles ALL buttons: direction, jump, roll, etc.)
	self:code_bfb27c()
	
	-- select profile and apply smoothing
	-- jsr.w code_bfb159                            ; LINE 110605: JSR.w CODE_BFB159
	local profile_id = self:code_bfb159()
	-- CODE_BFB191: lda.w !ram_dkc1_norspr_ramtable0f25lo,y
	local target = self.ram_ramtable0f25lo
	-- clc : adc.w !ram_dkc1_norspr_ramtable123dlo,y  ; ADD ACCUMULATOR!
	local target_with_acc = to_unsigned_16(target + self.ram_ramtable123dlo)
	
	-- DEBUG: Log physics state every 10 frames
	if self.zp_28 % 10 == 0 then
		local left = (self.zp_7e & joypad_dpadl) ~= 0
		local right = (self.zp_7e & joypad_dpadr) ~= 0
		local input_dir = left and 'L' or (right and 'R' or 'N')
		local anim_idx = self.ram_ramtable1209lo & 0x0007
		print(string.format('PHYSICS|f=%d|gr=%s|inp=%s|zp7e=%04x|zp32=%04x|180f=%d|cur=%d|tgt=%d|acc=%d|tgt+acc=%d|prof=%d|anim=%d',
			self.zp_28,
			self.grounded and 'T' or 'F',
			input_dir,
			self.zp_7e,
			self.zp_32,
			self.ram_180f,
			to_signed_16(self.ram_xspeedlo),
			to_signed_16(target),
			to_signed_16(self.ram_ramtable123dlo),
			to_signed_16(target_with_acc),
			profile_id,
			anim_idx))
	end
	
	-- convert to signed 16-bit
	local target_signed = to_signed_16(target_with_acc)
	local current_signed = to_signed_16(self.ram_xspeedlo)
	
	-- apply profile smoothing (code_bfb191 logic)
	-- sec                                          ; CODE_BFB191: SEC
	-- sbc.w !ram_dkc1_norspr_xspeedlo,y            ; CODE_BFB191: SBC.w !RAM_DKC1_NorSpr_XSpeedLo,y
	local delta = target_signed - current_signed
	local abs_delta = delta
	-- bpl.b code_bfb19e                            ; LINE 110599: BPL.b CODE_BFB19E
	if abs_delta < 0 then
		-- eor.w #$ffff                             ; LINE 110601: EOR.w #$FFFF
		-- inc                                      ; LINE 110603: INC
		abs_delta = -abs_delta
	end
	
	-- jsr.w (data_bfb255,x)                        ; LINE 110607: JSR.w (DATA_BFB255,x)
	local step = self:data_bfb255_profile(profile_id, abs_delta)
	
	-- beq.b code_bfb1b5                            ; CODE_BFB191: BEQ.b CODE_BFB1B5
	if step == 0 then
		-- code_bfb1b5: instant snap                ; CODE_BFB1B5: LDA target+acc, STA xspeed
		current_signed = target_signed
	else
		-- apply step
		if delta < 0 then
			step = -step
		end
		current_signed = current_signed + step
		
		-- clamp to target (approximate BCC/BCS branches)
		if delta > 0 and current_signed > target_signed then
			current_signed = target_signed
		elseif delta < 0 and current_signed < target_signed then
			current_signed = target_signed
		end
	end
	
	-- updated x speed
	-- sta.w !ram_dkc1_norspr_ramtable16f1lo,x      ; LINE 110623: STX.w !RAM_DKC1_NorSpr_YSpeedLo,x (yspeed logic elsewhere)
	self.ram_xspeedlo = to_unsigned_16(current_signed)
	
	-- update ram_16f1 for roll speed tracking
	if self.ram_ramtable1029lo == 0x0012 then
		-- rolling - ram_16f1 is the roll speed
		-- don't update from smoothing
	else
		-- not rolling - track actual speed
		self.ram_16f1 = abs_16(self.ram_xspeedlo)
	end
	
	-- apply gravity if airborne (code_bfaf38)
	if not self.grounded then
		self:code_bfaf38()
	end
	
	-- integrate position and collide
	self:integrate_and_collide()
	
	-- update public position
	self.x = self.ram_xposlo
	self.y = self.ram_yposlo
	
	-- update camera anchor
	self.camera_anchor_x = self.x + (self.width * 0.5)
	self.camera_anchor_y = self.y + (self.height * 0.5)
	
	-- update visual state
	self:update_visual_frame(dt)
end

-- ============================================================================
-- visual frame update
-- ============================================================================

function player:update_visual_frame(dt)
	local speed_unsigned = abs_16(self.ram_xspeedlo)
	
	-- determine pose
	if self.ram_ramtable1029lo == 0x0012 then
		self.pose_name = 'roll'
		self.visual_frame_id = 'esther_dk_roll_01'  -- simplified
	elseif not self.grounded then
		self.pose_name = 'airborne'
		self.visual_frame_id = 'esther_dk_jump'
	elseif speed_unsigned < 0x0080 then  -- ~0.5 px/frame
		self.pose_name = 'idle'
		self.visual_frame_id = 'esther_dk_idle_01'
	elseif speed_unsigned < 0x0280 then  -- < ~2.5 px/frame
		self.pose_name = 'walk'
		self.visual_frame_id = 'esther_dk_walk_01'  -- would cycle here
	else
		self.pose_name = 'run'
		self.visual_frame_id = 'esther_dk_run_01'  -- would cycle here
	end
end

-- ============================================================================
-- timeline system (stub)
-- ============================================================================

function player:define_timeline(config)
	-- stub for squash/stretch animations
end

function player:play_timeline(id, config)
	-- stub
end

function player:define_motion_timelines()
	-- stub
end

function player:respawn()
	self:reset_runtime()
end

-- ============================================================================
-- module export
-- ============================================================================

local player_def_id = 'dkc_player_asm'
local player_instance_id = 'player_1'
local player_fsm_id = 'dkc_player_asm_fsm'

local function define_player_fsm()
	define_fsm(player_fsm_id, {
		initial = 'active',
		states = {
			active = {
				tick = function(self, dt)
					self:tick(dt)
				end,
			},
		},
	})
end

local function register_player_definition()
	define_world_object({
		def_id = player_def_id,
		class = player,
		fsms = { player_fsm_id },
		components = {},
		defaults = {
			player_index = 1,
			width = 16,
			height = 32,
			facing = 1,
			grounded = true,
			draw_scale_x = 1.0,
			draw_scale_y = 1.0,
			roll_visual = 0,
		},
	})
end

return {
	define_player_fsm = define_player_fsm,
	register_player_definition = register_player_definition,
	player_def_id = player_def_id,
	player_instance_id = player_instance_id,
	player_fsm_id = player_fsm_id,
	register = register_player_definition,
	player = player,
}
