local constants = require('constants.lua')

local player = {}
player.__index = player

local player_fsm_id = constants.ids.player_fsm
local player_state_grounded = player_fsm_id .. ':/grounded'
local player_state_airborne = player_fsm_id .. ':/airborne'

local jump_timeline_id = 'dkc.player.jump_squash'
local landing_timeline_id = 'dkc.player.landing_squash'

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
			{ draw_scale_x = 1.0, draw_scale_y = 1.0 },
		},
		ticks_per_frame = 8,
		playback_mode = 'once',
		apply = true,
	}))
	self:define_timeline(new_timeline({
		id = landing_timeline_id,
		frames = {
			{ draw_scale_x = 1.0, draw_scale_y = 1.0 },
		},
		ticks_per_frame = 12,
		playback_mode = 'once',
		apply = true,
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

function player:update_visual_frame(dt)
	local anim = constants.animation

	if self.pose_name == 'airborne' then
		self:set_visual_cycle('air')
		if self.y_speed_subpx > 0 then
			self.visual_frame_id = anim.air.rise_frame
		else
			self.visual_frame_id = anim.air.fall_frame
		end
		return
	end

	local frames = anim.idle.frames
	self:set_visual_cycle('idle')
	self:advance_visual_by_time(dt, anim.idle.frame_ms, #frames)
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
		'%s|f=%d|t=%.3f|dt=%.3f|x=%.3f|y=%.3f|sx=%d|sy=%d|tgt=%d|prof=%d|grav=%d|g=%d|st=%s|ax=%d|run=%d|runp=%d|runr=%d|jp=%d|jh=%d|jr=%d|jbuf=%d|carry=%d|cidx=%d|xh=%d|yh=%d|ah=%d|bh=%d|psx=%d|psy=%d|dxp=%d|dyp=%d|mx=%d|my=%d|hx=%d|hy=%d|f1699=%d|f16f9=%d|ani=%s|aidx=%d|img=%s',
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
	self.jump_press_frame = -0x7FFFFFFF
	self.dkc_1699_flags = 0
	self.dkc_16f9_jump_gravity_subpx = constants.dkc.gravity_hold_subpx
	self.carried_barrel_index = 0

	self.grounded = true

	self.draw_scale_x = 1
	self.draw_scale_y = 1
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
	self.debug_step_pixels_x = 0
	self.debug_step_pixels_y = 0
	self.debug_moved_pixels_x = 0
	self.debug_moved_pixels_y = 0
	self.debug_collided_x = false
	self.debug_collided_y = false
	self.debug_jump_started = false
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

	local left = action_triggered('left[p]', player_index)
	local right = action_triggered('right[p]', player_index)
	if left and (not right) then
		self.facing = -1
		self.move_axis = -1
	elseif right and (not left) then
		self.facing = 1
		self.move_axis = 1
	else
		self.move_axis = 0
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
	if self.jump_pressed then
		self.jump_press_frame = self.debug_frame
	end
	self.jump_buffer_active = self.jump_held and (self.debug_frame - self.jump_press_frame) < constants.dkc.jump_buffer_frames
	if self.jump_held then
		self.dkc_1699_flags = self.dkc_1699_flags | 0x0001
	end
	if not self.jump_held then
		self.dkc_1699_flags = self.dkc_1699_flags & 0xFFFC
	end
end

function player:CODE_BFAF38_AIR_GRAVITY()
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

function player:move_vertical_pixels(step_pixels)
	if step_pixels == 0 then
		return false, false
	end
	local dir = sign(step_pixels)
	local remain = math.abs(step_pixels)
	local sp = constants.dkc.subpixels_per_px
	while remain > 0 do
		local next_y = self.y + dir
		local solid = self:get_overlapping_solid(self.x, next_y)
		if solid ~= nil then
			if dir > 0 then
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
		remain = remain - 1
	end
	return false, false
end

function player:integrate_and_collide()
	local sp = constants.dkc.subpixels_per_px
	local was_grounded = self.grounded
	local start_x = self.x
	local start_y = self.y

	self.debug_step_pixels_x = 0
	self.debug_collided_x = false
	self.x_speed_subpx = 0
	self.target_x_speed_subpx = 0
	self.pos_subx = self.x * sp

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
		self.pos_subx = 0
		self.x_speed_subpx = 0
		self.target_x_speed_subpx = 0
		self.debug_collided_x = true
	elseif self.x > max_x then
		self.x = max_x
		self.pos_subx = self.x * sp
		self.x_speed_subpx = 0
		self.target_x_speed_subpx = 0
		self.debug_collided_x = true
	end

	local max_y = self.level.world_height - self.height
	if self.y > max_y then
		self.y = max_y
		self.pos_suby = self.y * sp
		self.y_speed_subpx = 0
		self.grounded = true
		self.debug_collided_y = true
	end

	self.debug_moved_pixels_x = self.x - start_x
	self.debug_moved_pixels_y = self.y - start_y

	if self.grounded and (not was_grounded) then
		self:play_timeline(landing_timeline_id, { rewind = true, snap_to_start = true })
	end
end

function player:CODE_BFBA88_START_JUMP()
	self.y_speed_subpx = constants.dkc.jump_initial_subpx
	self.dkc_1699_flags = self.dkc_1699_flags | 0x0203
	self.dkc_16f9_jump_gravity_subpx = constants.dkc.gravity_hold_subpx
	self.grounded = false
	self.debug_jump_started = true
	self.debug_jump_launch_sy = self.y_speed_subpx
	self:play_timeline(jump_timeline_id, { rewind = true, snap_to_start = true })
end

function player:tick_grounded()
	self.active_gravity_subpx = 0
	self.y_speed_subpx = 0
	self.dkc_1699_flags = self.dkc_1699_flags & 0xFFFD
	self:update_barrel_interaction()
	if self.jump_buffer_active then
		self:CODE_BFBA88_START_JUMP()
		self:CODE_BFAF38_AIR_GRAVITY()
		self.target_x_speed_subpx = 0
		self.active_profile_id = 0
		self.x_speed_subpx = 0
		self:integrate_and_collide()
		self.sc:transition_to(player_state_airborne)
		return
	end
	self.target_x_speed_subpx = 0
	self.active_profile_id = 0
	self.x_speed_subpx = 0
	self:integrate_and_collide()
	if not self.grounded then
		self.sc:transition_to(player_state_airborne)
	end
end

function player:tick_airborne()
	self:update_barrel_interaction()
	self.target_x_speed_subpx = 0
	self.active_profile_id = 0
	self.x_speed_subpx = 0
	self:CODE_BFAF38_AIR_GRAVITY()
	self:integrate_and_collide()
	if self.grounded then
		self.sc:transition_to(player_state_grounded)
	end
end

function player:tick(dt)
	self.debug_frame = self.debug_frame + 1
	self.debug_time_ms = self.debug_time_ms + dt
	self.debug_jump_started = false
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
	if self.sc:matches_state_path(player_state_airborne) then
		self:tick_airborne()
	else
		self:tick_grounded()
	end

	self:sync_carried_barrel_position()
	self.camera_anchor_x = self.x + (self.width * 0.5) + (self.facing * constants.camera.forward_look_px)
	self.camera_anchor_y = self.y + (self.height * 0.5)
	self:update_visual_frame(dt)

	if self.debug_jump_started then
		self:emit_event('jump_start', string.format('sx=%d|sy=%d', self.x_speed_subpx, self.debug_jump_launch_sy))
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
				end,
			},
			airborne = {
				entering_state = function(self)
					self.pose_name = 'airborne'
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
				jump_press_frame = -0x7FFFFFFF,
				dkc_1699_flags = 0,
				dkc_16f9_jump_gravity_subpx = constants.dkc.gravity_hold_subpx,
				carried_barrel_index = 0,
			grounded = true,
			draw_scale_x = 1,
			draw_scale_y = 1,
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
				debug_step_pixels_x = 0,
				debug_step_pixels_y = 0,
				debug_moved_pixels_x = 0,
				debug_moved_pixels_y = 0,
				debug_collided_x = false,
				debug_collided_y = false,
				debug_jump_started = false,
				debug_jump_launch_sy = 0,
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
