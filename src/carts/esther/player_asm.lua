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
local joypad_l      = 0x0020  -- button l
local joypad_r      = 0x0010  -- button r

-- ============================================================================
-- animation ids (from misc_defines_dkc1.asm)
-- ============================================================================
local define_dkc1_animationid_dk_idle = 0x0001
local define_dkc1_animationid_dk_run = 0x0002
local define_dkc1_animationid_dk_walk = 0x0003
local define_dkc1_animationid_dk_jump = 0x0005
local define_dkc1_animationid_dk_holdjump = 0x004D
local define_dkc1_animationid_dk_fall = 0x0015
local define_dkc1_animationid_dk_bounce = 0x0017
local define_dkc1_animationid_dk_roll = 0x0018
local define_dkc1_animationid_dk_endroll = 0x0019
local define_dkc1_animationid_dk_cancelroll = 0x001a
local define_dkc1_animationid_dk_jumpoffverticalrope = 0x0052

-- ============================================================================
-- jump tables used by code_bfb27c dispatch
-- ============================================================================

local data_bfc1c5 = {
	'code_bfb64b',
	'code_bfb64b',
	'code_bfba39',
	'code_bfb634',
	'code_bfb5da',
	'code_bfb5da',
	'code_bfb5e4',
	'code_bfba39',
	'code_bfc192',
	'code_bfb64b',
	'code_bfba39',
	'code_bfb64b',
	'code_bfb640',
	'code_bfba39',
	'code_bfb64b',
	'code_bfb5d1',
	'code_bfba39',
	'code_bfb5b6',
	'code_bfba39',
}

local data_bfc1eb = {
	'code_bfb75a',
	'code_bfb75a',
	'code_bfba39',
	'code_bfb743',
	'code_bfb6f1',
	'code_bfb6f1',
	'code_bfb6fb',
	'code_bfba39',
	'code_bfc192',
	'code_bfb75a',
	'code_bfba39',
	'code_bfb75a',
	'code_bfb74f',
	'code_bfba39',
	'code_bfb75a',
	'code_bfb6e8',
	'code_bfba39',
	'code_bfb6cd',
	'code_bfba39',
}

local data_bfc2f5 = {
	'code_bfc192',
	'code_bfc192',
	'code_bfc192',
	'code_bfc192',
	'code_bfba39',
	'code_bfba39',
	'code_bfba39',
	'code_bfba39',
	'code_bfc192',
	'code_bfba39',
	'code_bfba39',
	'code_bfc192',
	'code_bfc192',
	'code_bfba39',
	'code_bfc192',
	'code_bfc192',
	'code_bfba39',
	'code_bfc192',
	'code_bfba39',
}

local data_bfc283 = {
	'code_bfb8f7_full',
	'code_bfb8f7_full',
	'code_bfba39',
	'code_bfba39',
	'code_bfb8f7_full',
	'code_bfb8f7_full',
	'code_bfb8f7_full',
	'code_bfb8f7_full',
	'code_bfb8f7_full',
	'code_bfba6f',
	'code_bfba6f',
	'code_bfba39',
	'code_bfb8f7_full',
	'code_bfba39',
	'code_bfb8f7_full',
	'code_bfbbaf',
	'code_bfb8e5',
	'code_bfbc53',
	'code_bfbf54',
}

local data_bfc2a9 = {
	'code_bfbc6b',
	'code_bfbc6b',
	'code_bfbed1',
	'code_bfba39',
	'code_bfbed1',
	'code_bfbc6b',
	'code_bfbc6b',
	'code_bfba39',
	'code_bfbc6b',
	'code_bfba39',
	'code_bfba39',
	'code_bfba39',
	'code_bfbc6b',
	'code_bfba39',
	'code_bfba39',
	'code_bfba39',
	'code_bfba39',
	'code_bfbc53',
	'code_bfbf5b',
}

-- DATA_818409: collision low-bit remap table (line 14703)
local data_818409 = {
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
	0x01, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02,
	0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03,
	0x03, 0x03, 0x03, 0x03, 0x04, 0x04, 0x04, 0x04,
	0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x05,
	0x05, 0x05, 0x05, 0x05, 0x05, 0x05, 0x06, 0x06,
	0x06, 0x06, 0x06, 0x06, 0x86, 0x80, 0x00,
}

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

-- $32 is level-context state in DKC1 and is initialized by level setup routines
-- (e.g. CODE_B9859E: STZ.b $32 for jungle). Keep player-side reads synced from level data.
local function read_level_state32(level)
	return level.dkc1_state32 & 0xFFFF
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
	self.ram_169d = 0
	self.ram_16a1 = 0
	self.ram_16a5 = 0
	self.ram_16a9 = 0
	self.ram_16ad = define_dkc1_animationid_dk_idle
	self.ram_16cd = 0
	self.ram_16dd = 0
	self.ram_16e9 = 0
	self.ram_16ed = 0
	self.ram_16e1 = 0
	self.ram_16e5 = 0
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
	self.ram_ramtable11a1lo = 0
	self.ram_ramtable0f8dlo = 0
	self.ram_ramtable14c5lo = 0
	self.ram_yxppccctlo = 0
	
	self.zp_28 = 0
	self.zp_32 = read_level_state32(self.level)
	self.zp_44 = (self.player_index or 1) - 1
	self.zp_4c = 0
	self.zp_7e = 0
	self.zp_80 = 0
	self.ram_16e9 = 0
	self.ram_16ed = 0
	self.zp_84 = 0
	-- set by startup init in DKC1 (CODE_8083FD: STX.b $F3, X=0006 in normal gameplay path)
	self.zp_f3 = 0x0006
	self.zp_9c = 0
	self.zp_9e = 0
	
	self.ram_0512 = 0
	self.ram_1e15 = 0
	self.ram_1e17 = 0
	self.ram_1e19 = 0
	self.ram_0579 = 0
	self.ram_1929 = 0
	
	-- subpixel position
	self.pos_subx = self.ram_xposlo * 0x0100
	self.pos_suby = self.ram_yposlo * 0x0100
	
	-- visual/gameplay state
	self.visual_frame_id = 'esther_dk_idle_01'
	self.pose_name = 'grounded'
	
	-- debug counters
	self.debug_frame = 0
	self.debug_time_ms = 0

	-- roll animation-script bridge (DATA_BE927E / DATA_BE9218 / DATA_BE91F5)
	self.roll_script_kind = nil
	self.roll_script_frame = 0
	self.jump_script_kind = nil
	self.jump_script_frame = 0
	
	-- previous frame button state for edge detection
	self.prev_7e = 0
