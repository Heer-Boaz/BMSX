local constants = require('constants.lua')

local player = {}
player.__index = player

local player_fsm_id = constants.ids.player_fsm
local player_state_grounded = player_fsm_id .. ':/grounded'
local player_state_airborne = player_fsm_id .. ':/airborne'
local player_state_roll = player_fsm_id .. ':/roll'

local jump_timeline_id = 'dk.player.jump_squash'
local landing_timeline_id = 'dk.player.landing_squash'
local roll_wobble_timeline_id = 'dk.player.roll_wobble'

local function approach(value, target, delta)
	if value < target then
		value = value + delta
		if value > target then
			return target
		end
		return value
	end
	value = value - delta
	if value < target then
		return target
	end
	return value
end

local function overlaps(ax, ay, aw, ah, box)
	return ax < (box.x + box.w) and (ax + aw) > box.x and ay < (box.y + box.h) and (ay + ah) > box.y
end

local function abs(value)
	if value < 0 then
		return -value
	end
	return value
end

local function bool01(value)
	if value then
		return 1
	end
	return 0
end

function player:define_motion_timelines()
	self:define_timeline(new_timeline({
		id = jump_timeline_id,
		frames = {
			{ visual_scale_x = 0.9, visual_scale_y = 1.12 },
			{ visual_scale_x = 1.0, visual_scale_y = 1.0 },
		},
		ticks_per_frame = 10,
		playback_mode = 'once',
		apply = true,
	}))
	self:define_timeline(new_timeline({
		id = landing_timeline_id,
		frames = {
			{ visual_scale_x = 1.16, visual_scale_y = 0.78 },
			{ visual_scale_x = 0.92, visual_scale_y = 1.1 },
			{ visual_scale_x = 1.03, visual_scale_y = 0.97 },
			{ visual_scale_x = 1.0, visual_scale_y = 1.0 },
		},
		ticks_per_frame = 14,
		playback_mode = 'once',
		apply = true,
	}))
	self:define_timeline(new_timeline({
		id = roll_wobble_timeline_id,
		playback_mode = 'loop',
		tracks = {
			{
				kind = 'wave',
				path = { 'roll_wobble' },
				base = 0,
				amp = 0.14,
				period = 0.11,
				phase = 0,
				wave = 'sin',
			},
		},
	}))
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
	local subpixels_per_pixel = constants.dkc_reference.subpixels_per_pixel
	local spx = self.vx * dt * subpixels_per_pixel
	local spy = self.vy * dt * subpixels_per_pixel
	print(string.format(
		'%s|f=%d|t=%.3f|dt=%.3f|x=%.3f|y=%.3f|vx=%.6f|vy=%.6f|spx=%.2f|spy=%.2f|g=%d|st=%s|ax=%d|run=%d|runp=%d|jp=%d|jr=%d|rp=%d|ah=%d|bh=%d|ajp=%d|bjp=%d|ajr=%d|bjr=%d|coyote=%.3f|jbuf=%.3f|rollt=%.3f',
		telemetry.metric_prefix,
		self.debug_frame,
		self.debug_time_ms,
		dt,
		self.x,
		self.y,
		self.vx,
		self.vy,
		spx,
		spy,
		bool01(self.grounded),
		self.pose_name,
		self.move_axis,
			bool01(self.run_held),
			bool01(self.run_pressed),
			bool01(self.jump_pressed),
			bool01(self.jump_released),
			bool01(self.roll_pressed),
			bool01(self.a_held),
			bool01(self.b_held),
			bool01(self.a_pressed),
			bool01(self.b_pressed),
			bool01(self.a_released),
			bool01(self.b_released),
			self.coyote_timer_ms,
			self.jump_buffer_timer_ms,
			self.roll_timer_ms
		))
end

