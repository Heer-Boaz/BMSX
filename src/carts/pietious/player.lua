local constants = require('constants.lua')

local player = {}
player.__index = player

local player_fsm_id = constants.ids.player_fsm
local state_quiet = player_fsm_id .. ':/quiet'
local state_walking_right = player_fsm_id .. ':/walking_right'
local state_walking_left = player_fsm_id .. ':/walking_left'
local state_jumping = player_fsm_id .. ':/jumping'
local state_stopped_jumping = player_fsm_id .. ':/stopped_jumping'
local state_controlled_fall = player_fsm_id .. ':/controlled_fall'
local state_uncontrolled_fall = player_fsm_id .. ':/uncontrolled_fall'

local state_labels = {
	[state_quiet] = 'quiet',
	[state_walking_right] = 'walking_right',
	[state_walking_left] = 'walking_left',
	[state_jumping] = 'jumping',
	[state_stopped_jumping] = 'stopped_jumping',
	[state_controlled_fall] = 'controlled_fall',
	[state_uncontrolled_fall] = 'uncontrolled_fall',
}

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

function player:emit_event(name, extra)
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	if extra ~= nil and extra ~= '' then
		print(string.format('%s|f=%d|name=%s|%s', telemetry.event_prefix, self.frame, name, extra))
		return
	end
	print(string.format('%s|f=%d|name=%s', telemetry.event_prefix, self.frame, name))
end

function player:emit_metric()
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	print(string.format(
		'%s|f=%d|x=%d|y=%d|dx=%d|dy=%d|st=%s|jsub=%d|fsub=%d|inertia=%d|g=%d|left=%d|right=%d|up_hold=%d|up_press=%d|up_release=%d',
		telemetry.metric_prefix,
		self.frame,
		self.x,
		self.y,
		self.last_dx,
		self.last_dy,
		self.state_name,
		self.debug_jump_substate,
		self.debug_fall_substate,
		self.jump_inertia,
		bool01(self.grounded),
		bool01(self.left_held),
		bool01(self.right_held),
		bool01(self.up_held),
		bool01(self.up_pressed),
		bool01(self.up_released)
	))
end

function player:reset_runtime()
	self.x = self.spawn_x
	self.y = self.spawn_y
	self.facing = 1
	self.state_name = 'boot'
	self.jump_substate = 0
	self.fall_substate = 0
	self.jump_inertia = 0
	self.grounded = true
	self.left_held = false
	self.right_held = false
	self.up_held = false
	self.up_pressed = false
	self.up_released = false
	self.last_dx = 0
	self.last_dy = 0
	self.walk_frame = 0
	self.walk_distance_accum = 0
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
	self.frame = 0
end

function player:respawn()
	self:reset_runtime()
	self.sc:transition_to(state_quiet)
end

function player:sample_input()
	local player_index = self.player_index
	local was_up_held = self.up_held
	self.left_held = action_triggered('left[p]', player_index)
	self.right_held = action_triggered('right[p]', player_index)
	self.up_held = action_triggered('up[p]', player_index)
	self.up_pressed = self.up_held and (not was_up_held)
	self.up_released = (not self.up_held) and was_up_held
end

function player:collides_at(x, y)
	local solids = self.room.solids
	for i = 1, #solids do
		local solid = solids[i]
		if x < (solid.x + solid.w) and (x + self.width) > solid.x and y < (solid.y + solid.h) and (y + self.height) > solid.y then
			return true
		end
	end
	return false
end

function player:is_grounded()
	if self.y >= (self.room.world_height - self.height) then
		return true
	end
	return self:collides_at(self.x, self.y + 1)
end

