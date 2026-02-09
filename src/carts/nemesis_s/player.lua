local constants = require('constants.lua')
local stage = require('stage.lua')

local player = {}
player.__index = player

local player_fsm_id = constants.ids.player_fsm

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
		print(string.format('%s|kind=player|f=%d|name=%s|%s', telemetry.event_prefix, self.frame, name, extra))
		return
	end
	print(string.format('%s|kind=player|f=%d|name=%s', telemetry.event_prefix, self.frame, name))
end

function player:get_projectile_snapshot(index)
	local projectile = self.projectiles[index]
	if projectile == nil then
		return -1, -1
	end
	return projectile.x, projectile.y
end

function player:emit_metric()
	local telemetry = constants.telemetry
	if not telemetry.enabled then
		return
	end
	local p0x, p0y = self:get_projectile_snapshot(1)
	local p1x, p1y = self:get_projectile_snapshot(2)
	print(string.format(
		'%s|kind=player|f=%d|x=%.3f|y=%.3f|dx=%.3f|dy=%.3f|sprite=%s|speed=%.3f|left=%d|right=%d|up=%d|down=%d|fire=%d|fire_press=%d|pc=%d|p0x=%.3f|p0y=%.3f|p1x=%.3f|p1y=%.3f',
		telemetry.metric_prefix,
		self.frame,
		self.x,
		self.y,
		self.last_dx,
		self.last_dy,
		self.sprite_imgid,
		self.last_speed,
		bool01(self.left_held),
		bool01(self.right_held),
		bool01(self.up_held),
		bool01(self.down_held),
		bool01(self.fire_held),
		bool01(self.fire_pressed),
		#self.projectiles,
		p0x,
		p0y,
		p1x,
		p1y
	))
end

function player:reset_runtime()
	self.frame = 0
	self.x = constants.player.start_x
	self.y = constants.player.start_y
	self.last_dx = 0
	self.last_dy = 0
	self.last_speed = 0
	self.left_held = false
	self.right_held = false
	self.up_held = false
	self.down_held = false
	self.fire_held = false
	self.fire_pressed = false
	self.speed_powerups = constants.player.speed_powerups
	self.sprite_imgid = constants.assets.player_n
	self.projectiles = {}
	self:emit_event('player_reset', string.format('x=%d|y=%d', self.x, self.y))
end

function player:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_visual()
	end
end

function player:draw_visual()
	put_sprite(self.sprite_imgid, self.x, self.y, 120)
	for i = 1, #self.projectiles do
		local projectile = self.projectiles[i]
		put_sprite(constants.assets.projectile, projectile.x, projectile.y, 122)
	end
end

function player:sample_input()
	local player_index = self.player_index
	local previous_fire = self.fire_held
	self.left_held = action_triggered('left[p]', player_index)
	self.right_held = action_triggered('right[p]', player_index)
	self.up_held = action_triggered('up[p]', player_index)
	self.down_held = action_triggered('down[p]', player_index)
	self.fire_held = action_triggered('x[p]', player_index) or action_triggered('a[p]', player_index) or action_triggered('b[p]', player_index)
	self.fire_pressed = self.fire_held and (not previous_fire)
end

function player:get_movement_speed(dt_ms)
	local factor = dt_ms / constants.machine.frame_interval_ms
	local base_speed = constants.player.base_movement_speed
	local speed_boost = constants.player.movement_speed_increase * self.speed_powerups
	return factor * (base_speed + speed_boost)
end