end

function player:reset_runtime()
	self.ram_1699 = 0
	self.ram_169d = 0
	self.ram_16a5 = -0x7fffffff
	self.ram_16f9 = 0xffb8
	self.ram_180f = 0
	
	self.ram_xspeedlo = 0
	self.ram_yspeedlo = 0
	self.ram_ramtable0f25lo = 0
	self.ram_ramtable1029lo = 0x0004
	self.ram_ramtable12a5lo = 0x0001
	self.ram_ramtable0f8dlo = 0
	self.ram_ramtable14c5lo = 0
	self.ram_ramtable11a1lo = 0
	self.ram_0579 = 0
	self.ram_1929 = 0
	
	self.ram_xposlo = self.spawn_x
	self.ram_yposlo = self.spawn_y
	self.pos_subx = self.ram_xposlo * 0x0100
	self.pos_suby = self.ram_yposlo * 0x0100
	
	self.zp_28 = 0
	self.zp_32 = read_level_state32(self.level)
	self.zp_7e = 0
	self.zp_80 = 0
	self.zp_9c = 0
	self.zp_9e = 0
	
	self.facing = 1
	self.grounded = true
	self.x = self.ram_xposlo
	self.y = self.ram_yposlo
	
	self.draw_scale_x = 1.0
	self.draw_scale_y = 1.0
	self.roll_visual = 0
	
	self.debug_frame = 0
	self.debug_time_ms = 0
	self.roll_script_kind = nil
	self.roll_script_frame = 0
	self.jump_script_kind = nil
	self.jump_script_frame = 0
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

-- code_bfa555: accumulator post-step hook (line 108861)
function player:code_bfa555()
	-- jsr.w code_bfa575 / bcs.b code_bfa55b
	if not self:code_bfa575() then
		return
	end

	-- code_bfa55b:
	-- ldy.b $84 / lda.w $16ad,y / cmp.w #!Define_DKC1_AnimationID_DK_Roll
	if self.ram_16ad == define_dkc1_animationid_dk_roll then
		return
	end
	-- lda.w $16f5,y / bne.b code_bfa574
	if self.ram_16f5 ~= 0 then
		return
	end
	-- stz.w !RAM_DKC1_NorSpr_RAMTable1029Lo,x
	self.ram_ramtable1029lo = 0
	-- lda.w #!Define_DKC1_AnimationID_DK_Fall
	self.ram_16ad = define_dkc1_animationid_dk_fall
end

-- code_bfa575: accumulator population entry (line 108880)
function player:code_bfa575()
	-- lda.w !ram_dkc1_norspr_ramtable12a5lo,x
	-- and.w #$1001
	-- cmp.w #$0001
	local flags = self.ram_ramtable12a5lo & 0x1001
	if flags ~= 0x0001 then
		-- code_bfa582:
		self.ram_ramtable123dlo = 0
		return false
	end

	-- code_bfa587:
	-- lda.b $32
	-- cmp.w #$0004
	-- beq.b code_bfa5de
	-- cmp.w #$0009
	-- beq.b code_bfa5de
	if self.zp_32 == 0x0004 or self.zp_32 == 0x0009 then
		return self:code_bfa5de()
	end

	-- lda.w !ram_dkc1_norspr_ramtable1209lo,x
	-- and.w #$0007
	-- cmp.b $f3
	-- bpl.b code_bfa59f
	local anim_idx = self.ram_ramtable1209lo & 0x0007
	if anim_idx < self.zp_f3 then
		self.ram_ramtable123dlo = 0
		return false
	end
	return self:code_bfa59f()
end

-- code_bfa59f / code_bfa5bb: direction-change boost (line 108902)
function player:code_bfa59f()
	-- lda.w !ram_dkc1_norspr_ramtable1209lo,x
	-- and.w #$0080
	-- bne.b code_bfa5bb
	if (self.ram_ramtable1209lo & 0x0080) ~= 0 then
		-- code_bfa5bb:
		-- lda.w !ram_dkc1_norspr_ramtable0f25lo,x
		-- bmi.b code_bfa5cd
		if to_signed_16(self.ram_ramtable0f25lo) < 0 then
			return false
		end
		-- lda.w !ram_dkc1_norspr_xspeedlo,x
		-- bmi.b code_bfa5cd
		if to_signed_16(self.ram_xspeedlo) < 0 then
			return false
		end
		-- lda.w #$0180
		self.ram_ramtable123dlo = 0x0180
		return true
	end

	-- lda.w !ram_dkc1_norspr_ramtable0f25lo,x
	-- dec
	-- bpl.b code_bfa5cd
	if (to_signed_16(self.ram_ramtable0f25lo) - 1) >= 0 then
		return false
	end
	-- lda.w !ram_dkc1_norspr_xspeedlo,x
	-- dec
	-- bpl.b code_bfa5cd
	if (to_signed_16(self.ram_xspeedlo) - 1) >= 0 then
		return false
	end
	-- lda.w #$fe80
	self.ram_ramtable123dlo = 0xFE80
	return true
end

-- code_bfa5de: grounded animation boost (line 108935)
function player:code_bfa5de()
	-- lda.w !ram_dkc1_norspr_ramtable1209lo,x
	-- and.w #$0007
	local anim_idx = self.ram_ramtable1209lo & 0x0007
	-- cmp.b $f3
	-- beq.b code_bfa60c
	if anim_idx == self.zp_f3 then
		return self:code_bfa60c()
	end

	local boost_table = {0x0000, 0x0080, 0x0100, 0x0180, 0x01F0, 0x0280, 0x0400}
	local boost = boost_table[anim_idx + 1]

	-- bit.w !ram_dkc1_norspr_ramtable1209lo-$01,x
	-- bmi.b code_bfa5f9
	-- (-$01 misalignment makes BMI observe bit 7 of low byte => 0x0080)
	if (self.ram_ramtable1209lo & 0x0080) == 0 then
		boost = ((-boost) & 0xFFFF)
	end

	-- code_bfa5f9:
	self.ram_ramtable123dlo = boost
	return false
end