function player:reset_runtime()
	self.x = self.spawn_x
	self.y = self.spawn_y
	self.vx = 0
	self.vy = 0
	self.facing = 1
	self.move_axis = 0
	self.run_held = false
	self.run_pressed = false
	self.jump_pressed = false
	self.jump_released = false
	self.roll_pressed = false
	self.a_held = false
	self.b_held = false
	self.a_pressed = false
	self.b_pressed = false
	self.a_released = false
	self.b_released = false
	self.down_held = false
	self.grounded = false
	self.coyote_timer_ms = 0
	self.jump_buffer_timer_ms = 0
	self.roll_timer_ms = 0
	self.roll_dir = 1
	self.roll_exit_cooldown_ms = 0
	self.visual_scale_x = 1
	self.visual_scale_y = 1
	self.roll_wobble = 0
	self.pose_name = 'grounded'
	self.camera_anchor_x = self.x + (self.width * 0.5)
	self.camera_anchor_y = self.y + (self.height * 0.5)
	self.debug_frame = 0
	self.debug_time_ms = 0
	self.debug_was_grounded = false
	self.debug_last_pose_name = self.pose_name
	self.debug_roll_started = false
	self.debug_jump_started = false
	self.debug_jump_from_roll = false
	self.debug_last_roll_speed_subpx = 0
end

function player:respawn()
	self:reset_runtime()
	self.sc:transition_to(player_state_grounded)
end

function player:sample_input()
	local player_index = self.player_index
	local was_a_held = self.a_held
	local was_b_held = self.b_held
	local was_run_held = self.run_held
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
	self.a_held = action_triggered('a[p]', player_index)
	self.b_held = action_triggered('b[p]', player_index)
	self.run_held = action_triggered('x[p]', player_index) or action_triggered('y[p]', player_index)
	self.a_pressed = self.a_held and (not was_a_held)
	self.b_pressed = self.b_held and (not was_b_held)
	self.a_released = (not self.a_held) and was_a_held
	self.b_released = (not self.b_held) and was_b_held
	self.run_pressed = self.run_held and (not was_run_held)
	self.jump_pressed = self.a_pressed or self.b_pressed
	self.jump_released = self.a_released or self.b_released
	self.roll_pressed = self.run_pressed
	self.down_held = action_triggered('down[p]', player_index)
end

function player:update_timers(dt)
	local p = constants.player
	if self.jump_buffer_timer_ms > 0 then
		self.jump_buffer_timer_ms = self.jump_buffer_timer_ms - dt
		if self.jump_buffer_timer_ms < 0 then
			self.jump_buffer_timer_ms = 0
		end
	end
	if self.jump_pressed then
		self.jump_buffer_timer_ms = p.jump_buffer_ms
	end
	if self.grounded then
		self.coyote_timer_ms = p.coyote_ms
	elseif self.coyote_timer_ms > 0 then
		self.coyote_timer_ms = self.coyote_timer_ms - dt
		if self.coyote_timer_ms < 0 then
			self.coyote_timer_ms = 0
		end
	end
	if self.roll_exit_cooldown_ms > 0 then
		self.roll_exit_cooldown_ms = self.roll_exit_cooldown_ms - dt
		if self.roll_exit_cooldown_ms < 0 then
			self.roll_exit_cooldown_ms = 0
		end
	end
end

function player:can_start_jump()
	return self.jump_buffer_timer_ms > 0 and self.coyote_timer_ms > 0
end

function player:can_start_roll()
	local p = constants.player
	return self.roll_pressed
		and self.grounded
		and self.move_axis ~= 0
		and self.roll_exit_cooldown_ms <= 0
		and (abs(self.vx) >= p.roll_min_entry_speed or self.run_held)
end

function player:start_jump(from_roll)
	local p = constants.player
	if from_roll and abs(self.vx) < p.roll_jump_speed then
		self.vx = self.roll_dir * p.roll_jump_speed
	end
	self.vy = p.jump_velocity
	self.grounded = false
	self.jump_buffer_timer_ms = 0
	self.coyote_timer_ms = 0
	self.debug_jump_started = true
	self.debug_jump_from_roll = from_roll
	self:play_timeline(jump_timeline_id, { rewind = true, snap_to_start = true })
end

function player:start_roll()
	local p = constants.player
	local speed = p.roll_standing_speed
	if abs(self.vx) >= p.roll_run_entry_speed_threshold then
		speed = p.roll_running_speed
	end
	self.roll_dir = self.move_axis
	self.roll_timer_ms = p.roll_duration_ms
	self.vx = self.roll_dir * speed
	self.vy = 0
	self.debug_roll_started = true
	self.debug_last_roll_speed_subpx = self.vx * constants.dkc_reference.frame_ms * constants.dkc_reference.subpixels_per_pixel
	self:play_timeline(roll_wobble_timeline_id, { rewind = true, snap_to_start = true })