function player:apply_move(dx, dy)
	local moved_x = 0
	local moved_y = 0
	local collided_x = false
	local collided_y = false
	local landed = false
	local hit_ceiling = false

	if dx ~= 0 then
		local step_x = sign(dx)
		for _ = 1, abs(dx) do
			local next_x = self.x + step_x
			if self:collides_at(next_x, self.y) then
				collided_x = true
				break
			end
			self.x = next_x
			moved_x = moved_x + step_x
		end
	end

	if dy ~= 0 then
		local step_y = sign(dy)
		for _ = 1, abs(dy) do
			local next_y = self.y + step_y
			if self:collides_at(self.x, next_y) then
				collided_y = true
				if step_y > 0 then
					landed = true
				else
					hit_ceiling = true
				end
				break
			end
			self.y = next_y
			moved_y = moved_y + step_y
		end
	end

	local max_x = self.room.world_width - self.width
	if self.x < 0 then
		moved_x = moved_x - self.x
		self.x = 0
		collided_x = true
	end
	if self.x > max_x then
		moved_x = moved_x - (self.x - max_x)
		self.x = max_x
		collided_x = true
	end

	local max_y = self.room.world_height - self.height
	if self.y < 0 then
		moved_y = moved_y - self.y
		self.y = 0
		hit_ceiling = true
		collided_y = true
	end
	if self.y > max_y then
		moved_y = moved_y - (self.y - max_y)
		self.y = max_y
		landed = true
		collided_y = true
	end

	self.last_dx = moved_x
	self.last_dy = moved_y

	return {
		collided_x = collided_x,
		collided_y = collided_y,
		landed = landed,
		hit_ceiling = hit_ceiling,
	}
end

function player:transition_to(path, reason)
	local from_state = self.state_name
	local to_state = state_labels[path]
	if from_state ~= to_state then
		self:emit_event('state', string.format('from=%s|to=%s|reason=%s', from_state, to_state, reason))
	end
	self.sc:transition_to(path)
end

function player:start_jump(inertia)
	self.jump_substate = 0
	self.fall_substate = 0
	self.jump_inertia = inertia
	self:emit_event('jump_start', string.format('inertia=%d|x=%d|y=%d', inertia, self.x, self.y))
end

function player:get_controlled_fall_dy()
	local substate = self.fall_substate
	if substate < 3 then
		return 0
	end
	if substate >= 11 then
		return 6
	end
	return constants.physics.controlled_fall_dy_by_substate[substate]
end

function player:get_uncontrolled_fall_dy()
	local substate = self.fall_substate
	if substate >= 8 then
		return 6
	end
	return constants.physics.uncontrolled_fall_dy_by_substate[substate]
end

function player:get_controlled_fall_dx()
	local p = constants.physics
	local inertia = self.jump_inertia
	if self.right_held and not self.left_held then
		self.facing = 1
		if inertia == 1 then
			return p.fall_dx_with_inertia
		end
		if inertia == 0 then
			return p.fall_dx_neutral
		end
		return -p.fall_dx_against_inertia
	end
	if self.left_held and not self.right_held then
		self.facing = -1
		if inertia == -1 then
			return -p.fall_dx_with_inertia
		end
		if inertia == 0 then
			return -p.fall_dx_neutral
		end
		return p.fall_dx_against_inertia
	end
	return inertia * p.fall_dx_neutral
end

function player:reset_walk_animation()
	self.walk_frame = 0
	self.walk_distance_accum = 0
end

function player:advance_walk_animation(distance_px)
	self.walk_distance_accum = self.walk_distance_accum + distance_px
	local cycle_px = constants.player.walk_anim_cycle_px
	while self.walk_distance_accum >= cycle_px do
		self.walk_distance_accum = self.walk_distance_accum - cycle_px
		if self.walk_frame == 0 then
			self.walk_frame = 1
		else
			self.walk_frame = 0
		end
	end
end