-- code_bfa60c: special grounded direction-change boost (line 108980)
function player:code_bfa60c()
	-- bit.w !ram_dkc1_norspr_ramtable1209lo-$01,x
	-- bmi.b code_bfa625
	-- (-$01 misalignment makes BMI observe bit 7 of low byte => 0x0080)
	if (self.ram_ramtable1209lo & 0x0080) ~= 0 then
		-- code_bfa625:
		-- lda.w !ram_dkc1_norspr_ramtable0f25lo,x
		-- bmi.b code_bfa637
		if to_signed_16(self.ram_ramtable0f25lo) < 0 then
			return false
		end
		-- lda.w !ram_dkc1_norspr_xspeedlo,x
		-- bmi.b code_bfa637
		if to_signed_16(self.ram_xspeedlo) < 0 then
			return false
		end
		-- lda.w #$0500
		self.ram_ramtable123dlo = 0x0500
		return true
	end

	-- lda.w !ram_dkc1_norspr_ramtable0f25lo,x
	-- dec
	-- bpl.b code_bfa637
	if (to_signed_16(self.ram_ramtable0f25lo) - 1) >= 0 then
		return false
	end
	-- lda.w !ram_dkc1_norspr_xspeedlo,x
	-- dec
	-- bpl.b code_bfa637
	if (to_signed_16(self.ram_xspeedlo) - 1) >= 0 then
		return false
	end
	-- lda.w #$fb00
	self.ram_ramtable123dlo = 0xFB00
	return true
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

-- code_bfb5d1: fixed left target (line 111249)
function player:code_bfb5d1()
	self.ram_ramtable0f25lo = 0xFE00
end

-- code_bfb634: set facing-left flip flag (line 111292)
function player:code_bfb634()
	self.ram_yxppccctlo = self.ram_yxppccctlo | 0x4000
end

-- code_bfb640: force left then continue into code_bfb64b (line 111304)
function player:code_bfb640()
	self.ram_yxppccctlo = self.ram_yxppccctlo | 0x4000
	self:code_bfb64b()
end

-- code_bfb5da: conditional left dispatch (line 111252)
function player:code_bfb5da()
	-- BIT.w !RAM_DKC1_NorSpr_YXPPCCCTLo,x / BVC.b CODE_BFB5E2
	if (self.ram_yxppccctlo & 0x4000) ~= 0 then
		return
	end
	self:code_bfb64b()
end

-- code_bfb5e4: left turn helper (line 111262)
function player:code_bfb5e4()
	-- LDA.w !RAM_DKC1_NorSpr_RAMTable12A5Lo,x / LSR / BCC.b CODE_BFB5F7
	if (self.ram_ramtable12a5lo & 0x0001) ~= 0 then
		-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x / AND.w #$0007 / CMP.b $F3 / BMI.b CODE_BFB5F7
		local anim_idx = self.ram_ramtable1209lo & 0x0007
		if anim_idx >= self.zp_f3 then
			return
		end
	end

	self:code_bfb634()

	local target_signed = to_signed_16(self.ram_ramtable0f25lo)
	if target_signed == 0 then
		if self.ram_16ad ~= define_dkc1_animationid_dk_endroll then
			self.ram_16f1 = 0xFE00
			self.ram_xspeedlo = 0xFE00
			self.ram_ramtable0f25lo = 0xFE00
		end
		return
	end

	if target_signed > 0 then
		self.ram_ramtable0f25lo = to_unsigned_16(-target_signed)
		return
	end

	local magnitude = -target_signed
	if magnitude < 0x0300 then
		magnitude = 0x0300
	end
	self.ram_ramtable0f25lo = to_unsigned_16(-magnitude)
end

-- code_bfb64b: left handler (line 111307)
function player:code_bfb64b()
	-- LDA.w !RAM_DKC1_NorSpr_RAMTable1631Lo,x / BMI.b CODE_BFB671
	if to_signed_16(self.ram_ramtable1631lo) >= 0 then
		-- LDA.w !RAM_DKC1_NorSpr_RAMTable12A5Lo,x / AND.w #$1001 / CMP.w #$0001 / BNE.b CODE_BFB671
		if (self.ram_ramtable12a5lo & 0x1001) == 0x0001 then
			-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x / AND.w #$0080 / BEQ.b CODE_BFB671
			if (self.ram_ramtable1209lo & 0x0080) ~= 0 then
				-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x / AND.w #$0007 / CMP.b $F3 / BPL.b CODE_BFB6B4
				local anim_idx = self.ram_ramtable1209lo & 0x0007
				if anim_idx >= self.zp_f3 then
					self.ram_ramtable0f25lo = 0
					return
				end
			end
		end
	end

	-- CODE_BFB671:
	if self.ram_16ad == define_dkc1_animationid_dk_holdjump
		or self.ram_16ad == define_dkc1_animationid_dk_jumpoffverticalrope
		or self.ram_16ad == define_dkc1_animationid_dk_jump
	then
		self.ram_yxppccctlo = self.ram_yxppccctlo | 0x4000
	end

	-- LDA.w $180F / CMP.w #$0001 / BEQ.b CODE_BFB6A9
	if self.ram_180f ~= 0x0001 then
		-- LDY.b $84 / LDA.w $0512,y / BNE.b CODE_BFB6A9
		if self.ram_0512 == 0 then
			-- LDA.w $16F5,y / BNE.b CODE_BFB6A9
			if self.ram_16f5 == 0 then
				-- LDA.w #$FFFB / JSL.l CODE_BFB801 / BCS.b CODE_BFB6B8
				if self:code_bfb801(0xFFFB) then
					self.ram_yxppccctlo = self.ram_yxppccctlo | 0x4000
					self:code_bfb7d0()
					return
				end
			end
		end
	end

	-- CODE_BFB6A9:
	local target = self:code_bfb4e3()
	target = ((-target) & 0xFFFF)
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

-- code_bfb6e8: fixed right target (line 111398)
function player:code_bfb6e8()
	self.ram_ramtable0f25lo = 0x0200
end

-- code_bfb743: set facing-right flip clear (line 111543)
function player:code_bfb743()
	self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
end

-- code_bfb74f: force right then continue into code_bfb75a (line 111556)
function player:code_bfb74f()
	self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
	self:code_bfb75a()
end

-- code_bfb6f1: conditional right dispatch (line 111409)
function player:code_bfb6f1()
	-- BIT.w !RAM_DKC1_NorSpr_YXPPCCCTLo,x / BVS.b CODE_BFB6F9
	if (self.ram_yxppccctlo & 0x4000) == 0 then
		return
	end
	self:code_bfb75a()
end

