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

local function bool01(value)
	if value then
		return 1
	end
	return 0
end

local function overlaps(ax, ay, aw, ah, box)
	return ax < (box.x + box.w) and (ax + aw) > box.x and ay < (box.y + box.h) and (ay + ah) > box.y
end

local function profile_step(abs_diff, profile_id)
	if profile_id == 0 then
		return math.floor(abs_diff / 8)
	end
	if profile_id == 1 then
		return math.floor(abs_diff / 16)
	end
	if profile_id == 2 then
		return math.floor(abs_diff / 32)
	end
	if profile_id == 3 then
		return math.floor(abs_diff / 64)
	end
	if profile_id == 4 then
		return math.floor(abs_diff / 128)
	end
	if profile_id == 5 then
		return math.floor(abs_diff / 256)
	end
	if profile_id == 6 then
		return math.floor(abs_diff / 4)
	end
	if profile_id == 7 then
		return math.floor(abs_diff / 2)
	end
	if profile_id == 8 then
		return math.floor(abs_diff / 32) + math.floor(abs_diff / 64)
	end
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

	if speed <= anim.movement_epsilon_subpx then
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
	local frame = self.debug_frame
	if extra ~= nil and extra ~= '' then
		print(string.format('%s|f=%d|name=%s|%s', telemetry.event_prefix, frame, name, extra))
		return
	end
	print(string.format('%s|f=%d|name=%s', telemetry.event_prefix, frame, name))
end

function player:emit_metric(dt)
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	print(string.format(
		'%s|f=%d|t=%.3f|dt=%.3f|x=%.3f|y=%.3f|sx=%d|sy=%d|tgt=%d|prof=%d|grav=%d|g=%d|st=%s|ax=%d|run=%d|runp=%d|jp=%d|jh=%d|jr=%d|rp=%d|xh=%d|yh=%d|ah=%d|bh=%d|rollt=%d|chain=%d|psx=%d|psy=%d|dxp=%d|dyp=%d|mx=%d|my=%d|hx=%d|hy=%d|ani=%s|aidx=%d|img=%s',
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
		bool01(self.jump_pressed),
		bool01(self.jump_held),
		bool01(self.jump_released),
		bool01(self.roll_pressed),
		bool01(self.x_held),
		bool01(self.y_held),
		bool01(self.a_held),
		bool01(self.b_held),
		self.roll_timer_frames,
		self.roll_chain_window_frames,
		self.pos_subx,
		self.pos_suby,
		self.debug_step_pixels_x,
		self.debug_step_pixels_y,
		self.debug_moved_pixels_x,
		self.debug_moved_pixels_y,
		bool01(self.debug_collided_x),
		bool01(self.debug_collided_y),
		self.visual_cycle_id,
		self.visual_cycle_index,
		self.visual_frame_id
	))
end

function player:reset_runtime()
	local sp = constants.dkc_reference.subpixels_per_pixel
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
	self.run_held = false
	self.run_pressed = false
	self.x_held = false
	self.y_held = false
	self.a_held = false
	self.b_held = false
	self.jump_held = false
	self.jump_pressed = false
	self.jump_released = false
	self.roll_pressed = false

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
	self.debug_jump_started = false
	self.debug_jump_from_roll = false
	self.debug_roll_speed_subpx = 0
	self.debug_step_pixels_x = 0
	self.debug_step_pixels_y = 0
	self.debug_moved_pixels_x = 0
	self.debug_moved_pixels_y = 0
	self.debug_collided_x = false
	self.debug_collided_y = false
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
	local previous_run_held = self.run_held
	local previous_jump_held = self.jump_held

	local left = action_triggered('left[p]', player_index)
	local right = action_triggered('right[p]', player_index)
	self.move_axis = 0
	if left then
		self.move_axis = self.move_axis - 1
	end
	if right then
		self.move_axis = self.move_axis + 1
	end
	if self.move_axis ~= 0 then
		self.facing = self.move_axis
	end

	self.x_held = action_triggered('x[p]', player_index)
	self.y_held = action_triggered('y[p]', player_index)
	self.a_held = action_triggered('a[p]', player_index)
	self.b_held = action_triggered('b[p]', player_index)

	-- DKC-style controls: Y is run/roll, B is jump.
	self.run_held = self.y_held
	self.jump_held = self.b_held

	self.run_pressed = self.run_held and (not previous_run_held)
	self.jump_pressed = self.jump_held and (not previous_jump_held)
	self.jump_released = (not self.jump_held) and previous_jump_held
	self.roll_pressed = self.run_pressed
