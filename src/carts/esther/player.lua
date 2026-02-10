local constants = require('constants.lua')

local player = {}
player.__index = player

local player_fsm_id = constants.ids.player_fsm
local player_state_grounded = player_fsm_id .. ':/grounded'
local player_state_airborne = player_fsm_id .. ':/airborne'
local player_state_roll = player_fsm_id .. ':/roll'

local jump_timeline_id = 'dkc.player.jump_squash'
local landing_timeline_id = 'dkc.player.landing_squash'
local roll_wobble_timeline_id = 'dkc.player.roll_wobble'

local function abs(value)
	if value < 0 then
		return -value
	end
	return value
end

local function sign(value)
	if value < 0 then
		return -1
	end
	if value > 0 then
		return 1
	end
	return 0
end

local function overlaps(ax, ay, aw, ah, box)
	return ax < (box.x + box.w) and (ax + aw) > box.x and ay < (box.y + box.h) and (ay + ah) > box.y
end

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

local function approach_subpx(current, target, profile_id)
	if current == target then
		return target
	end
	local delta = target - current
	local abs_delta = abs(delta)
	local step = profile_step(abs_delta, profile_id)
	if step == 0 then
		return target
	end
	if delta < 0 then
		step = -step
	end
	local value = current + step
	if delta > 0 and value > target then
		return target
	end
	if delta < 0 and value < target then
		return target
	end
	return value
end

local function next_index(current, count)
	local index = current + 1
	if index > count then
		return 1
	end
	return index
end

function player:get_pickup_barrel()
	local cfg = constants.barrel
	local probe = cfg.pickup_probe_px
	local px = self.x - probe
	local py = self.y - 2
	local pw = self.width + (probe * 2)
	local ph = self.height + 4
	local barrels = self.level.barrels
	for i = 1, #barrels do
		local barrel = barrels[i]
		if self.debug_frame >= barrel.spawn_frame and barrel.state == 'idle' and barrel.throw_lock_frames == 0 and overlaps(px, py, pw, ph, barrel) then
			return i, barrel
		end
	end
	return 0, nil
end

function player:sync_carried_barrel_position()
	if self.carried_barrel_index == 0 then
		return
	end
	local barrel = self.level.barrels[self.carried_barrel_index]
	local cfg = constants.barrel
	local sp = constants.dkc.subpixels_per_px
	local x = self.x + math.floor((self.width - barrel.w) * 0.5) + (self.facing * cfg.carry_offset_forward_px)
	local y = self.y - cfg.carry_offset_up_px
	barrel.x = x
	barrel.y = y
	barrel.pos_subx = x * sp
	barrel.pos_suby = y * sp
	barrel.x_speed_subpx = 0
	barrel.y_speed_subpx = 0
	barrel.grounded = false
	barrel.state = 'held'
end

function player:try_pickup_barrel()
	if self.carried_barrel_index ~= 0 then
		return false
	end
	if not self.grounded then
		return false
	end
	if not self.run_held then
		return false
	end
	local index, barrel = self:get_pickup_barrel()
	if index == 0 then
		return false
	end
	self.carried_barrel_index = index
	barrel.state = 'held'
	self:sync_carried_barrel_position()
	self.debug_barrel_pickup = true
	self.debug_barrel_pickup_index = index
	return true
end

function player:throw_carried_barrel()
	local index = self.carried_barrel_index
	local barrel = self.level.barrels[index]
	local cfg = constants.barrel
	local sp = constants.dkc.subpixels_per_px

	local throw_x = self.x + self.width + cfg.throw_spawn_forward_px
	if self.facing < 0 then
		throw_x = self.x - barrel.w - cfg.throw_spawn_forward_px
	end
	local throw_y = self.y + cfg.throw_spawn_up_px
	barrel.x = throw_x
	barrel.y = throw_y
	barrel.pos_subx = throw_x * sp
	barrel.pos_suby = throw_y * sp

	local throw_mode = 'ground'
	local throw_speed = cfg.throw_ground_speed_subpx
	local throw_up = cfg.throw_ground_up_subpx
	if not self.grounded then
		throw_mode = 'air'
		throw_speed = cfg.throw_air_speed_subpx
		throw_up = cfg.throw_air_up_subpx
	end
	barrel.x_speed_subpx = self.facing * throw_speed
	barrel.y_speed_subpx = throw_up
	barrel.grounded = false
	barrel.state = 'thrown'
	barrel.throw_lock_frames = cfg.regrab_lock_frames
	barrel.trace_frames_left = cfg.trace_frames

	self.carried_barrel_index = 0
	self.debug_barrel_throw = true
	self.debug_barrel_throw_index = index
	self.debug_barrel_throw_mode = throw_mode
	self.debug_barrel_throw_base_sx = throw_speed
	self.debug_barrel_throw_base_sy = throw_up
	self.debug_barrel_throw_player_sx = self.x_speed_subpx
	self.debug_barrel_throw_sx = barrel.x_speed_subpx
	self.debug_barrel_throw_sy = barrel.y_speed_subpx