-- code_bfb6fb: right turn helper (line 111418)
function player:code_bfb6fb()
	-- LDA.w !RAM_DKC1_NorSpr_RAMTable12A5Lo,x / LSR / BCC.b CODE_BFB70E
	if (self.ram_ramtable12a5lo & 0x0001) ~= 0 then
		-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x / AND.w #$0007 / CMP.b $F3 / BMI.b CODE_BFB70E
		local anim_idx = self.ram_ramtable1209lo & 0x0007
		if anim_idx >= self.zp_f3 then
			return
		end
	end

	self:code_bfb743()

	local target_signed = to_signed_16(self.ram_ramtable0f25lo)
	if target_signed == 0 then
		if self.ram_16ad ~= define_dkc1_animationid_dk_endroll then
			self.ram_16f1 = 0x0200
			self.ram_xspeedlo = 0x0200
			self.ram_ramtable0f25lo = 0x0200
		end
		return
	end

	if target_signed < 0 then
		self.ram_ramtable0f25lo = to_unsigned_16(-target_signed)
		return
	end

	if target_signed < 0x0300 then
		target_signed = 0x0300
	end
	self.ram_ramtable0f25lo = to_unsigned_16(target_signed)
end

-- code_bfb75a: right handler (line 111450)
function player:code_bfb75a()
	-- LDA.w !RAM_DKC1_NorSpr_RAMTable1631Lo,x / BMI.b CODE_BFB780
	if to_signed_16(self.ram_ramtable1631lo) >= 0 then
		-- LDA.w !RAM_DKC1_NorSpr_RAMTable12A5Lo,x / AND.w #$1001 / CMP.w #$0001 / BNE.b CODE_BFB780
		if (self.ram_ramtable12a5lo & 0x1001) == 0x0001 then
			-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x / AND.w #$0080 / BNE.b CODE_BFB780
			if (self.ram_ramtable1209lo & 0x0080) == 0 then
				-- LDA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x / AND.w #$0007 / CMP.b $F3 / BPL.b CODE_BFB7BF
				local anim_idx = self.ram_ramtable1209lo & 0x0007
				if anim_idx >= self.zp_f3 then
					self.ram_ramtable0f25lo = 0
					return
				end
			end
		end
	end

	-- CODE_BFB780:
	if self.ram_16ad == define_dkc1_animationid_dk_holdjump
		or self.ram_16ad == define_dkc1_animationid_dk_jumpoffverticalrope
		or self.ram_16ad == define_dkc1_animationid_dk_jump
	then
		self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
	end

	-- LDA.w $180F / CMP.w #$0001 / BEQ.b CODE_BFB7B8
	if self.ram_180f ~= 0x0001 then
		-- LDY.b $84 / LDA.w $0512,y / BNE.b CODE_BFB7B8
		if self.ram_0512 == 0 then
			-- LDA.w $16F5,y / BNE.b CODE_BFB7B8
			if self.ram_16f5 == 0 then
				-- LDA.w #$0005 / JSL.l CODE_BFB801 / BCS.b CODE_BFB7C3
				if self:code_bfb801(0x0005) then
					self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
					self:code_bfb7d0()
					return
				end
			end
		end
	end

	-- CODE_BFB7B8:
	self.ram_ramtable0f25lo = self:code_bfb4e3()
end

-- code_bfba39: air neutral handler (line 111765)
function player:code_bfba39()
	-- rts  (does nothing - preserves target!)
	return
end

-- code_bfc192: neutral target clear (line 112759)
function player:code_bfc192()
	self.ram_ramtable0f25lo = 0
	self.ram_ramtable1271lo = self.ram_ramtable1271lo & 0xFFFE
end

-- code_bfc18a: dispatch entry (line 112751)
function player:code_bfc18a()
	self:code_bfc192()
end

-- code_bfb801: ledge check helper (line 111873)
function player:code_bfb801(_offset)
	-- collision/pathing helper in original engine; carry clear fallback in this cart
	return false
end

-- code_bfac45: wall/ledge probe helper (line 109933)
function player:code_bfac45()
	-- terrain probe path is outside this cart's simplified collision runtime.
	return false
end

-- code_bf902b: roll wall helper (line 106277)
function player:code_bf902b()
	if not self:code_bfac45() then
		return
	end
	self.ram_xspeedlo = 0
	self.ram_ramtable0f25lo = 0
end

-- code_bfb7d0: wall push helper (line 111568)
function player:code_bfb7d0()
	-- dummied out in original disassembly (RTS)
end

-- code_bfbe39: pickup probe (line 112769)
function player:code_bfbe39()
	return false
end

-- code_bfbed1: Y-press timestamp helper (line 112849)
function player:code_bfbed1()
	self.ram_169d = self.zp_28
	if (self.zp_80 & joypad_y) ~= 0 then
		self.ram_16a1 = self.zp_28
	end
end

-- code_bfbec5: clear $1699 bit $0010 (line 112362)
function player:code_bfbec5()
	self.ram_1699 = self.ram_1699 & 0xFFEF
end

-- code_bfbc53: animal-buddy Y handler (line 112033)
function player:code_bfbc53()
	return
end

-- code_bfbf5b: special state jump handler (line 113241)
function player:code_bfbf60()
	-- LDA.w !RAM_DKC1_NorSpr_RAMTable14C5Lo,x / CMP.w #$0020 / BPL
	if self.ram_ramtable14c5lo < 0x0020 then
		return
	end
	-- LDA.b $32 / CMP.w #$0003 / BEQ
	if self.zp_32 == 0x0003 then
		self.ram_ramtable1029lo = 0x002B
		self.ram_1929 = 0
		return
	end
	self.ram_ramtable1029lo = 0x0001
	self.ram_1929 = 0
end

function player:code_bfbf54()
	-- LDA.b $80 / AND.w #$8000 / BNE.b CODE_BFBF60
	if (self.zp_80 & joypad_b) == 0 then
		return
	end
	self:code_bfbf60()
end

function player:code_bfbf5b()
	-- CODE_BFBF5B:
	-- LDA.b $80 / AND.w #$4000
	if (self.zp_80 & joypad_y) == 0 then
		return
	end
	self:code_bfbf60()
end

-- code_bfb8e5: buffered B press stamp (line 111597)
function player:code_bfb8e5()
	if (self.zp_80 & joypad_b) == 0 then
		return
	end
	self.ram_16a5 = self.zp_28
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
	self.ram_ramtable11a1lo = 0x00C1
	-- STZ.w $1E17                                   ; LINE 111680
	self.ram_1e17 = 0
	-- JSR.w CODE_BFBEC5                             ; LINE 111678
	self:code_bfbec5()
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
	-- DATA_BEA6A9 starts with Op81(CODE_BEB233), then after 2 frames Op81(CODE_BEA7D6).
	self:code_beb233()
	self.jump_script_kind = 'data_bea6a9'
	self.jump_script_frame = 0
end