end

function player:update_roll_chain_timer()
	if self.roll_chain_window_frames > 0 and (not self.sc:matches_state_path(player_state_roll)) then
		self.roll_chain_window_frames = self.roll_chain_window_frames - 1
	end
end

function player:apply_horizontal_control(airborne)
	local ref = constants.dkc_reference
	local p = constants.physics
	local target = 0
	if self.move_axis ~= 0 then
		if self.run_held and (not airborne) then
			target = self.move_axis * ref.run_target_subpx
		else
			target = self.move_axis * ref.walk_target_subpx
		end
	end

	local profile = p.profile_ground_release
	if airborne then
		profile = p.profile_air
	elseif self.move_axis == 0 then
		profile = p.profile_ground_release
	elseif self.move_axis * self.x_speed_subpx < 0 then
		profile = p.profile_ground_turn
	elseif self.run_held then
		profile = p.profile_ground_run
	else
		profile = p.profile_ground_walk
	end

	self.target_x_speed_subpx = target
	self.active_profile_id = profile
	self.x_speed_subpx = approach_subpx(self.x_speed_subpx, target, profile)
end

function player:apply_air_gravity()
	local ref = constants.dkc_reference
	local gravity_subpx = ref.jump_gravity_release_subpx
	if self.jump_held and self.y_speed_subpx > 0 then
		gravity_subpx = ref.jump_gravity_hold_subpx
	end
	self.active_gravity_subpx = gravity_subpx
	self.y_speed_subpx = self.y_speed_subpx + gravity_subpx
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
	local sp = constants.dkc_reference.subpixels_per_pixel

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
	local sp = constants.dkc_reference.subpixels_per_pixel

	while remaining > 0 do
		local next_y = self.y + direction
		local solid = self:get_overlapping_solid(self.x, next_y)
		if solid ~= nil then
			if direction > 0 then
				self.y = solid.y - self.height
				self.pos_suby = self.y * sp
				self.y_speed_subpx = 0
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
	local sp = constants.dkc_reference.subpixels_per_pixel
	local was_grounded = self.grounded
	local start_x = self.x
	local start_y = self.y

	local desired_subx = self.pos_subx + self.x_speed_subpx
	local desired_x = math.floor(desired_subx / sp)
	self.debug_step_pixels_x = desired_x - self.x
	self.debug_collided_x = self:move_horizontal_pixels(self.debug_step_pixels_x)
	if not self.debug_collided_x then
		self.pos_subx = desired_subx
	end

	self.grounded = false
	local desired_suby = self.pos_suby - self.y_speed_subpx
	local desired_y = math.floor(desired_suby / sp)
	self.debug_step_pixels_y = desired_y - self.y
	self.debug_collided_y, self.grounded = self:move_vertical_pixels(self.debug_step_pixels_y)
	if not self.debug_collided_y then
		self.pos_suby = desired_suby
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

	if self.grounded and not was_grounded then
		self:play_timeline(landing_timeline_id, { rewind = true, snap_to_start = true })
	end
end

function player:start_jump(from_roll)
	self.y_speed_subpx = constants.dkc_reference.jump_initial_subpx
	self.grounded = false
	self.debug_jump_started = true
	self.debug_jump_from_roll = from_roll
	self:play_timeline(jump_timeline_id, { rewind = true, snap_to_start = true })
end

function player:start_roll()
	local ref = constants.dkc_reference
	local speed = abs(self.x_speed_subpx)
	if speed < ref.roll_entry_min_subpx then
		speed = ref.roll_entry_min_subpx
	end
	speed = speed + ref.roll_entry_bonus_subpx
	if speed > ref.roll_entry_cap_subpx then
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
	self.roll_timer_frames = constants.physics.roll_timer_frames
	self.roll_chain_window_frames = constants.physics.roll_chain_window_frames

	self.debug_roll_started = true
	self.debug_roll_speed_subpx = speed
	self:play_timeline(roll_wobble_timeline_id, { rewind = true, snap_to_start = true })
end

function player:tick_grounded()
	self.active_gravity_subpx = 0
	self.y_speed_subpx = 0

	if self.roll_pressed and self.move_axis ~= 0 then
		self:start_roll()
		self.sc:transition_to(player_state_roll)
		return
	end

	if self.jump_pressed then
		self:start_jump(false)
		self.sc:transition_to(player_state_airborne)
		return
	end

	self:apply_horizontal_control(false)
	self:integrate_and_collide()

	if not self.grounded then
		self.sc:transition_to(player_state_airborne)
	end