end

function player:update_barrel_interaction()
	if self.carried_barrel_index == 0 then
		self:try_pickup_barrel()
		return
	end
	if self.run_released then
		self:throw_carried_barrel()
	end
end

function player:define_motion_timelines()
	self:define_timeline(new_timeline({
		id = jump_timeline_id,
		frames = {
			{ draw_scale_x = 0.92, draw_scale_y = 1.12 },
			{ draw_scale_x = 1.0, draw_scale_y = 1.0 },
		},
		ticks_per_frame = 8,
		playback_mode = 'once',
		apply = true,
	}))
	self:define_timeline(new_timeline({
		id = landing_timeline_id,
		frames = {
			{ draw_scale_x = 1.14, draw_scale_y = 0.8 },
			{ draw_scale_x = 0.94, draw_scale_y = 1.08 },
			{ draw_scale_x = 1.0, draw_scale_y = 1.0 },
		},
		ticks_per_frame = 12,
		playback_mode = 'once',
		apply = true,
	}))
	self:define_timeline(new_timeline({
		id = roll_wobble_timeline_id,
		playback_mode = 'loop',
		tracks = {
			{
				kind = 'wave',
				path = { 'roll_visual' },
				base = 0,
				amp = 0.16,
				period = 0.1,
				phase = 0,
				wave = 'sin',
			},
		},
	}))
end

function player:set_visual_cycle(cycle_id)
	if self.visual_cycle_id == cycle_id then
		return
	end
	self.visual_cycle_id = cycle_id
	self.visual_cycle_index = 1
	self.visual_cycle_elapsed_ms = 0
	self.visual_distance_accum_subpx = 0
end

function player:advance_visual_by_time(dt, frame_ms, frame_count)
	self.visual_cycle_elapsed_ms = self.visual_cycle_elapsed_ms + dt
	while self.visual_cycle_elapsed_ms >= frame_ms do
		self.visual_cycle_elapsed_ms = self.visual_cycle_elapsed_ms - frame_ms
		self.visual_cycle_index = next_index(self.visual_cycle_index, frame_count)
	end
end

function player:advance_visual_by_distance(step_subpx, frame_count)
	self.visual_distance_accum_subpx = self.visual_distance_accum_subpx + abs(self.x_speed_subpx)
	while self.visual_distance_accum_subpx >= step_subpx do
		self.visual_distance_accum_subpx = self.visual_distance_accum_subpx - step_subpx
		self.visual_cycle_index = next_index(self.visual_cycle_index, frame_count)
	end
end