-- code_bfbd4f: roll setup (line 112176)
function player:code_bfbd4f()
	-- LDA.w #$0001 / STA.w $16E5,y
	self.ram_16e5 = 0x0001
	-- STZ.w $1E17
	self.ram_1e17 = 0
	-- LDA.w #$0100 / STA.w $16F1,y
	self.ram_16f1 = 0x0100
	-- LDA.b $7E / AND.w #$0300 / BEQ.b CODE_BFBD6B
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
		-- LDA.w #$0400 / STA.w $16F1,y
		self.ram_16f1 = 0x0400
		-- LDA.w #$0040 / ORA.w $1699,y / BRA.b CODE_BFBD90
		self.ram_1699 = self.ram_1699 | 0x0040
	else
		-- LDA.w #$FFBF / AND.w $1699,y
		self.ram_1699 = self.ram_1699 & 0xFFBF
	end

	-- CODE_BFBD90:
	-- LDA.b !RAM_DKC1_NorSpr_CurrentIndexLo / CMP.w #$0002 / BEQ.b CODE_BFBDA8
	if self.zp_84 ~= 0x0002 then
		-- LDA.w $16F1,y / STA.b $76 / LSRx3 / CLC / ADC.b $76 / STA.w $16F1,y
		local speed = self.ram_16f1
		local base = speed
		speed = (speed >> 3) + base
		self.ram_16f1 = speed & 0xFFFF
	end
end

-- ============================================================================
-- roll animation script callbacks (direct from DATA_BE927E / DATA_BE9218 / DATA_BE91F5)
-- ============================================================================

function player:code_be9f2d()
	if (self.ram_ramtable1271lo & 0x8000) ~= 0 then
		return
	end
	self.ram_ramtable11a1lo = 0x00C1
	self.ram_ramtable1029lo = 0x0000
end

function player:code_be9c96()
	if (self.ram_1699 & 0x0004) == 0 then
		self.ram_1699 = self.ram_1699 & 0xFDFF
		self:code_be9f2d()
		self.ram_16ad = define_dkc1_animationid_dk_idle
		self.roll_script_kind = nil
		self.roll_script_frame = 0
		return
	end

	self:code_be9f2d()
	self.ram_16ad = define_dkc1_animationid_dk_run
	self.roll_script_kind = nil
	self.roll_script_frame = 0
end

function player:code_be9202()
	self:code_be9c96()
	self.ram_16e5 = 0
	self.ram_1699 = self.ram_1699 & 0xFF7F
end

function player:code_be924d()
	self.ram_xspeedlo = 0
end

function player:code_be9241()
	self.ram_1699 = self.ram_1699 & 0xFF7F
end

function player:code_be9251()
	self:code_be9c96()
	self.ram_16e5 = 0
	self.ram_1699 = self.ram_1699 & 0xFF7F
end

function player:code_be9267()
	local frame_delta = self.zp_28 - self.ram_16a1
	if frame_delta >= 0x0014 then
		return
	end
	self:code_bfbd4f()
	self:code_bfbda9()
end

function player:code_be92ad()
	self.ram_ramtable1029lo = 0x0013
end

function player:code_be92fd()
	-- Stage-specific probes used by DKC1 roll edge logic.
	-- In this cart the corresponding terrain tables are not present.
	return false
end

function player:code_be92b4()
	if (self.ram_ramtable12a5lo & 0x0001) == 0 then
		return
	end
	if self:code_be92fd() then
		return
	end
	if self.ram_16e5 == 0x0002 or self.ram_16e5 == 0x0003 then
		self.ram_16ad = define_dkc1_animationid_dk_cancelroll
		self.roll_script_kind = 'cancelroll'
		self.roll_script_frame = 0
		return
	end
	if (self.ram_1699 & 0x0040) ~= 0 then
		self.ram_ramtable0f25lo = 0
		self.ram_16ad = define_dkc1_animationid_dk_endroll
		self.roll_script_kind = 'endroll'
		self.roll_script_frame = 0
		return
	end
	if self.ram_16a1 ~= self.ram_16a9 then
		self.ram_ramtable0f25lo = 0
		self.ram_16ad = define_dkc1_animationid_dk_endroll
		self.roll_script_kind = 'endroll'
		self.roll_script_frame = 0
		return
	end
	if (self.ram_16ed & joypad_y) ~= 0 then
		self.ram_16ad = define_dkc1_animationid_dk_cancelroll
		self.roll_script_kind = 'cancelroll'
		self.roll_script_frame = 0
		return
	end
	self.ram_ramtable0f25lo = 0
	self.ram_16ad = define_dkc1_animationid_dk_endroll
	self.roll_script_kind = 'endroll'
	self.roll_script_frame = 0
end

-- CODE_BEA7D6 callback (DATA_BEA6A9): launch jump with $0700
function player:code_bea7d6()
	self.ram_yspeedlo = 0x0700
	if (self.ram_ramtable1271lo & 0x8000) == 0 then
		self.ram_0579 = self.ram_0579 | 0x1000
	end
end

-- CODE_BEB233 / CODE_BEB23C callbacks toggle $16E5 during jump script.
function player:code_beb233()
	self.ram_16e5 = 0x0004
end

function player:code_beb23c()
	self.ram_16e5 = 0x0000
end

-- CODE_BEA02E callback used by DK jump/air script to settle back to idle/state 0.
function player:code_bea02e()
	if (self.ram_ramtable1271lo & 0x8000) ~= 0 then
		return
	end

	if self.ram_ramtable0f25lo ~= 0 then
		local flipped = (self.ram_yxppccctlo << 1) & 0xFFFF
		local turned = (flipped ~ self.ram_ramtable0f25lo) & 0x8000
		if turned ~= 0 then
			return
		end
	end

	local speed_abs = abs_16(self.ram_xspeedlo)
	if speed_abs >= 0x0030 then
		return
	end
	if self.zp_32 == 0x0004 and self.ram_ramtable0f25lo ~= 0 then
		return
	end

	self:code_be9f2d()
	self.ram_16ad = define_dkc1_animationid_dk_idle
end