function player:tick_quiet()
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
	self.last_dx = 0
	self.last_dy = 0

	if not self:is_grounded() then
		self.fall_substate = 0
		self:emit_event('ledge_drop', 'mode=quiet')
		self:transition_to(state_uncontrolled_fall, 'no_ground')
		return
	end

	if self.up_pressed then
		local inertia = 0
		if self.left_held and not self.right_held then
			inertia = -1
		end
		if self.right_held and not self.left_held then
			inertia = 1
		end
		self:start_jump(inertia)
		self:transition_to(state_jumping, 'jump_input')
		return
	end

	if self.left_held and not self.right_held then
		self.facing = -1
		self:transition_to(state_walking_left, 'left_down')
		return
	end
	if self.right_held and not self.left_held then
		self.facing = 1
		self:transition_to(state_walking_right, 'right_down')
	end
end

function player:tick_walking_right()
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
	self.facing = 1

	if not self:is_grounded() then
		self.last_dx = 0
		self.last_dy = 0
		self.fall_substate = 0
		self:emit_event('ledge_drop', 'mode=walk_right')
		self:transition_to(state_uncontrolled_fall, 'no_ground')
		return
	end

	local move_result = self:apply_move(constants.physics.walk_dx, 0)
	if self.last_dx ~= 0 then
		self:advance_walk_animation(abs(self.last_dx))
	end

	if self.up_pressed then
		self:start_jump(1)
		self:transition_to(state_jumping, 'jump_input')
		return
	end

	if self.left_held and not self.right_held then
		self:transition_to(state_walking_left, 'left_override')
		return
	end

	if not self.right_held then
		if self.left_held then
			self:transition_to(state_walking_left, 'right_released')
			return
		end
		self:transition_to(state_quiet, 'right_released')
		return
	end

	if move_result.collided_x then
		self:transition_to(state_quiet, 'wall_block')
	end
end

function player:tick_walking_left()
	self.debug_jump_substate = -1
	self.debug_fall_substate = -1
	self.facing = -1

	if not self:is_grounded() then
		self.last_dx = 0
		self.last_dy = 0
		self.fall_substate = 0
		self:emit_event('ledge_drop', 'mode=walk_left')
		self:transition_to(state_uncontrolled_fall, 'no_ground')
		return
	end

	local move_result = self:apply_move(-constants.physics.walk_dx, 0)
	if self.last_dx ~= 0 then
		self:advance_walk_animation(abs(self.last_dx))
	end

	if self.up_pressed then
		self:start_jump(-1)
		self:transition_to(state_jumping, 'jump_input')
		return
	end

	if self.right_held and not self.left_held then
		self:transition_to(state_walking_right, 'right_override')
		return
	end

	if not self.left_held then
		if self.right_held then
			self:transition_to(state_walking_right, 'left_released')
			return
		end
		self:transition_to(state_quiet, 'left_released')
		return
	end

	if move_result.collided_x then
		self:transition_to(state_quiet, 'wall_block')
	end
end

function player:tick_jumping()
	self.debug_jump_substate = self.jump_substate
	self.debug_fall_substate = -1

	local p = constants.physics
	if not self.up_held and self.jump_substate < p.jump_release_cut_substate then
		self.jump_substate = p.jump_release_cut_substate
		self.debug_jump_substate = self.jump_substate
	end

	local dy = p.popolon_jump_dy_by_substate[self.jump_substate]
	if dy == nil then
		dy = 0
	end
	local dx = self.jump_inertia * p.jump_dx
	local move_result = self:apply_move(dx, dy)

	if move_result.collided_x then
		self.jump_inertia = 0
	end
	if move_result.hit_ceiling and self.jump_substate < p.jump_release_cut_substate then
		self.jump_substate = p.jump_release_cut_substate
		self:transition_to(state_stopped_jumping, 'ceiling')
	end

	self.jump_substate = self.jump_substate + 1
	if self.jump_substate >= p.jump_to_fall_substate then
		self.fall_substate = 0
		self:transition_to(state_controlled_fall, 'jump_apex')
	end
end

