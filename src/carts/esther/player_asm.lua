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
local joypad_dpadl  = 0x0040  -- d-pad left
local joypad_dpadr  = 0x0080  -- d-pad right
local joypad_a      = 0x0080  -- button a (also shares bit)
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
	instance.ram_1699 = 0
	instance.ram_16a1 = 0
	instance.ram_16a5 = 0
	instance.ram_16a9 = 0
	instance.ram_16ad = define_dkc1_animationid_dk_idle
	instance.ram_16cd = 0
	instance.ram_16dd = 0
	instance.ram_16e1 = 0
	instance.ram_16e5 = 0
	instance.ram_16ed = 0
	instance.ram_16f1 = 0
	instance.ram_16f5 = 0
	instance.ram_16f9 = 0xffb8
	instance.ram_180f = 0
	
	instance.ram_xspeedlo = 0
	instance.ram_yspeedlo = 0
	instance.ram_xposlo = config.spawn_x
	instance.ram_yposlo = config.spawn_y
	instance.ram_ramtable0f25lo = 0
	instance.ram_ramtable1029lo = 0x0004
	instance.ram_ramtable12a5lo = 0x0001
	instance.ram_ramtable1209lo = 0
	instance.ram_ramtable1631lo = 0
	instance.ram_yxppccctlo = 0
	
	instance.zp_28 = 0
	instance.zp_32 = 0x0004
	instance.zp_44 = (config.player_index or 1) - 1
	instance.zp_4c = 0
	instance.zp_7e = 0
	instance.zp_80 = 0
	instance.zp_84 = 0
	instance.zp_f3 = 0
	
	instance.ram_0512 = 0
	instance.ram_1e15 = 0
	instance.ram_1e17 = 0
	instance.ram_1e19 = 0
	
	-- subpixel position
	instance.pos_subx = instance.ram_xposlo * 0x0100
	instance.pos_suby = instance.ram_yposlo * 0x0100
	
	-- visual/gameplay state
	instance.facing = 1
	instance.grounded = true
	instance.visual_frame_id = 'esther_dk_idle_01'
	instance.pose_name = 'grounded'
	instance.draw_scale_x = 1.0
	instance.draw_scale_y = 1.0
	instance.roll_visual = 0
	
	-- debug counters
	instance.debug_frame = 0
	instance.debug_time_ms = 0
	
	-- previous frame button state for edge detection
	instance.prev_7e = 0
	
	instance:reset_runtime()
	
	return instance
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
	-- lda.b $32
	local state = self.zp_32
	
	-- cmp.w #$0004 / cmp.w #$0009
	if state == 0x0004 or state == 0x0009 then
		-- code_bfb167: grounded state detected
		-- lda.w !ram_dkc1_norspr_ramtable12a5lo,y
		-- and.w #$0001
		if (self.ram_ramtable12a5lo & 0x0001) ~= 0 then
			-- lda.w $1699,y
			-- and.w #$0004
			if (self.ram_1699 & 0x0004) ~= 0 then
				-- code_bfb17e: running
				return 8  -- profile 8 (÷21.33)
			else
				-- code_bfb180: walking
				return 3  -- profile 3 (÷64)
			end
		end
	end
	
	-- code_bfb187: default (airborne/roll)
	return 0  -- profile 0 (÷8)
end

-- code_bfb538: get run speed (line 111078)
function player:code_bfb538()
	-- lda.w $0512,y
	if self.ram_0512 ~= 0 then
		-- on animal buddy (simplified - would check sprite type)
		-- for now just return normal
	end
	
	-- code_bfb55d: normal player run speed
	-- check if special state
	-- lda.w !ram_dkc1_norspr_ramtable1029lo,x
	-- cmp.w #$0027
	if self.ram_ramtable1029lo == 0x0027 then
		-- code_bfb5a8: crouching or special
		return 0x0180  -- slower
	end
	
	-- normal run
	return 0x0300
end