function player:update_position(move_speed)
	local max_x = constants.machine.game_width - constants.player.width
	local max_y = constants.machine.game_height - constants.player.height

	local previous_x = self.x
	local previous_y = self.y

	local function clamp_axis(value, min_value, max_value)
		return math.min(math.max(value, min_value), max_value)
	end

	local function collides_at(x, y)
		local hitcheck_x = constants.player.hitcheck_x
		local hitcheck_y = constants.player.hitcheck_y
		for i = 1, #hitcheck_x do
			if stage.is_solid_pixel(x + hitcheck_x[i], y + hitcheck_y[i]) then
				return true
			end
		end
		return false
	end

	local function try_move_x(dx)
		if dx == 0 then
			return
		end
		local target_x = clamp_axis(self.x + dx, 0, max_x)
		if collides_at(target_x, self.y) then
			self:emit_event('collision_block_x', string.format('x=%.3f|y=%.3f|dx=%.3f', target_x, self.y, dx))
			return
		end
		self.x = target_x
	end

	local function try_move_y(dy)
		if dy == 0 then
			return
		end
		local target_y = clamp_axis(self.y + dy, 0, max_y)
		if collides_at(self.x, target_y) then
			self:emit_event('collision_block_y', string.format('x=%.3f|y=%.3f|dy=%.3f', self.x, target_y, dy))
			return
		end
		self.y = target_y
	end

	if self.left_held then
		try_move_x(-move_speed)
	end
	if self.right_held then
		try_move_x(move_speed)
	end

	if self.up_held then
		try_move_y(-move_speed)
		self.sprite_imgid = constants.assets.player_u
	elseif self.down_held then
		try_move_y(move_speed)
		self.sprite_imgid = constants.assets.player_d
	else
		self.sprite_imgid = constants.assets.player_n
	end

	self.last_dx = self.x - previous_x
	self.last_dy = self.y - previous_y
end

function player:fire_projectile()
	if #self.projectiles >= constants.player.max_projectiles then
		self:emit_event('fire_blocked', string.format('reason=max_projectiles|pc=%d', #self.projectiles))
		return
	end

	local projectile = {
		x = self.x + constants.player.fire_spawn_offset_x,
		y = self.y + constants.player.fire_spawn_offset_y,
	}
	self.projectiles[#self.projectiles + 1] = projectile
	self:emit_event(
		'fire_spawn',
		string.format(
			'pc=%d|x=%.3f|y=%.3f',
			#self.projectiles,
			projectile.x,
			projectile.y
		)
	)
end

function player:despawn_projectile(index, reason)
	local projectile = self.projectiles[index]
	local last_index = #self.projectiles
	self.projectiles[index] = self.projectiles[last_index]
	self.projectiles[last_index] = nil
	self:emit_event(
		'fire_despawn',
		string.format('pc=%d|x=%.3f|y=%.3f|reason=%s', #self.projectiles, projectile.x, projectile.y, reason)
	)
end

function player:update_projectiles(dt_ms)
	local factor = dt_ms / constants.machine.frame_interval_ms
	local step = constants.projectile.movement_speed * factor
	local max_x = constants.machine.game_width
	local index = #self.projectiles
	while index >= 1 do
		local projectile = self.projectiles[index]
		projectile.x = projectile.x + step
		local impact_x = projectile.x + constants.projectile.width
		local impact_y = projectile.y + (constants.projectile.height * 0.5)
		if stage.is_solid_pixel(impact_x, impact_y) then
			self:despawn_projectile(index, 'stage_collision')
		elseif projectile.x >= max_x then
			self:despawn_projectile(index, 'screen_edge')
		end
		index = index - 1
	end
end

function player:tick(dt_ms)
	self:sample_input()
	local move_speed = self:get_movement_speed(dt_ms)
	self.last_speed = move_speed
	self:update_position(move_speed)

	if self.fire_pressed then
		self:fire_projectile()
	end

	self:update_projectiles(dt_ms)
	self:emit_metric()
	self.frame = self.frame + 1
end

local function define_player_fsm()
	define_fsm(player_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:reset_runtime()
					self:bind_visual()
					return '/flying'
				end,
			},
			flying = {},
		},
	})
end

local function register_player_definition()
	define_world_object({
		def_id = constants.ids.player_def,
		class = player,
		fsms = { player_fsm_id },
		components = { 'customvisualcomponent' },
		defaults = {
			player_index = 1,
			frame = 0,
			x = constants.player.start_x,
			y = constants.player.start_y,
			last_dx = 0,
			last_dy = 0,
			last_speed = 0,
			left_held = false,
			right_held = false,
			up_held = false,
			down_held = false,
			fire_held = false,
			fire_pressed = false,
			speed_powerups = constants.player.speed_powerups,
			sprite_imgid = constants.assets.player_n,
			projectiles = {},
		},
	})
end

return {
	player = player,
	define_player_fsm = define_player_fsm,
	register_player_definition = register_player_definition,
	player_def_id = constants.ids.player_def,
	player_instance_id = constants.ids.player_instance,
	player_fsm_id = player_fsm_id,
}