end

function player:apply_ground_horizontal(dt)
	local p = constants.player
	if self.move_axis == 0 then
		self.vx = approach(self.vx, 0, p.ground_decel * dt)
		return
	end

	if self.vx ~= 0 and (self.vx * self.move_axis) < 0 then
		self.vx = approach(self.vx, 0, p.turnaround_decel * dt)
		return
	end

	local top_speed = self.run_held and p.run_speed or p.walk_speed
	local target_speed = self.move_axis * top_speed
	local accel = p.ground_accel * dt
	if (not self.run_held) and abs(self.vx) > p.walk_speed and (self.vx * self.move_axis) > 0 then
		accel = p.run_release_ground_decel * dt
	end
	self.vx = approach(self.vx, target_speed, accel)
end

function player:apply_air_horizontal(dt)
	local p = constants.player
	if self.move_axis == 0 then
		self.vx = approach(self.vx, 0, p.air_drag * dt)
		return
	end

	if self.vx ~= 0 and (self.vx * self.move_axis) < 0 then
		self.vx = approach(self.vx, 0, p.air_turnaround_decel * dt)
	end

	local top_speed = self.run_held and p.run_speed or p.walk_speed
	local target_speed = self.move_axis * top_speed
	local accel = p.air_accel * dt
	if (not self.run_held) and abs(self.vx) > p.walk_speed and (self.vx * self.move_axis) > 0 then
		accel = p.run_release_air_decel * dt
	end
	self.vx = approach(self.vx, target_speed, accel)
end

function player:apply_gravity(dt)
	local p = constants.player
	self.vy = self.vy + (p.gravity * dt)
	if self.vy > p.max_fall_speed then
		self.vy = p.max_fall_speed
	end
end

function player:move_and_collide(dt)
	local solids = self.level.solids
	local dx = self.vx * dt
	if dx ~= 0 then
		self.x = self.x + dx
		for i = 1, #solids do
			local solid = solids[i]
			if overlaps(self.x, self.y, self.width, self.height, solid) then
				if dx > 0 then
					self.x = solid.x - self.width
				else
					self.x = solid.x + solid.w
				end
				self.vx = 0
			end
		end
	end

	local dy = self.vy * dt
	local was_grounded = self.grounded
	self.grounded = false
	if dy ~= 0 then
		self.y = self.y + dy
		for i = 1, #solids do
			local solid = solids[i]
			if overlaps(self.x, self.y, self.width, self.height, solid) then
				if dy > 0 then
					self.y = solid.y - self.height
					self.vy = 0
					self.grounded = true
				else
					self.y = solid.y + solid.h
					self.vy = 0
				end
			end
		end
	end

	if dy == 0 then
		for i = 1, #solids do
			local solid = solids[i]
			if overlaps(self.x, self.y + 1, self.width, self.height, solid) then
				self.grounded = true
				break
			end
		end
	end

	local max_x = self.level.world_width - self.width
	if self.x < 0 then
		self.x = 0
		self.vx = 0
	end
	if self.x > max_x then
		self.x = max_x
		self.vx = 0
	end

	local floor_y = self.level.world_height - self.height
	if self.y > floor_y then
		self.y = floor_y
		self.vy = 0
		self.grounded = true
	end

	if self.grounded and not was_grounded then
		self:play_timeline(landing_timeline_id, { rewind = true, snap_to_start = true })
	end
end

function player:tick_grounded(dt)
	self.vy = 0
	self:apply_ground_horizontal(dt)
	if self:can_start_roll() then
		self:start_roll()
		self.sc:transition_to(player_state_roll)
		return
	end
	if self:can_start_jump() then
		self:start_jump(false)
		self.sc:transition_to(player_state_airborne)
		return
	end
	self:move_and_collide(dt)
	if not self.grounded then
		self.sc:transition_to(player_state_airborne)
	end
end