function player:update_visual_frame(dt)
	local anim = constants.animation
	local speed = abs(self.x_speed_subpx)

	if self.pose_name == 'roll' then
		local frames = anim.roll.frames
		self:set_visual_cycle('roll')
		self:advance_visual_by_distance(anim.roll.distance_step_subpx, #frames)
		self.visual_frame_id = frames[self.visual_cycle_index]
		return
	end

	if self.pose_name == 'airborne' then
		self:set_visual_cycle('air')
		if self.y_speed_subpx > 0 then
			self.visual_frame_id = anim.air.rise_frame
		else
			self.visual_frame_id = anim.air.fall_frame
		end
		return
	end

	if speed <= anim.move_epsilon_subpx then
		local frames = anim.idle.frames
		self:set_visual_cycle('idle')
		self:advance_visual_by_time(dt, anim.idle.frame_ms, #frames)
		self.visual_frame_id = frames[self.visual_cycle_index]
		return
	end

	if speed >= anim.run_threshold_subpx then
		local frames = anim.run.frames
		self:set_visual_cycle('run')
		self:advance_visual_by_distance(anim.run.distance_step_subpx, #frames)
		self.visual_frame_id = frames[self.visual_cycle_index]
		return
	end

	local frames = anim.walk.frames
	self:set_visual_cycle('walk')
	self:advance_visual_by_distance(anim.walk.distance_step_subpx, #frames)
	self.visual_frame_id = frames[self.visual_cycle_index]
end

function player:emit_event(name, extra)
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	if extra ~= nil and extra ~= '' then
		print(string.format('%s|f=%d|name=%s|%s', telemetry.event_prefix, self.debug_frame, name, extra))
		return
	end
	print(string.format('%s|f=%d|name=%s', telemetry.event_prefix, self.debug_frame, name))
end

function player:emit_metric(dt)
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	print(string.format(
		'%s|f=%d|t=%.3f|dt=%.3f|x=%.3f|y=%.3f|sx=%d|sy=%d|tgt=%d|prof=%d|grav=%d|g=%d|st=%s|ax=%d|run=%d|runp=%d|runr=%d|jp=%d|jh=%d|jr=%d|jbuf=%d|carry=%d|cidx=%d|roll=%d|rollt=%d|chain=%d|xh=%d|yh=%d|ah=%d|bh=%d|psx=%d|psy=%d|dxp=%d|dyp=%d|mx=%d|my=%d|hx=%d|hy=%d|f1699=%d|f16f9=%d|ani=%s|aidx=%d|img=%s',
		telemetry.metric_prefix,
		self.debug_frame,
		self.debug_time_ms,
		dt,
		self.x,
		self.y,
		self.x_speed_subpx,
		self.y_speed_subpx,
		self.target_x_speed_subpx,
		self.active_profile_id,
		self.active_gravity_subpx,
		bool01(self.grounded),
		self.pose_name,
		self.move_axis,
		bool01(self.run_held),
		bool01(self.run_pressed),
		bool01(self.run_released),
		bool01(self.jump_pressed),
		bool01(self.jump_held),
		bool01(self.jump_released),
		bool01(self.jump_buffer_active),
		bool01(self.carried_barrel_index ~= 0),
		self.carried_barrel_index,
		bool01(self.sc:matches_state_path(player_state_roll)),
		self.roll_timer_frames,
		self.roll_chain_window_frames,
		bool01(self.x_held),
		bool01(self.y_held),
		bool01(self.a_held),
		bool01(self.b_held),
		self.pos_subx,
		self.pos_suby,
		self.debug_step_pixels_x,
		self.debug_step_pixels_y,
		self.debug_moved_pixels_x,
		self.debug_moved_pixels_y,
		bool01(self.debug_collided_x),
		bool01(self.debug_collided_y),
		self.dkc_1699_flags,
		self.dkc_16f9_jump_gravity_subpx,
		self.visual_cycle_id,
		self.visual_cycle_index,
		self.visual_frame_id
	))
end

function player:reset_runtime()
	local sp = constants.dkc.subpixels_per_px
	self.x = self.spawn_x
	self.y = self.spawn_y
	self.pos_subx = math.floor(self.x * sp)
	self.pos_suby = math.floor(self.y * sp)
	self.x_speed_subpx = 0
	self.y_speed_subpx = 0
	self.target_x_speed_subpx = 0
	self.active_profile_id = 0
	self.active_gravity_subpx = 0

	self.facing = 1
	self.move_axis = 0
	self.last_move_axis = 0
	self.last_direction_change_frame = -0x7FFFFFFF
	self.last_run_press_frame = -0x7FFFFFFF
	self.dkc_16a5_last_b_press_frame = -0x7FFFFFFF
	self.run_held = false
	self.run_pressed = false
	self.run_released = false
	self.x_held = false
	self.y_held = false
	self.a_held = false
	self.b_held = false
	self.jump_held = false
	self.jump_pressed = false
	self.jump_released = false
	self.jump_buffer_active = false
	self.dkc_1699_flags = 0
	self.dkc_16f9_jump_gravity_subpx = constants.dkc.gravity_hold_subpx
	self.carried_barrel_index = 0

	self.grounded = true
	self.roll_dir = 1
	self.roll_timer_frames = 0
	self.roll_chain_window_frames = 0

	self.draw_scale_x = 1
	self.draw_scale_y = 1
	self.roll_visual = 0
	self.pose_name = 'grounded'
	self.visual_cycle_id = 'idle'
	self.visual_cycle_index = 1
	self.visual_cycle_elapsed_ms = 0
	self.visual_distance_accum_subpx = 0
	self.visual_frame_id = constants.animation.idle.frames[1]

	self.camera_anchor_x = self.x + (self.width * 0.5)
	self.camera_anchor_y = self.y + (self.height * 0.5)

	self.debug_frame = 0
	self.debug_time_ms = 0
	self.debug_last_pose = self.pose_name
	self.debug_last_grounded = self.grounded
	self.debug_roll_started = false
	self.debug_roll_chained = false
	self.debug_roll_speed_subpx = 0
	self.debug_jump_started = false
	self.debug_jump_from_roll = false
	self.debug_jump_launch_sy = 0
	self.debug_step_pixels_x = 0
	self.debug_step_pixels_y = 0
	self.debug_moved_pixels_x = 0
	self.debug_moved_pixels_y = 0
	self.debug_collided_x = false
	self.debug_collided_y = false
	self.debug_barrel_pickup = false
	self.debug_barrel_pickup_index = 0
	self.debug_barrel_throw = false
	self.debug_barrel_throw_index = 0
	self.debug_barrel_throw_mode = 'ground'
	self.debug_barrel_throw_base_sx = 0
	self.debug_barrel_throw_base_sy = 0
	self.debug_barrel_throw_player_sx = 0
	self.debug_barrel_throw_sx = 0
	self.debug_barrel_throw_sy = 0
end

function player:respawn()
	self:reset_runtime()
	self.sc:transition_to(player_state_grounded)
end

function player:get_overlapping_solid(x, y)
	local solids = self.level.solids
	for i = 1, #solids do
		local solid = solids[i]
		if overlaps(x, y, self.width, self.height, solid) then
			return solid
		end
	end
	return nil
end

function player:is_grounded_probe()
	return self:get_overlapping_solid(self.x, self.y + 1) ~= nil
end

function player:sample_input()
	local player_index = self.player_index
	local old_run = self.run_held
	local old_jump = self.jump_held

	-- CODE_BFB2C7 clears run-active bit before each sample.
	self.dkc_1699_flags = self.dkc_1699_flags & 0xFFFB

	local left = action_triggered('left[p]', player_index)
	local right = action_triggered('right[p]', player_index)
	self.move_axis = 0
	if left and (not right) then
		self.move_axis = -1
	elseif right and (not left) then
		self.move_axis = 1
	end
	if self.move_axis ~= 0 then
		self.facing = self.move_axis
	end

	self.x_held = action_triggered('x[p]', player_index)
	self.y_held = action_triggered('y[p]', player_index)
	self.a_held = action_triggered('a[p]', player_index)
	self.b_held = action_triggered('b[p]', player_index)

	self.run_held = self.y_held
	self.jump_held = self.b_held
	self.run_pressed = self.run_held and (not old_run)
	self.run_released = (not self.run_held) and old_run
	self.jump_pressed = self.jump_held and (not old_jump)
	self.jump_released = (not self.jump_held) and old_jump

	-- CODE_BFB8E5/CODE_BFB919 stores last B-press frame in $16A5.
	if self.jump_pressed then
		self.dkc_16a5_last_b_press_frame = self.debug_frame
	end

	-- CODE_BFB8F7 allows jump if (frame - $16A5) < #$000C while B is held.
	local buf = constants.dkc.jump_buffer_frames
	self.jump_buffer_active = self.jump_held and ((self.debug_frame - self.dkc_16a5_last_b_press_frame) < buf)

	if self.move_axis ~= self.last_move_axis and self.move_axis ~= 0 then
		self.last_direction_change_frame = self.debug_frame
	end
	self.last_move_axis = self.move_axis

	if self.run_pressed then
		self.last_run_press_frame = self.debug_frame
	end
	if not self.jump_held then
		self.dkc_1699_flags = self.dkc_1699_flags & 0xFFFC
	end
end

function player:update_roll_chain_timer()
	if self.roll_chain_window_frames > 0 and (not self.sc:matches_state_path(player_state_roll)) then
		self.roll_chain_window_frames = self.roll_chain_window_frames - 1
	end
end

function player:CODE_BFB4E3_GET_TARGET_SPEED()
	-- CODE_BFB4E3: Calculate target speed magnitude based on held buttons.
	-- Returns the magnitude (positive). Direction is applied by caller.
	local ref = constants.dkc
	local forced_run = (self.dkc_1699_flags & 0x0200) ~= 0
	-- Assembly checks Y/X button here to set/clear run flag
	if self.run_held or forced_run then
		self.dkc_1699_flags = self.dkc_1699_flags | 0x0004
		return ref.run_target_subpx 
	end
	return ref.walk_target_subpx
end

function player:CODE_BFB64B_AIR_LEFT()
	-- CODE_BFB64B: Airborne Left Handler
	-- 1. Updates Target Speed using BFB4E3 (negated)
	-- 2. Does NOT constrain current speed directly (momentum conservation)
	
	-- Check for jump-hold animation overrides (omitted for physics)
	
	local target = self:CODE_BFB4E3_GET_TARGET_SPEED()
	
	-- Negate target for left
	self.target_x_speed_subpx = -target
end

function player:CODE_BFB75A_AIR_RIGHT()
	-- CODE_BFB75A: Airborne Right Handler
	local target = self:CODE_BFB4E3_GET_TARGET_SPEED()
	self.target_x_speed_subpx = target
end

function player:CODE_BFBA39_AIR_NEUTRAL()
	-- CODE_BFBA39: Airborne Neutral Handler
	-- Assembly: RTS (Does Nothing).
	-- Result: Target Speed remains unchanged.
	-- This preserves "Target Momentum". If you were targeting run speed, you keep targeting run speed.
	-- Combined with Div 64 Profile, this results in a heavy, committed arc.
end

function player:CODE_BFC18A_GROUND_NEUTRAL()
	-- CODE_BFC18A: Grounded Neutral Handler
	-- Zeros the target speed to decelerate.
	self.target_x_speed_subpx = 0
end

function player:select_ground_profile()
	-- CODE_BFB159 Logic: Select profile based on run flag
	if (self.dkc_1699_flags & 0x0004) ~= 0 then
		return constants.profile.ground_run -- 8
	end
	return constants.profile.ground_walk -- 3
end

function player:apply_horizontal_control(airborne)
	-- CODE_BFB27C: Horizontal Logic (Input -> Target Speed)
	-- Identical for Ground (Context 0) and Air (Context 1) in basic movement.
	
	local prev_target = self.target_x_speed_subpx
	local new_target = 0
	
	-- 1. Determine Target Speed (0F25)
	if self.move_axis == -1 then
		-- Left: Negate Speed Value from CODE_BFB4E3
		new_target = -self:CODE_BFB4E3_GET_TARGET_SPEED()
	elseif self.move_axis == 1 then
		-- Right: Speed Value from CODE_BFB4E3
		new_target = self:CODE_BFB4E3_GET_TARGET_SPEED()
	else
		-- Neutral: CODE_BFC192 -> Target = 0
		-- This applies in AIR too, providing the "Drag to 0" control feel.
		new_target = 0
	end
	
	self.target_x_speed_subpx = new_target
	
	-- 2. Determine Profile (Smoothing Divisor)
	-- Default is Profile 0 (/8).
	-- Ground may start run/walk specific profiles (Div 21/64), but strictly adhering to default 0 
	-- ensures the snappy feedback unless specific states override.
	local profile_id = constants.profile.default -- 0
	
	if not airborne then
		-- Grounded override logic (CODE_BFB159 / CODE_BFB167)
		-- "state $04/$09 + grounded + running($0004) → 8"
		-- "state $04/$09 + grounded + walking → 3"
		-- "everything else → 0" (including Neutral/Stopping)
		
		if new_target ~= 0 then
			-- We are "Walking/Running" (Active Input)
			profile_id = self:select_ground_profile()
		else
			-- We are "Stopping/Neutral" -> Use Default Profile 0 (/8)
			-- This ensures the "Instant Stop" feel.
			profile_id = constants.profile.default
		end
		
		-- Instant Start Rule (CODE_BFB61D)
		-- If transitioning from Neutral to Moving, Snap immediately.
		if prev_target == 0 and new_target ~= 0 then
			self.x_speed_subpx = new_target
		end
	end
	
	self.active_profile_id = profile_id

	-- 3. Update XSpeed (CODE_BFB159 Approach)
	self.x_speed_subpx = approach_subpx(self.x_speed_subpx, self.target_x_speed_subpx, self.active_profile_id)
end

function player:CODE_BFAF38_AIR_GRAVITY()
	-- CODE_BFAF38
	local ref = constants.dkc
	local gravity = ref.gravity_release_subpx
	if (self.dkc_1699_flags & 0x0002) ~= 0 then
		gravity = self.dkc_16f9_jump_gravity_subpx
	end
	self.active_gravity_subpx = gravity
	self.y_speed_subpx = self.y_speed_subpx + gravity
	if self.y_speed_subpx < ref.max_fall_subpx then
		self.y_speed_subpx = ref.max_fall_subpx
	end
end

function player:move_horizontal_pixels(step_pixels)
	if step_pixels == 0 then
		return false
	end
	local direction = sign(step_pixels)
	local remaining = abs(step_pixels)
	local sp = constants.dkc.subpixels_per_px

	while remaining > 0 do
		local next_x = self.x + direction
		local solid = self:get_overlapping_solid(next_x, self.y)
		if solid ~= nil then
			if direction > 0 then
				self.x = solid.x - self.width
			else
				self.x = solid.x + solid.w
			end
			self.pos_subx = self.x * sp
			self.x_speed_subpx = 0
			self.target_x_speed_subpx = 0
			return true
		end
		self.x = next_x
		remaining = remaining - 1
	end
	return false
end

function player:move_vertical_pixels(step_pixels)
	if step_pixels == 0 then
		return false, false
	end
	local direction = sign(step_pixels)
	local remaining = abs(step_pixels)
	local sp = constants.dkc.subpixels_per_px
	while remaining > 0 do
		local next_y = self.y + direction
		local solid = self:get_overlapping_solid(self.x, next_y)
		if solid ~= nil then
			if direction > 0 then
				self.y = solid.y - self.height
				self.pos_suby = self.y * sp
				self.y_speed_subpx = 0
				
				-- Landing snap logic removed. 
				-- Movement logic (neutral target = 0) handles natural deceleration.
				
				return true, true
			end
			self.y = solid.y + solid.h
			self.pos_suby = self.y * sp
			self.y_speed_subpx = 0
			return true, false
		end
		self.y = next_y
		remaining = remaining - 1
	end
	return false, false
end

function player:integrate_and_collide()
	local sp = constants.dkc.subpixels_per_px
	local was_grounded = self.grounded
	local start_x = self.x
	local start_y = self.y

	local want_subx = self.pos_subx + self.x_speed_subpx
	local want_x = math.floor(want_subx / sp)
	self.debug_step_pixels_x = want_x - self.x
	self.debug_collided_x = self:move_horizontal_pixels(self.debug_step_pixels_x)
	if not self.debug_collided_x then
		self.pos_subx = want_subx
	end

	self.grounded = false
	local want_suby = self.pos_suby - self.y_speed_subpx
	local want_y = math.floor(want_suby / sp)
	self.debug_step_pixels_y = want_y - self.y
	self.debug_collided_y, self.grounded = self:move_vertical_pixels(self.debug_step_pixels_y)
	if not self.debug_collided_y then
		self.pos_suby = want_suby
	end

	if (not self.grounded) and self:is_grounded_probe() then
		self.grounded = true
		self.y_speed_subpx = 0
		self.pos_suby = self.y * sp
	end

	local max_x = self.level.world_width - self.width
	if self.x < 0 then
		self.x = 0
		self.x_speed_subpx = 0
		self.target_x_speed_subpx = 0
		self.pos_subx = 0
		self.debug_collided_x = true
	elseif self.x > max_x then
		self.x = max_x
		self.x_speed_subpx = 0
		self.target_x_speed_subpx = 0
		self.pos_subx = self.x * sp
		self.debug_collided_x = true
	end

	local max_y = self.level.world_height - self.height
	if self.y > max_y then
		self.y = max_y
		self.y_speed_subpx = 0
		self.pos_suby = self.y * sp
		self.grounded = true
		self.debug_collided_y = true
	end

	self.debug_moved_pixels_x = self.x - start_x
	self.debug_moved_pixels_y = self.y - start_y

	if self.grounded and (not was_grounded) then
		self:play_timeline(landing_timeline_id, { rewind = true, snap_to_start = true })
	end
end

function player:CODE_BFBA88_START_JUMP(from_roll)
	-- CODE_BFBA88 rope jump.
	self.y_speed_subpx = constants.dkc.jump_initial_subpx
	self.dkc_1699_flags = self.dkc_1699_flags | 0x0203
	self.dkc_16f9_jump_gravity_subpx = constants.dkc.gravity_hold_subpx
	self.grounded = false
	self.debug_jump_started = true
	self.debug_jump_from_roll = from_roll
	self.debug_jump_launch_sy = self.y_speed_subpx
	self:play_timeline(jump_timeline_id, { rewind = true, snap_to_start = true })
end

function player:CODE_BFB94F_START_JUMP(from_roll)
	-- CODE_BFB94F ground jump.
	self.y_speed_subpx = constants.dkc.jump_initial_subpx
	self.dkc_1699_flags = self.dkc_1699_flags | 0x0003
	self.dkc_16f9_jump_gravity_subpx = constants.dkc.gravity_hold_subpx
	self.grounded = false
	self.debug_jump_started = true
	self.debug_jump_from_roll = from_roll
	self.debug_jump_launch_sy = self.y_speed_subpx
	self:play_timeline(jump_timeline_id, { rewind = true, snap_to_start = true })
end

function player:CODE_BFBD4F_START_ROLL()
	-- CODE_BFBD4F + CODE_BFBDA9
	local ref = constants.dkc
	local speed = ref.roll_entry_min_subpx
	if self.move_axis ~= 0 then
		speed = ref.roll_entry_dpad_subpx
	end
	if (self.debug_frame - self.last_direction_change_frame) < ref.roll_dash_window_frames then
		speed = ref.roll_entry_cap_subpx
	end
	if self.roll_chain_window_frames > 0 then
		speed = speed + ref.roll_chain_step_subpx
		if speed > ref.roll_chain_cap_subpx then
			speed = ref.roll_chain_cap_subpx
		end
	end

	if self.move_axis ~= 0 then
		self.roll_dir = self.move_axis
	else
		self.roll_dir = self.facing
	end
	self.facing = self.roll_dir
	self.x_speed_subpx = self.roll_dir * speed
	self.target_x_speed_subpx = self.x_speed_subpx
	self.roll_timer_frames = constants.roll.timer_frames
	self.roll_chain_window_frames = constants.roll.chain_window_frames
	self.debug_roll_started = true
	self.debug_roll_speed_subpx = speed
	self:play_timeline(roll_wobble_timeline_id, { rewind = true, snap_to_start = true })
end

function player:CODE_BFBDE7_CHAIN_ROLL()
	-- CODE_BFBDE7
	local speed = abs(self.x_speed_subpx) + constants.dkc.roll_chain_step_subpx
	if speed > constants.dkc.roll_chain_cap_subpx then
		speed = constants.dkc.roll_chain_cap_subpx
	end
	self.x_speed_subpx = self.roll_dir * speed
	self.target_x_speed_subpx = self.x_speed_subpx
	self.roll_timer_frames = constants.roll.timer_frames
	self.roll_chain_window_frames = constants.roll.chain_window_frames
	self.debug_roll_chained = true
	self.debug_roll_speed_subpx = speed
end

function player:tick_grounded()
	self.active_gravity_subpx = 0
	self.y_speed_subpx = 0
	self.dkc_1699_flags = self.dkc_1699_flags & 0xFDFD

	self:update_barrel_interaction()

	if self.carried_barrel_index == 0 and self.run_pressed and self.move_axis ~= 0 then
		self:CODE_BFBD4F_START_ROLL()
		self.sc:transition_to(player_state_roll)
		return
	end

	if self.jump_buffer_active then
		self:CODE_BFB94F_START_JUMP(false)
		self.sc:transition_to(player_state_airborne)
		self:advance_airborne_kinematics()
		if self.grounded then
			self.sc:transition_to(player_state_grounded)
		end
		return
	end

	self:apply_horizontal_control(false)
	self:integrate_and_collide()
	if not self.grounded then
		self.sc:transition_to(player_state_airborne)
	end
end

function player:advance_airborne_kinematics()
	-- DKC1 order: gravity first, then horizontal, then integrate.
	self:CODE_BFAF38_AIR_GRAVITY()
	self:apply_horizontal_control(true)
	self:integrate_and_collide()
end

function player:tick_airborne()
	self:update_barrel_interaction()
	self:advance_airborne_kinematics()
	if self.grounded then
		self.sc:transition_to(player_state_grounded)
	end
end

function player:tick_roll()
	if self.jump_buffer_active then
		self:CODE_BFB94F_START_JUMP(true)
		self.sc:transition_to(player_state_airborne)
		self:advance_airborne_kinematics()
		if self.grounded then
			self.sc:transition_to(player_state_grounded)
		end
		return
	end

	if self.run_pressed and self.roll_chain_window_frames > 0 then
		self:CODE_BFBDE7_CHAIN_ROLL()
	end

	self.roll_timer_frames = self.roll_timer_frames - 1
	self.active_gravity_subpx = 0

	-- CODE_BFB159: rolling is not state $04/$09, so profile 0 (÷8) applies.
	-- Roll maintains target set by START_ROLL/CHAIN_ROLL; approach is near-noop.
	local roll_prof = constants.profile.default
	self.active_profile_id = roll_prof
	self.x_speed_subpx = approach_subpx(self.x_speed_subpx, self.target_x_speed_subpx, roll_prof)

	if not self.grounded then
		self:CODE_BFAF38_AIR_GRAVITY()
	else
		self.y_speed_subpx = 0
	end

	self:integrate_and_collide()

	-- DKC1: roll state persists even when airborne (off-edge).
	-- The player can still initiate a roll-jump while the roll timer is active.
	-- Only exit roll when the timer expires.
	if self.roll_timer_frames <= 0 then
		if self.grounded then
			self.sc:transition_to(player_state_grounded)
		else
			self.sc:transition_to(player_state_airborne)
		end
	end
end

function player:tick(dt)
	self.debug_frame = self.debug_frame + 1
	self.debug_time_ms = self.debug_time_ms + dt
	self.debug_roll_started = false
	self.debug_roll_chained = false
	self.debug_roll_speed_subpx = 0
	self.debug_jump_started = false
	self.debug_jump_from_roll = false
	self.debug_jump_launch_sy = 0
	self.debug_barrel_pickup = false
	self.debug_barrel_pickup_index = 0
	self.debug_barrel_throw = false
	self.debug_barrel_throw_index = 0
	self.debug_barrel_throw_mode = 'ground'
	self.debug_barrel_throw_base_sx = 0
	self.debug_barrel_throw_base_sy = 0
	self.debug_barrel_throw_player_sx = 0
	self.debug_barrel_throw_sx = 0
	self.debug_barrel_throw_sy = 0
	self.debug_step_pixels_x = 0
	self.debug_step_pixels_y = 0
	self.debug_moved_pixels_x = 0
	self.debug_moved_pixels_y = 0
	self.debug_collided_x = false
	self.debug_collided_y = false

	local old_grounded = self.grounded
	local old_pose = self.pose_name

	self:sample_input()
	self:update_roll_chain_timer()

	if self.sc:matches_state_path(player_state_roll) then
		self:tick_roll()
	elseif self.sc:matches_state_path(player_state_airborne) then
		self:tick_airborne()
	else
		self:tick_grounded()
	end

	self:sync_carried_barrel_position()
	self.camera_anchor_x = self.x + (self.width * 0.5) + (self.facing * constants.camera.forward_look_px)
	self.camera_anchor_y = self.y + (self.height * 0.5)
	self:update_visual_frame(dt)

	if self.debug_roll_started then
		self:emit_event('roll_start', string.format('subpx=%d|dir=%d', self.debug_roll_speed_subpx, self.roll_dir))
	end
	if self.debug_roll_chained then
		self:emit_event('roll_chain', string.format('subpx=%d|dir=%d', self.debug_roll_speed_subpx, self.roll_dir))
	end
	if self.debug_jump_started then
		self:emit_event('jump_start', string.format('from_roll=%d|sx=%d|sy=%d', bool01(self.debug_jump_from_roll), self.x_speed_subpx, self.debug_jump_launch_sy))
	end
	if self.debug_barrel_pickup then
		self:emit_event('barrel_pickup', string.format('idx=%d|x=%.3f|y=%.3f', self.debug_barrel_pickup_index, self.x, self.y))
	end
	if self.debug_barrel_throw then
		self:emit_event('barrel_throw', string.format(
			'idx=%d|mode=%s|face=%d|bsx=%d|bsy=%d|psx=%d|sx=%d|sy=%d|x=%.3f|y=%.3f',
			self.debug_barrel_throw_index,
			self.debug_barrel_throw_mode,
			self.facing,
			self.debug_barrel_throw_base_sx,
			self.debug_barrel_throw_base_sy,
			self.debug_barrel_throw_player_sx,
			self.debug_barrel_throw_sx,
			self.debug_barrel_throw_sy,
			self.x,
			self.y
		))
	end
	if self.grounded and (not old_grounded) then
		self:emit_event('land', string.format('x=%.3f|y=%.3f', self.x, self.y))
	elseif (not self.grounded) and old_grounded then
		self:emit_event('leave_ground', string.format('x=%.3f|y=%.3f', self.x, self.y))
	end
	if self.pose_name ~= old_pose then
		self:emit_event('pose', string.format('from=%s|to=%s', old_pose, self.pose_name))
		if old_pose == 'roll' then
			self:emit_event('roll_end', string.format('sx=%d', self.x_speed_subpx))
		end
	end
	self:emit_metric(dt)
end

local function define_player_fsm()
	define_fsm(player_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:define_motion_timelines()
					self:reset_runtime()
					return '/grounded'
				end,
			},
			grounded = {
				entering_state = function(self)
					self.pose_name = 'grounded'
					self.roll_visual = 0
				end,
			},
			airborne = {
				entering_state = function(self)
					self.pose_name = 'airborne'
				end,
			},
			roll = {
				entering_state = function(self)
					self.pose_name = 'roll'
				end,
				exiting_state = function(self)
					self:stop_timeline(roll_wobble_timeline_id)
					self.roll_visual = 0
				end,
			},
		},
	})
end

local function register_player_definition()
	define_world_object({
		def_id = constants.ids.player_def,
		class = player,
		fsms = { player_fsm_id },
		defaults = {
			player_index = 1,
			width = constants.player.width,
			height = constants.player.height,
			spawn_x = constants.player.start_x,
			spawn_y = constants.player.start_y,
			x = constants.player.start_x,
			y = constants.player.start_y,
			pos_subx = constants.player.start_x * constants.dkc.subpixels_per_px,
			pos_suby = constants.player.start_y * constants.dkc.subpixels_per_px,
			x_speed_subpx = 0,
			y_speed_subpx = 0,
			target_x_speed_subpx = 0,
			active_profile_id = 0,
			active_gravity_subpx = 0,
			facing = 1,
			move_axis = 0,
			last_move_axis = 0,
			last_direction_change_frame = -0x7FFFFFFF,
			last_run_press_frame = -0x7FFFFFFF,
			dkc_16a5_last_b_press_frame = -0x7FFFFFFF,
			run_held = false,
			run_pressed = false,
			run_released = false,
			x_held = false,
			y_held = false,
			a_held = false,
			b_held = false,
			jump_held = false,
			jump_pressed = false,
			jump_released = false,
			jump_buffer_active = false,
			dkc_1699_flags = 0,
			dkc_16f9_jump_gravity_subpx = constants.dkc.gravity_hold_subpx,
			carried_barrel_index = 0,
			grounded = true,
			roll_dir = 1,
			roll_timer_frames = 0,
			roll_chain_window_frames = 0,
			draw_scale_x = 1,
			draw_scale_y = 1,
			roll_visual = 0,
			pose_name = 'grounded',
			visual_cycle_id = 'idle',
			visual_cycle_index = 1,
			visual_cycle_elapsed_ms = 0,
			visual_distance_accum_subpx = 0,
			visual_frame_id = constants.animation.idle.frames[1],
			camera_anchor_x = 0,
			camera_anchor_y = 0,
			debug_frame = 0,
			debug_time_ms = 0,
			debug_last_pose = 'grounded',
			debug_last_grounded = true,
			debug_roll_started = false,
			debug_roll_chained = false,
			debug_roll_speed_subpx = 0,
			debug_jump_started = false,
			debug_jump_from_roll = false,
			debug_jump_launch_sy = 0,
			debug_step_pixels_x = 0,
			debug_step_pixels_y = 0,
			debug_moved_pixels_x = 0,
			debug_moved_pixels_y = 0,
			debug_collided_x = false,
			debug_collided_y = false,
			debug_barrel_pickup = false,
			debug_barrel_pickup_index = 0,
			debug_barrel_throw = false,
			debug_barrel_throw_index = 0,
			debug_barrel_throw_mode = 'ground',
			debug_barrel_throw_base_sx = 0,
			debug_barrel_throw_base_sy = 0,
			debug_barrel_throw_player_sx = 0,
			debug_barrel_throw_sx = 0,
			debug_barrel_throw_sy = 0,
		},
	})
end

return {
	player = player,
	define_player_fsm = define_player_fsm,
	register_player_definition = register_player_definition,
	player_def_id = constants.ids.player_def,
	player_instance_id = constants.ids.player_instance,
	player_fsm_id = constants.ids.player_fsm,
}