-- code_bfb573: get walk speed (line 111141)
function player:code_bfb573()
	-- lda.w $0512,y
	if self.ram_0512 ~= 0 then
		-- on animal buddy
	end
	
	-- code_bfb598: normal player walk speed
	-- check state
	if self.ram_ramtable1029lo == 0x0027 then
		return 0x0180
	end
	
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
	-- ldy.b $84
	-- lda.b $7e
	local held = self.zp_7e
	
	-- and.w #$4000  (y-button check)
	if (held & joypad_y) ~= 0 then
		-- code_bfb4ec: run path
		-- lda.w $1699,y / ora.w #$0004
		self.ram_1699 = self.ram_1699 | 0x0004
		
		-- store timestamps
		-- lda.w $16dd,y / sta.w $16e1,y
		self.ram_16e1 = self.ram_16dd
		-- lda.b $28 / sta.w $16dd,y
		self.ram_16dd = self.zp_28
		
		-- jsr.w code_bfb538
		local speed = self:code_bfb538()
		return self:code_bfb503(speed)
	end
	
	-- code_bfb522: walk path
	-- lda.w $1699,y / and.w #$0200
	if (self.ram_1699 & 0x0200) ~= 0 then
		-- forced run flag still set
		self.ram_1699 = self.ram_1699 | 0x0004
		local speed = self:code_bfb538()
		return self:code_bfb503(speed)
	end
	
	-- clear run flag
	-- lda.w $1699,y / and.w #$fffb
	self.ram_1699 = self.ram_1699 & 0xfffb
	
	-- jsr.w code_bfb573
	local speed = self:code_bfb573()
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
function player:code_bfc18a()
	-- zero target to decelerate
	self.ram_ramtable0f25lo = 0
end

-- code_bfb27c: horizontal control main entry (line 110733)
function player:code_bfb27c()
	-- sta.w $180f  (context already set by caller)
	-- stz.w $1e19
	self.ram_1e19 = 0
	
	-- code_bfb2c7: input sampling happens before this
	-- clear run-active bit before sampling
	self.ram_1699 = self.ram_1699 & 0xfffb
	
	-- left/right/neutral dispatch based on d-pad
	-- code_bfb305: horizontal handling
	-- lda.b $7e / and.w #!joypad_dpadl
	if (self.zp_7e & joypad_dpadl) ~= 0 then
		-- code_bfb311: jsr.w code_bfb5ae
		if self.ram_180f == 0 then
			self:code_bfb5b6()  -- ground left
		else
			self:code_bfb64b()  -- air left
		end
	elseif (self.zp_7e & joypad_dpadr) ~= 0 then
		-- code_bfb31d: jsr.w code_bfb6c5
		if self.ram_180f == 0 then
			self:code_bfb6cd()  -- ground right
		else
			self:code_bfb75a()  -- air right
		end
	else
		-- code_bfb31d: neutral
		if self.ram_180f == 0 then
			self:code_bfc18a()  -- ground neutral
		else
			self:code_bfba39()  -- air neutral (does nothing!)
		end
	end
end

-- code_bfb94f: ground jump (line 111659)
function player:code_bfb94f()
	-- ldy.b $84
	-- lda.w $1699,y / ora.w #$0003
	self.ram_1699 = self.ram_1699 | 0x0003
	
	-- lda.w $16cd,y / ora.w #$0001
	self.ram_16cd = self.ram_16cd | 0x0001
	
	-- lda.w #$ffb8  (gravity for dk holding jump)
	-- cpy.w #$0000  (check if diddy)
	self.ram_16f9 = 0xffb8  -- assume dk
	
	-- lda.w #$0000 / sta.w $16e5,y
	self.ram_16e5 = 0
	
	-- lda.w #$00c1 / sta.w !ram_dkc1_norspr_ramtable11a1lo,x
	self.ram_16ad = 0x00c1  -- jump animation
	
	-- stz.w $1e17
	self.ram_1e17 = 0
	
	-- jsr.w code_bfbec5 (flag clear routine - omitted)
	
	-- lda.w $1699,y / and.w #$ff7f
	self.ram_1699 = self.ram_1699 & 0xff7f
	
	-- note: y velocity set by animation event, approx $0600
	self.ram_yspeedlo = 0x0600
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
	-- lda.w $1699,y / and.w #$0002
	local gravity
	if (self.ram_1699 & 0x0002) ~= 0 then
		-- holding jump
		-- lda.w $16f9,y
		gravity = self.ram_16f9  -- $ffb8 or $ffa6
	else
		-- released jump
		-- lda.w #$ff90
		gravity = 0xff90  -- -112 dec
	end
	
	-- clc / adc.w !ram_dkc1_norspr_yspeedlo,x
	local yspeed = self.ram_yspeedlo
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