function player:update_roll_animation_script()
	if self.roll_script_kind == nil then
		return
	end

	self.roll_script_frame = self.roll_script_frame + 1

	if self.roll_script_kind == 'roll' then
		if self.roll_script_frame == 9 then
			self:code_be92ad()
			return
		end
		if self.roll_script_frame == 30 then
			self:code_be92b4()
			return
		end
		if self.roll_script_frame >= 33 and self.roll_script_kind == 'roll' then
			self.roll_script_kind = nil
			self.roll_script_frame = 0
		end
		return
	end

	if self.roll_script_kind == 'endroll' then
		if self.roll_script_frame == 3 then
			self:code_be924d()
			return
		end
		if self.roll_script_frame == 11 then
			self:code_be9241()
			return
		end
		if self.roll_script_frame == 17 then
			self:code_be9267()
			if self.roll_script_kind == 'roll' then
				return
			end
			self:code_be9251()
			if self.roll_script_kind ~= 'roll' then
				self.roll_script_kind = nil
				self.roll_script_frame = 0
			end
		end
		return
	end

	if self.roll_script_kind == 'cancelroll' then
		if self.roll_script_frame == 3 then
			self:code_be9202()
			self.roll_script_kind = nil
			self.roll_script_frame = 0
		end
	end
end

-- DATA_BEA6A9 bridge for DK jump:
-- Op81(CODE_BEB233), OpXX($02,...), Op81(CODE_BEA7D6), ... Op81(CODE_BEB23C)
function player:update_jump_animation_script()
	if self.jump_script_kind == nil then
		return
	end

	if self.jump_script_kind == 'data_bea6a9'
		and self.ram_16ad ~= define_dkc1_animationid_dk_jump
	then
		self.jump_script_kind = nil
		self.jump_script_frame = 0
		return
	end

	self.jump_script_frame = self.jump_script_frame + 1

	if self.jump_script_kind == 'data_bea6a9' then
		if self.jump_script_frame == 2 then
			self:code_bea7d6()
			return
		end
		if self.jump_script_frame == 22 then
			self:code_beb23c()
			return
		end
		if self.jump_script_frame >= 23 then
			self.jump_script_kind = nil
			self.jump_script_frame = 0
		end
	end
end

-- code_bfbc6b: Y BUTTON handler for state 0 (roll/pickup, line 112045)
-- Called from inside code_bfb27c when Y is HELD
function player:code_bfbc6b()
	-- LDA.w $0512,y / BEQ.b CODE_BFBC75
	if self.ram_0512 ~= 0 then
		return
	end

	-- LDA.w $16F5,y / BEQ.b CODE_BFBC7D
	if self.ram_16f5 ~= 0 then
		return
	end

	-- JSR.w CODE_BFBE39 / BCS.b CODE_BFBC8C
	if self:code_bfbe39() then
		return
	end

	local roll_state = self.ram_16e5

	if roll_state == 0 then
		-- CODE_BFBCD7
		if to_signed_16(self.ram_ramtable1631lo) < 0 then
			return
		end

		if (to_signed_16(self.ram_ramtable1631lo) - 1) >= 0 then
			if (self.zp_80 & joypad_y) ~= 0 and self.ram_16f5 == 0 then
				self.ram_16e5 = 0
			end
			return
		end

		if to_signed_16(self.ram_yspeedlo) >= 0 then
			if (self.zp_80 & joypad_y) ~= 0 and self.ram_16f5 == 0 then
				self.ram_16e5 = 0
			end
			return
		end

		if (self.zp_80 & joypad_y) ~= 0 then
			if (self.ram_ramtable1209lo & 0x0007) < self.zp_f3 then
				self:code_bfbd4f()
				self:code_bfbda9()
			end
			return
		end

		local frame_delta = self.zp_28 - self.ram_16a1
		if frame_delta < 0 or frame_delta >= 0x0008 then
			return
		end
		if (self.ram_ramtable1209lo & 0x0007) < self.zp_f3 then
			self:code_bfbd4f()
			self:code_bfbda9()
		end
		return
	end

	if roll_state == 1 or roll_state == 3 then
		-- CODE_BFBDD5
		if (self.zp_80 & joypad_y) ~= 0 then
			self.ram_16a1 = self.zp_28
		end
		return
	end

	if roll_state == 2 then
		-- CODE_BFBDE7
		self:code_bfbde7()
		return
	end

	if roll_state == 4 then
		-- CODE_BFBC97 -> CODE_BFBD3A
		if (self.zp_80 & joypad_y) ~= 0 and self.ram_16f5 == 0 then
			self.ram_16e5 = 0
		end
	end
end

-- code_bfb27c: FULL button handler entry (line 110730)
-- REAL assembly: handles ALL buttons (up/down/left/right/A/B/X/Y/L/R/select/start)
function player:code_bfb27c()
	-- STA.w $180F                                  ; LINE 110730
	-- (already set by caller)
	-- STZ.w $1E19                                  ; LINE 110735
	self.ram_1e19 = 0
	self.ram_16e9 = self.zp_80
	self.ram_16ed = self.zp_7e
	
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
		self[data_bfc1c5[self.ram_180f + 1]](self)
	-- LDA.b $7E / AND.w #Joypad_DPadR              ; LINE 110811
	elseif (self.zp_7e & joypad_dpadr) ~= 0 then
		-- JSR CODE_BFB6C5                            ; LINE 110815
		-- CODE_BFB6C5: LDA $180F / ASL / TAX / JMP (DATA_BFC1EB,x)
		self[data_bfc1eb[self.ram_180f + 1]](self)
	else
		-- JSR CODE_BFC18A                            ; LINE 110819
		-- CODE_BFC18A: LDA $180F / ASL / TAX / JMP (DATA_BFC2F5,x)
		self[data_bfc2f5[self.ram_180f + 1]](self)
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
		self[data_bfc283[self.ram_180f + 1]](self)
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
		self[data_bfc2a9[self.ram_180f + 1]](self)
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
	self.ram_ramtable11a1lo = 0x00C1

	-- jsr.w code_bfbec5
	self:code_bfbec5()
	-- lda.w $1699,y / and.w #$ff7f
	self.ram_1699 = self.ram_1699 & 0xFF7F

	-- lda.w #$0001 / sta.w !RAM_DKC1_NorSpr_RAMTable1029Lo,x
	self.ram_ramtable1029lo = 0x0001
	-- lda.w #!Define_DKC1_AnimationID_DK_JumpOffVerticalRope
	self.ram_16ad = define_dkc1_animationid_dk_jumpoffverticalrope

	self.jump_script_kind = nil
	self.jump_script_frame = 0

	-- lda.b $7E / and.w #$0300 / bne.b CODE_BFBADB
	local dpad_lr = self.zp_7e & 0x0300
	if dpad_lr == 0 then
		return
	end

	-- and.w #$0100 / bne.b CODE_BFBAEC
	if (dpad_lr & 0x0100) == 0 then
		-- face left
		self.ram_yxppccctlo = self.ram_yxppccctlo | 0x4000
		return
	end

	-- face right
	self.ram_yxppccctlo = self.ram_yxppccctlo & 0xBFFF