function player:tick_airborne(dt)
	local p = constants.player
	self:apply_air_horizontal(dt)
	if self.jump_released and self.vy < p.jump_cut_velocity then
		self.vy = self.vy * p.jump_cut_multiplier
	end
	self:apply_gravity(dt)
	self:move_and_collide(dt)
	if self.grounded then
		self.sc:transition_to(player_state_grounded)
	end
end

function player:tick_roll(dt)
	local p = constants.player
	if self:can_start_jump() then
		self:start_jump(true)
		self.sc:transition_to(player_state_airborne)
		return
	end
	self.roll_timer_ms = self.roll_timer_ms - dt
	local speed = abs(self.vx) - (p.roll_decel * dt)
	if speed < p.roll_min_maintained_speed then
		speed = p.roll_min_maintained_speed
	end
	self.vx = self.roll_dir * speed
	if not self.grounded then
		self:apply_gravity(dt)
	else
		self.vy = 0
	end
	self:move_and_collide(dt)
	if not self.grounded then
		self.sc:transition_to(player_state_airborne)
		return
	end
	if self.roll_timer_ms <= 0 or self.vx == 0 then
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
	local was_pose_name = self.pose_name

	self:sample_input()
	self:update_timers(dt)
	if self.sc:matches_state_path(player_state_roll) then
		self:tick_roll(dt)
	elseif self.sc:matches_state_path(player_state_airborne) then
		self:tick_airborne(dt)
	else
		self:tick_grounded(dt)
	end
	self.camera_anchor_x = self.x + (self.width * 0.5) + (self.facing * constants.camera.forward_look * 0.3)
	self.camera_anchor_y = self.y + (self.height * 0.5)

	if self.debug_roll_started then
		self:emit_event('roll_start', string.format('subpx=%.2f|dir=%d', self.debug_last_roll_speed_subpx, self.roll_dir))
	end
	if self.debug_jump_started then
		local jump_speed_subpx = self.vx * constants.dkc_reference.frame_ms * constants.dkc_reference.subpixels_per_pixel
		self:emit_event('jump_start', string.format('from_roll=%d|subpx=%.2f', bool01(self.debug_jump_from_roll), jump_speed_subpx))
	end
	if self.grounded and not was_grounded then
		self:emit_event('land', string.format('x=%.3f|y=%.3f', self.x, self.y))
	elseif (not self.grounded) and was_grounded then
		self:emit_event('leave_ground', string.format('x=%.3f|y=%.3f', self.x, self.y))
	end
	if self.pose_name ~= was_pose_name then
		self:emit_event('pose', string.format('from=%s|to=%s', was_pose_name, self.pose_name))
		if was_pose_name == 'roll' then
			local roll_exit_subpx = self.vx * constants.dkc_reference.frame_ms * constants.dkc_reference.subpixels_per_pixel
			self:emit_event('roll_end', string.format('subpx=%.2f', roll_exit_subpx))
		end
	end
	self:emit_metric(dt)
	self.debug_was_grounded = self.grounded
	self.debug_last_pose_name = self.pose_name
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
					self.roll_wobble = 0
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
					self.roll_wobble = 0
					self.roll_exit_cooldown_ms = constants.player.roll_exit_cooldown_ms
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
			vx = 0,
			vy = 0,
			facing = 1,
			move_axis = 0,
			run_held = false,
			run_pressed = false,
			jump_pressed = false,
			jump_released = false,
			roll_pressed = false,
			a_held = false,
			b_held = false,
			a_pressed = false,
			b_pressed = false,
			a_released = false,
			b_released = false,
			down_held = false,
			grounded = false,
			coyote_timer_ms = 0,
			jump_buffer_timer_ms = 0,
			roll_timer_ms = 0,
			roll_dir = 1,
			roll_exit_cooldown_ms = 0,
			visual_scale_x = 1,
			visual_scale_y = 1,
			roll_wobble = 0,
			pose_name = 'grounded',
			camera_anchor_x = 0,
			camera_anchor_y = 0,
			debug_frame = 0,
			debug_time_ms = 0,
			debug_was_grounded = false,
			debug_last_pose_name = 'grounded',
			debug_roll_started = false,
			debug_jump_started = false,
			debug_jump_from_roll = false,
			debug_last_roll_speed_subpx = 0,
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