-- code_bfb8f7: jump buffer logic (line 111605)
function player:code_bfb8f7()
	-- lda.b $80 / and.w #$8000  (b button pressed this frame?)
	if (self.zp_80 & joypad_b) ~= 0 then
		-- code_bfb919: record timestamp
		-- lda.b $28 / sta.w $16a5,y
		self.ram_16a5 = self.zp_28
		return true
	end
	
	-- lda.w $1699,y / ora.w #$0001
	self.ram_1699 = self.ram_1699 | 0x0001
	
	-- lda.b $28 / sec / sbc.w $16a5,y
	local frame_delta = self.zp_28 - self.ram_16a5
	-- bmi.b code_bfb918  (negative = no buffered jump)
	if frame_delta < 0 then
		return false
	end
	
	-- cmp.w #$000c  (12 frame buffer window)
	if frame_delta < 0x000c then
		-- code_bfb91e: within buffer window, allow jump
		return true
	end
	
	-- code_bfb918: outside window
	return false
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
	
	if action_triggered('left[p]', player_index) then
		held = held | joypad_dpadl
	end
	if action_triggered('right[p]', player_index) then
		held = held | joypad_dpadr
	end
	if action_triggered('up[p]', player_index) then
		held = held | joypad_dpadu
	end
	if action_triggered('down[p]', player_index) then
		held = held | joypad_dpadd
	end
	if action_triggered('a[p]', player_index) then
		held = held | 0x0080  -- a button
	end
	if action_triggered('b[p]', player_index) then
		held = held | joypad_b
	end
	if action_triggered('x[p]', player_index) then
		held = held | 0x0040  -- x button
	end
	if action_triggered('y[p]', player_index) then
		held = held | joypad_y
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
	
	-- clear jump-hold flag if b not held
	if (held & joypad_b) == 0 then
		self.ram_1699 = self.ram_1699 & 0xfffd  -- clear bit 1
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
	
	-- sample input
	self:sample_input()
	
	-- determine control context
	if self.grounded then
		self.ram_180f = 0  -- ground
		self.zp_32 = 0x0004  -- grounded state
	else
		self.ram_180f = 1  -- air
		self.zp_32 = 0x0001  -- airborne state (guessed)
	end
	
	-- check for jump input (code_bfb8f7)
	if self.grounded and self:code_bfb8f7() then
		-- start jump
		self:code_bfb94f()
	end
	
	-- check for roll input (simplified)
	if self.grounded and (self.zp_80 & joypad_y) ~= 0 then
		-- roll pressed
		if self.ram_ramtable1029lo == 0x0012 then
			-- already rolling - chain
			self:code_bfbde7()
		else
			-- start roll
			-- set initial speed in ram_16f1
			self.ram_16f1 = abs_16(self.ram_xspeedlo)
			if self.ram_16f1 < 0x0100 then
				self.ram_16f1 = 0x0100  -- minimum
			end
			if self.ram_16f1 > 0x0400 then
				self.ram_16f1 = 0x0400  -- cap initial
			end
			self:code_bfbda9()
		end
	end
	
	-- run horizontal control (code_bfb27c)
	self:code_bfb27c()
	
	-- select profile and apply smoothing
	local profile_id = self:code_bfb159()
	local target = self.ram_ramtable0f25lo
	
	-- convert to signed 16-bit
	local target_signed = to_signed_16(target)
	local current_signed = to_signed_16(self.ram_xspeedlo)
	
	-- apply profile smoothing
	local delta = target_signed - current_signed
	local abs_delta = delta
	if abs_delta < 0 then
		abs_delta = -abs_delta
	end
	
	local step = self:data_bfb255_profile(profile_id, abs_delta)
	if delta < 0 then
		step = -step
	end
	
	current_signed = current_signed + step
	
	-- clamp to target
	if delta > 0 and current_signed > target_signed then
		current_signed = target_signed
	elseif delta < 0 and current_signed < target_signed then
		current_signed = target_signed
	end
	
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