end

function player:tick_airborne()
	self:apply_horizontal_control(true)
	self:apply_air_gravity()
	self:integrate_and_collide()
	if self.grounded then
		self.sc:transition_to(player_state_grounded)
	end
end

function player:tick_roll()
	if self.jump_pressed then
		self:start_jump(true)
		self.sc:transition_to(player_state_airborne)
		return
	end

	self.roll_timer_frames = self.roll_timer_frames - 1
	self.active_gravity_subpx = 0

	local p = constants.physics
	local roll_target = self.roll_dir * p.roll_floor_subpx
	self.target_x_speed_subpx = roll_target
	self.active_profile_id = p.profile_roll_release
	self.x_speed_subpx = approach_subpx(self.x_speed_subpx, roll_target, p.profile_roll_release)

	if not self.grounded then
		self:apply_air_gravity()
	else
		self.y_speed_subpx = 0
	end

	self:integrate_and_collide()

	if not self.grounded then
		self.sc:transition_to(player_state_airborne)
		return
	end

	if self.roll_timer_frames <= 0 then
		self.sc:transition_to(player_state_grounded)
	end
end

function player:tick(dt)
	self.debug_frame = self.debug_frame + 1
	self.debug_time_ms = self.debug_time_ms + dt
	self.debug_roll_started = false
	self.debug_jump_started = false
	self.debug_jump_from_roll = false

	local was_grounded = self.grounded
	local was_pose = self.pose_name

	self:sample_input()
	self:update_roll_chain_timer()

	if self.sc:matches_state_path(player_state_roll) then
		self:tick_roll()
	elseif self.sc:matches_state_path(player_state_airborne) then
		self:tick_airborne()
	else
		self:tick_grounded()
	end

	self.camera_anchor_x = self.x + (self.width * 0.5) + (self.facing * constants.camera.forward_look_px)
	self.camera_anchor_y = self.y + (self.height * 0.5)
	self:update_visual_frame(dt)

	if self.debug_roll_started then
		self:emit_event('roll_start', string.format('subpx=%d|dir=%d', self.debug_roll_speed_subpx, self.roll_dir))
	end
	if self.debug_jump_started then
		self:emit_event('jump_start', string.format('from_roll=%d|sx=%d|sy=%d', bool01(self.debug_jump_from_roll), self.x_speed_subpx, self.y_speed_subpx))
	end
	if self.grounded and not was_grounded then
		self:emit_event('land', string.format('x=%.3f|y=%.3f', self.x, self.y))
	elseif (not self.grounded) and was_grounded then
		self:emit_event('leave_ground', string.format('x=%.3f|y=%.3f', self.x, self.y))
	end
	if self.pose_name ~= was_pose then
		self:emit_event('pose', string.format('from=%s|to=%s', was_pose, self.pose_name))
		if was_pose == 'roll' then
			self:emit_event('roll_end', string.format('sx=%d', self.x_speed_subpx))
		end
	end

	self:emit_metric(dt)
	self.debug_last_pose = self.pose_name
	self.debug_last_grounded = self.grounded
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
			width = constants.player.width,
			height = constants.player.height,
			spawn_x = constants.player.start_x,
			spawn_y = constants.player.start_y,

			x = constants.player.start_x,
			y = constants.player.start_y,
			pos_subx = constants.player.start_x * constants.dkc_reference.subpixels_per_pixel,
			pos_suby = constants.player.start_y * constants.dkc_reference.subpixels_per_pixel,
			x_speed_subpx = 0,
			y_speed_subpx = 0,
			target_x_speed_subpx = 0,
			active_profile_id = 0,
			active_gravity_subpx = 0,

			facing = 1,
			move_axis = 0,
			run_held = false,
			run_pressed = false,
			x_held = false,
			y_held = false,
			a_held = false,
			b_held = false,
			jump_held = false,
			jump_pressed = false,
			jump_released = false,
			roll_pressed = false,
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
			debug_jump_started = false,
			debug_jump_from_roll = false,
			debug_roll_speed_subpx = 0,
			debug_step_pixels_x = 0,
			debug_step_pixels_y = 0,
			debug_moved_pixels_x = 0,
			debug_moved_pixels_y = 0,
			debug_collided_x = false,
			debug_collided_y = false,
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