function player:tick_stopped_jumping()
	self.debug_jump_substate = self.jump_substate
	self.debug_fall_substate = -1

	local move_result = self:apply_move(self.jump_inertia * constants.physics.jump_dx, 0)
	if move_result.collided_x then
		self.jump_inertia = 0
	end

	self.jump_substate = self.jump_substate + 1
	if self.jump_substate >= constants.physics.jump_to_fall_substate then
		self.fall_substate = 0
		self:transition_to(state_controlled_fall, 'stopped_to_fall')
	end
end

function player:tick_controlled_fall()
	self.debug_jump_substate = -1
	self.debug_fall_substate = self.fall_substate

	local dx = self:get_controlled_fall_dx()
	local dy = self:get_controlled_fall_dy()
	local move_result = self:apply_move(dx, dy)

	if move_result.collided_x then
		self.jump_inertia = 0
	end

	if move_result.landed or (dy == 0 and self:is_grounded()) then
		self.fall_substate = 0
		self:emit_event('land', string.format('x=%d|y=%d', self.x, self.y))
		self:transition_to(state_quiet, 'landed')
		return
	end

	self.fall_substate = self.fall_substate + 1
end

function player:tick_uncontrolled_fall()
	self.debug_jump_substate = -1
	self.debug_fall_substate = self.fall_substate

	local dy = self:get_uncontrolled_fall_dy()
	local move_result = self:apply_move(0, dy)

	if move_result.landed then
		self.fall_substate = 0
		self:emit_event('land', string.format('x=%d|y=%d', self.x, self.y))
		self:transition_to(state_quiet, 'landed')
		return
	end

	self.fall_substate = self.fall_substate + 1
end

function player:tick()
	self.frame = self.frame + 1
	self:sample_input()

	if self.sc:matches_state_path(state_walking_right) then
		self:tick_walking_right()
	elseif self.sc:matches_state_path(state_walking_left) then
		self:tick_walking_left()
	elseif self.sc:matches_state_path(state_jumping) then
		self:tick_jumping()
	elseif self.sc:matches_state_path(state_stopped_jumping) then
		self:tick_stopped_jumping()
	elseif self.sc:matches_state_path(state_controlled_fall) then
		self:tick_controlled_fall()
	elseif self.sc:matches_state_path(state_uncontrolled_fall) then
		self:tick_uncontrolled_fall()
	else
		self:tick_quiet()
	end

	self.grounded = self:is_grounded()
	self:emit_metric()
end

local function define_player_fsm()
	define_fsm(player_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					return '/quiet'
				end,
			},
			quiet = {
				entering_state = function(self)
					self.state_name = 'quiet'
				end,
			},
			walking_right = {
				entering_state = function(self)
					self.state_name = 'walking_right'
					self:reset_walk_animation()
				end,
			},
			walking_left = {
				entering_state = function(self)
					self.state_name = 'walking_left'
					self:reset_walk_animation()
				end,
			},
			jumping = {
				entering_state = function(self)
					self.state_name = 'jumping'
				end,
			},
			stopped_jumping = {
				entering_state = function(self)
					self.state_name = 'stopped_jumping'
				end,
			},
			controlled_fall = {
				entering_state = function(self)
					self.state_name = 'controlled_fall'
				end,
			},
			uncontrolled_fall = {
				entering_state = function(self)
					self.state_name = 'uncontrolled_fall'
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
			room = nil,
			player_index = 1,
			width = constants.player.width,
			height = constants.player.height,
			spawn_x = constants.player.start_x,
			spawn_y = constants.player.start_y,
			x = constants.player.start_x,
			y = constants.player.start_y,
			facing = 1,
			state_name = 'boot',
			jump_substate = 0,
			fall_substate = 0,
			jump_inertia = 0,
			grounded = true,
			left_held = false,
			right_held = false,
			up_held = false,
			up_pressed = false,
			up_released = false,
			last_dx = 0,
			last_dy = 0,
			walk_frame = 0,
			walk_distance_accum = 0,
			debug_jump_substate = -1,
			debug_fall_substate = -1,
			frame = 0,
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