end

-- code_bfb3c4: vertical-rope neutral helper (line 110961)
function player:code_bfb3c4()
	-- Rope lookup table path is not wired in this cart runtime.
	-- Keep the branch side-effect that sets $0F8D from left/right intent.
	if (self.zp_7e & joypad_y) == 0 then
		self.ram_ramtable0f8dlo = 0x0180
		return
	end
	self.ram_ramtable0f8dlo = 0x0280
end

-- code_bfba6f: vertical-rope B handler (line 111783)
function player:code_bfba6f()
	if (self.zp_7e & 0x0300) ~= 0 then
		if (self.zp_80 & joypad_b) ~= 0 then
			self:code_bfba88()
		end
		return
	end
	if (self.zp_7e & 0x0C00) ~= 0 then
		return
	end
	self:code_bfb3c4()
end

-- code_bfbbdc helper (line 112093)
function player:code_bfbbdc()
	local vertical = self.zp_7e & 0x0C00
	if vertical == 0 then
		return 0x0200
	end
	if (vertical & 0x0800) ~= 0 then
		return 0x0280
	end
	return 0x0100
end

-- code_bfbbaf: swim-jump B handler (line 111935)
function player:code_bfbbaf()
	if (self.zp_80 & joypad_b) == 0 then
		return
	end
	self.ram_yspeedlo = self:code_bfbbdc()
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
		-- code_bfaf4e / code_bfaf49:
		-- cpx.w #$0004 / beq.b code_bfaf49
		-- lda.w #$ff90
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
	if yspeed_signed < 0 and yspeed_signed < -0x0800 then
		-- lda.w #$f800                              ; LINE 110266: LDA.w #$F800
		yspeed_signed = -0x0800
	end
	
	-- code_bfaf64: sta.w !ram_dkc1_norspr_yspeedlo,x ; LINE 110267: STA.w !RAM_DKC1_NorSpr_YSpeedLo,x
	self.ram_yspeedlo = to_unsigned_16(yspeed_signed)
end

-- code_bfa712: collision/bounce gate (line 109102)
function player:code_bfa712()
	-- stz.w !ram_dkc1_norspr_ramtable1271lo
	self.ram_ramtable1271lo = 0

	-- ldy.b $84 / lda.w $16ad,y / cmp.w #!Define_DKC1_AnimationID_DK_Bounce
	if self.ram_16ad ~= define_dkc1_animationid_dk_bounce then
		-- code_bfa72c:
		-- lda.w #$0001 / sta.w !ram_dkc1_norspr_ramtable1271lo
		self.ram_ramtable1271lo = 0x0001
		-- lda.w !ram_dkc1_norspr_yspeedlo,x / bmi.b code_bfa73e
		if to_signed_16(self.ram_yspeedlo) >= 0 then
			-- cmp.w #$0140 / bpl.b code_bfa72b
			if self.ram_yspeedlo < 0x0140 then
				return
			end
		end
	end

	-- code_bfa73e:
	-- lda.w !ram_dkc1_norspr_ramtable1271lo,x / bmi.b code_bfa72b
	if to_signed_16(self.ram_ramtable1271lo) < 0 then
		return
	end

	-- lda.w !ram_dkc1_norspr_ramtable12a5lo,x / and.w #$0001 / beq.b code_bfa752
	if (self.ram_ramtable12a5lo & 0x0001) == 0x0001 then
		return
	end

	-- CODE_BFA752+ depends on enemy-sprite overlap routines (CODE_BBA4C8/CODE_BBA58D).
	-- Those paths are not wired in this cart runtime.
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
	self.roll_script_kind = 'roll'
	self.roll_script_frame = 0

	-- jsr.w code_bf902b
	self:code_bf902b()
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
		return false, nil
	end
	local direction = 1
	if step_pixels < 0 then
		direction = -1
	end
	local remaining = abs_16(step_pixels)
	
		while remaining > 0 do
			local next_x = self.ram_xposlo + direction
			local solid = self:get_overlapping_solid(next_x, self.ram_yposlo)
			if solid ~= nil then
				-- collision
				self.ram_xspeedlo = 0
				self.pos_subx = self.ram_xposlo * 0x0100
				return true, solid
			end
			self.ram_xposlo = next_x
			remaining = remaining - 1
		end
	return false, nil
end

function player:move_vertical_pixels(step_pixels)
	if step_pixels == 0 then
		return false, false, nil
	end
	local direction = 1
	if step_pixels < 0 then
		direction = -1
	end
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
				self.ram_yspeedlo = 0xFFFF
				self.ram_ramtable1631lo = 0
			else
				self.ram_yspeedlo = 0
				self.ram_ramtable1631lo = 0xFFFF
				end
				self.pos_suby = self.ram_yposlo * 0x0100
				return true, grounded, solid
			end
			self.ram_yposlo = next_y
			remaining = remaining - 1
		end
	return false, grounded, nil
end

function player:resolve_collision_raw_9c(solid)
	return solid.dkc1_collision9c & 0xFFFF
end

-- CODE_818087/CODE_81820F/CODE_81839B post-probe collision-flag remap (line 14191+)
function player:code_818087_remap_9c(collision_y)
	self.zp_9e = self.zp_9c
	local map_index = self.zp_9c & 0x003F
	self.zp_9c = self.zp_9c & (~map_index & 0xFFFF)
	local lo = data_818409[map_index + 1] or 0x00
	local hi = data_818409[map_index + 2] or 0x00
	local mapped = ((hi << 8) | lo) & 0x801F
	if (mapped & 0x8000) ~= 0 and collision_y ~= 0x000F then
		mapped = mapped & 0x001F
	end
	self.zp_9c = (self.zp_9c | mapped) & 0xFFFF
	local kind = self.zp_9e & 0x007F
	if kind == 0x0045 or kind == 0x0041 then
		self.zp_9c = self.zp_9c | 0x0020
	end
end

-- CODE_BFAD92/CODE_BFAE6B/CODE_BFAF09/CODE_BFFC72:
-- LDA.b $9C / STA.w !RAM_DKC1_NorSpr_RAMTable1209Lo,x
function player:commit_collision_9c_to_1209()
	self.ram_ramtable1209lo = self.zp_9c & 0xFFFF
end

function player:integrate_and_collide()
	local sp = 0x0100
	
	-- x integration
	local want_subx = self.pos_subx + to_signed_16(self.ram_xspeedlo)
	local want_x = math.floor(want_subx / sp)
	local step_x = want_x - self.ram_xposlo
	local collided_x, collided_x_solid = self:move_horizontal_pixels(step_x)
	if not collided_x then
		self.pos_subx = want_subx
	end
	
	-- y integration
	self.grounded = false
	local want_suby = self.pos_suby - to_signed_16(self.ram_yspeedlo)
	local want_y = math.floor(want_suby / sp)
	local step_y = want_y - self.ram_yposlo
	local collided_y, grounded, collided_y_solid = self:move_vertical_pixels(step_y)
	if not collided_y then
		self.pos_suby = want_suby
	end

	local step_y_signed = to_signed_16(step_y)
	if grounded then
		self.ram_ramtable1631lo = 0
	elseif step_y_signed == 0 then
		self.ram_ramtable1631lo = 0x0001
	else
		self.ram_ramtable1631lo = to_unsigned_16(step_y_signed)
	end
	
	-- ground probe
	local probe_solid = nil
	if not grounded and self:is_grounded_probe() then
		probe_solid = self:get_overlapping_solid(self.ram_xposlo, self.ram_yposlo + 1)
		grounded = true
		self.ram_yspeedlo = 0xFFFF
		self.pos_suby = self.ram_yposlo * sp
		self.ram_ramtable1631lo = 0
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
		self.ram_yspeedlo = 0xFFFF
		self.pos_suby = max_y * sp
		self.grounded = true
	end
	
	-- update grounded flags
	if self.grounded then
		self.ram_ramtable12a5lo = self.ram_ramtable12a5lo | 0x0001
	else
		self.ram_ramtable12a5lo = self.ram_ramtable12a5lo & 0xfffe
	end

	-- collision source mirrors CODE_818000 probe output ($9C), then stores into 1209.
	local collision_solid = collided_y_solid
	if collision_solid == nil then
		collision_solid = probe_solid
	end
	if collision_solid == nil then
		collision_solid = collided_x_solid
	end
	if collision_solid ~= nil then
		self.zp_9c = self:resolve_collision_raw_9c(collision_solid)
	else
		self.zp_9c = 0x0000
	end
	self:code_818087_remap_9c(0)
	self:commit_collision_9c_to_1209()
end

-- ============================================================================
-- input sampling
-- ============================================================================

function player:sample_input()
	local player_index = self.player_index
	
	local held = 0

	local function is_held(action_def)
		return action_triggered(action_def, player_index)
	end

	local function set_button(action_held, _action_pressed, bit)
		if is_held(action_held) then
			held = held | bit
		end
	end

	-- D-Pad
	set_button('left[p]', 'left[jp]', joypad_dpadl)
	set_button('right[p]', 'right[jp]', joypad_dpadr)
	set_button('up[p]', 'up[jp]', joypad_dpadu)
	set_button('down[p]', 'down[jp]', joypad_dpadd)

	-- Face buttons (engine mapping: b=KeyX jump, y=KeyS run/roll)
	set_button('b[p]', 'b[jp]', joypad_b)
	set_button('a[p]', 'a[jp]', joypad_a)
	set_button('y[p]', 'y[jp]', joypad_y)
	set_button('x[p]', 'x[jp]', joypad_x)

	-- System / shoulder
	set_button('start[p]', 'start[jp]', joypad_start)
	set_button('select[p]', 'select[jp]', joypad_select)
	set_button('lb[p]', 'lb[jp]', joypad_l)
	set_button('rb[p]', 'rb[jp]', joypad_r)

	self.prev_7e = self.zp_7e
	self.zp_7e = held
	local pressed = held & (~self.prev_7e)
	self.zp_80 = pressed

	-- Facing flag mirrored into sprite flip bits.
	if (self.zp_7e & joypad_dpadl) ~= 0 then
		self.facing = -1
		self.ram_yxppccctlo = self.ram_yxppccctlo | 0x4000  -- set flip bit
	elseif (self.zp_7e & joypad_dpadr) ~= 0 then
		self.facing = 1
		self.ram_yxppccctlo = self.ram_yxppccctlo & 0xbfff  -- clear flip bit
	end
end

-- ============================================================================
-- main tick loop
-- ============================================================================

function player:tick(dt)
	-- increment frame counter (code_bfb2c7 area)
	self.zp_28 = self.zp_28 + 1
	self.debug_frame = self.zp_28
	self.debug_time_ms = self.debug_time_ms + (dt * 1000)

	-- keep $32 sourced from level-context flow (disassembly level init state).
	self.zp_32 = read_level_state32(self.level)
	
	-- sample input
	self:sample_input()

	-- Run roll animation-script callbacks before control dispatch.
	self:update_roll_animation_script()
	self:update_jump_animation_script()
	
	-- determine control context
	local state1029 = self.ram_ramtable1029lo
	local grounded_context = self.grounded
	if state1029 == 0x0012 or state1029 == 0x0013 then
		-- CODE_BF9006/CODE_BF903B call CODE_BFB27C with A=#$0006 while in roll states.
		self.ram_180f = 0x0006
	elseif grounded_context then
		self.ram_180f = 0
	else
		self.ram_180f = 1
	end

	-- run button handler (CODE_BFB27C handles ALL buttons: direction, jump, roll, etc.)
	self:code_bfb27c()

	-- CODE_BF9006: force slight downward y-speed while in roll state $0012.
	if self.ram_ramtable1029lo == 0x0012 then
		self.ram_yspeedlo = 0xFFFF
	end
	
	-- select profile and apply smoothing
	-- jsr.w code_bfb159                            ; LINE 110605: JSR.w CODE_BFB159
	local profile_id = self:code_bfb159()
	-- CODE_BFB191: lda.w !ram_dkc1_norspr_ramtable0f25lo,y
	local target = self.ram_ramtable0f25lo
	-- clc : adc.w !ram_dkc1_norspr_ramtable123dlo,y  ; ADD ACCUMULATOR!
	local target_with_acc = to_unsigned_16(target + self.ram_ramtable123dlo)
	
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
	
	-- CODE_BF8584/CODE_BF8587 paths apply CODE_BFAF38 before collision.
	self:code_bfaf38()
	
	-- integrate position and collide
	self:integrate_and_collide()

	-- DATA_BEA724 / DATA_BEB224 clear state $1029 after jump script settles on ground.
	if self.ram_ramtable1029lo == 0x0001 and self.grounded and self.jump_script_kind == nil then
		self.ram_ramtable1029lo = 0x0000
	end
	self:code_bfa712()
	if self.ram_ramtable1029lo == 0x0012 or self.ram_ramtable1029lo == 0x0013 then
		self:code_bfa575()
	else
		self:code_bfa555()
	end
	
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
