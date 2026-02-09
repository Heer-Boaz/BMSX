local constants = require('constants.lua')
local components = require('components')
local engine = require('engine')
local enemy_explosion_module = require('enemy_explosion.lua')

local enemy = {}
enemy.__index = enemy

local enemy_fsm_id = constants.ids.enemy_fsm
local state_waiting = enemy_fsm_id .. ':/waiting'
local state_flying = enemy_fsm_id .. ':/flying'
local state_dead = enemy_fsm_id .. ':/dead'

local body_sprite_component_id = 'body'
local body_collider_component_id = 'body'
local death_effect_sequence = 0

local function random_between(min_value, max_value)
	return math.random(min_value, max_value)
end

local function random_percent_hit(chance_pct)
	return math.random(100) <= chance_pct
end

local function direction_from_definition(def)
	if def.direction ~= nil then
		local direction = string.lower(def.direction)
		if direction == 'up' or direction == 'right' or direction == 'down' or direction == 'left' then
			return direction
		end
		error('pietious enemy invalid direction=' .. tostring(def.direction))
	end
	local facing = def.facing or 1
	if facing < 0 then
		return 'left'
	end
	if facing > 0 then
		return 'right'
	end
	return 'down'
end

function enemy:ensure_visual_components()
	local body_collider = self:get_component_by_local_id('collider2dcomponent', body_collider_component_id)
	if body_collider == nil then
		body_collider = components.collider2dcomponent.new({
			parent = self,
			id_local = body_collider_component_id,
			generateoverlapevents = true,
			spaceevents = 'current',
		})
		body_collider:apply_collision_profile('enemy')
		self:add_component(body_collider)
	end

	local body_sprite = self:get_component_by_local_id('spritecomponent', body_sprite_component_id)
	if body_sprite == nil then
		body_sprite = components.spritecomponent.new({
			parent = self,
			id_local = body_sprite_component_id,
			imgid = 'meijter_up',
			offset = { x = 0, y = 0, z = 110 },
			collider_local_id = body_collider_component_id,
		})
		self:add_component(body_sprite)
	end
	self.body_collider = body_collider
	self.body_sprite = body_sprite
end

function enemy:bind_overlap_events()
	if self.overlap_events_bound then
		return
	end
	self.overlap_events_bound = true
	self.events:on({
		event_name = 'overlap.stay',
		subscriber = self,
		handler = function(event)
			self:on_overlap_stay(event)
		end,
	})
end

function enemy:update_visual_components()
	self:ensure_visual_components()
	local body_sprite = self.body_sprite
	if self.state_variant == 'dead' then
		body_sprite.enabled = false
		return
	end
	body_sprite.enabled = true

	local imgid = 'meijter_up'
	local flip_h = false
	local flip_v = false

	if self.state_variant == 'waiting' then
		if self.direction == 'left' then
			imgid = 'meijter_r'
			flip_h = true
		elseif self.direction == 'right' then
			imgid = 'meijter_r'
		elseif self.direction == 'down' then
			imgid = 'meijter_up'
			flip_v = true
		else
			imgid = 'meijter_up'
		end
	else
		local h = self.horizontal_dir_mod
		local v = self.vertical_dir_mod
		if v == -1 and h == 0 then
			imgid = 'meijter_up'
		elseif v == -1 and h == 1 then
			imgid = 'meijter_dr'
			flip_v = true
		elseif v == 0 and h == 1 then
			imgid = 'meijter_r'
		elseif v == 1 and h == 1 then
			imgid = 'meijter_dr'
		elseif v == 1 and h == 0 then
			imgid = 'meijter_up'
			flip_v = true
		elseif v == 1 and h == -1 then
			imgid = 'meijter_dr'
			flip_h = true
		elseif v == 0 and h == -1 then
			imgid = 'meijter_r'
			flip_h = true
		elseif v == -1 and h == -1 then
			imgid = 'meijter_dr'
			flip_h = true
			flip_v = true
		end
	end

	body_sprite.imgid = imgid
	body_sprite.flip.flip_h = flip_h
	body_sprite.flip.flip_v = flip_v
end

function enemy:wait_duration(duration_ms, dt)
	if self.elapsed_ms < duration_ms then
		self.elapsed_ms = self.elapsed_ms + dt
		return false
	end
	self.elapsed_ms = 0
	return true
end

function enemy:new_random_direction()
	local horizontal = 0
	local vertical = 0
	while horizontal == 0 and vertical == 0 do
		horizontal = math.random(-1, 1)
		vertical = math.random(-1, 1)
	end
	self.horizontal_dir_mod = horizontal
	self.vertical_dir_mod = vertical
	self.time_before_turn_ms = random_between(constants.enemy.mijter_turn_min_ms, constants.enemy.mijter_turn_max_ms)
end

function enemy:configure_from_room_def(def, room, player_id)
	self:ensure_visual_components()
	self:bind_overlap_events()

	self.enemy_id = def.id
	self.room_id = room.room_id
	self.player_id = player_id
	self.kind = def.kind
	self.spawn_x = def.x
	self.spawn_y = def.y
	self.x = def.x
	self.y = def.y
	self.width = def.w
	self.height = def.h
	self.damage = def.damage
	self.max_health = def.health or constants.enemy.default_health
	self.health = self.max_health
	self.last_sword_hit_id = -1
	self.dangerous = true
	self.direction = direction_from_definition(def)
	self.horizontal_dir_mod = 0
	self.vertical_dir_mod = 0
	self.elapsed_ms = 0
	self.time_before_turn_ms = constants.enemy.mijter_turn_max_ms
	self.time_before_takeoff_ms = random_between(constants.enemy.mijter_wait_takeoff_min_ms, constants.enemy.mijter_wait_takeoff_max_ms)
	self.room_left = 0
	self.room_right = room.world_width
	self.room_top = room.world_top
	self.room_bottom = room.world_height
	self.state_variant = 'waiting'
	self.body_collider.enabled = true
	self.visible = true
	self.sc:transition_to(state_waiting)
	self:update_visual_components()
end

function enemy:choose_drop_type()
	if random_percent_hit(constants.enemy.mijter_drop_health_chance_pct) then
		return 'life'
	end
	if random_percent_hit(constants.enemy.mijter_drop_ammo_chance_pct) then
		return 'ammo'
	end
	return 'none'
end

function enemy:spawn_death_effect()
	death_effect_sequence = death_effect_sequence + 1
	local effect_id = string.format('pietious.enemy_explosion.%s.%d', self.enemy_id, death_effect_sequence)
	engine.spawn_object(enemy_explosion_module.enemy_explosion_def_id, {
		id = effect_id,
		space_id = constants.spaces.castle,
		room_id = self.room_id,
		player_id = self.player_id,
		loot_type = self:choose_drop_type(),
		pos = { x = self.x, y = self.y, z = 114 },
	})
end

function enemy:take_sword_hit(sword_id)
	if sword_id <= 0 then
		return false
	end
	if self.last_sword_hit_id == sword_id then
		return false
	end
	self.last_sword_hit_id = sword_id
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self.dangerous = false
		self:spawn_death_effect()
		self.sc:transition_to(state_dead)
		self:update_visual_components()
	end
	return true
end

function enemy:on_overlap_stay(event)
	if self.state_variant == 'dead' then
		return
	end
	if event.other_id ~= self.player_id then
		return
	end
	local player = engine.object(self.player_id)
	if player == nil then
		error('pietious enemy missing player object id=' .. tostring(self.player_id))
	end
	local other_collider = player:get_component_by_id(event.other_collider_id)
	if other_collider == nil then
		return
	end
	if other_collider.id_local == constants.ids.player_sword_collider_local then
		if player:is_slashing() then
			self:take_sword_hit(player.sword_id)
		end
		return
	end
	if other_collider.id_local == constants.ids.player_body_collider_local then
		player:take_hit(self.damage, self.x + math.floor(self.width / 2), self.y + math.floor(self.height / 2), self.kind)
	end
end

function enemy:tick_waiting(dt)
	local player = engine.object(self.player_id)
	if player == nil then
		error('pietious enemy missing player object id=' .. tostring(self.player_id))
	end

	local player_left = player.x
	local player_top = player.y
	local player_right = player.x + player.width
	local player_bottom = player.y + player.height
	local enemy_left = self.x + 2
	local enemy_top = self.y + 2
	local enemy_right = self.x + 14
	local enemy_bottom = self.y + 14
	local overlap_x = player_right >= enemy_left and player_left <= enemy_right
	local overlap_y = player_bottom >= enemy_top and player_top <= enemy_bottom

	local taking_off_anyway = self:wait_duration(self.time_before_takeoff_ms, dt)
	local start_flying = false

	if self.direction == 'up' then
		if (overlap_x and player_top < enemy_top) or taking_off_anyway then
			self.horizontal_dir_mod = 0
			self.vertical_dir_mod = -1
			start_flying = true
		end
	elseif self.direction == 'right' then
		if (overlap_y and player_left > enemy_right) or taking_off_anyway then
			self.horizontal_dir_mod = 1
			self.vertical_dir_mod = 0
			start_flying = true
		end
	elseif self.direction == 'down' then
		if (overlap_x and player_top > enemy_bottom) or taking_off_anyway then
			self.horizontal_dir_mod = 0
			self.vertical_dir_mod = 1
			start_flying = true
		end
	elseif self.direction == 'left' then
		if (overlap_y and player_right < enemy_left) or taking_off_anyway then
			self.horizontal_dir_mod = -1
			self.vertical_dir_mod = 0
			start_flying = true
		end
	end

	if start_flying then
		self.time_before_turn_ms = constants.enemy.mijter_turn_max_ms
		self.elapsed_ms = 0
		self.sc:transition_to(state_flying)
	end
end

function enemy:tick_flying(dt)
	if self:wait_duration(self.time_before_turn_ms, dt) then
		self:new_random_direction()
	end

	if self.x <= self.room_left then
		self.horizontal_dir_mod = 1
	elseif self.x + 14 >= self.room_right then
		self.horizontal_dir_mod = -1
	end
	if self.y <= self.room_top then
		self.vertical_dir_mod = 1
	elseif self.y + 14 >= self.room_bottom then
		self.vertical_dir_mod = -1
	end

	local movement_speed = dt / 20
	local speed = movement_speed * constants.enemy.mijter_speed_px
	self.x = self.x + (speed * self.horizontal_dir_mod)
	self.y = self.y + (speed * self.vertical_dir_mod)
end

function enemy:tick(dt)
	if self.state_variant == 'dead' then
		return
	end
	if self.sc:matches_state_path(state_waiting) then
		self:tick_waiting(dt)
	elseif self.sc:matches_state_path(state_flying) then
		self:tick_flying(dt)
	end
	self:update_visual_components()
end

local function define_enemy_fsm()
	define_fsm(enemy_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.state_name = 'boot'
					self.state_variant = 'boot'
					self:ensure_visual_components()
					self:bind_overlap_events()
					return '/waiting'
				end,
			},
			waiting = {
				entering_state = function(self)
					self.state_name = 'waiting'
					self.state_variant = 'waiting'
					self:update_visual_components()
				end,
			},
			flying = {
				entering_state = function(self)
					self.state_name = 'flying'
					self.state_variant = 'flying'
					self:update_visual_components()
				end,
			},
			dead = {
				entering_state = function(self)
					self.state_name = 'dead'
					self.state_variant = 'dead'
					self.dangerous = false
					self.body_collider.enabled = false
					self:update_visual_components()
				end,
			},
		},
	})
end

local function register_enemy_definition()
	define_world_object({
		def_id = constants.ids.enemy_def,
		class = enemy,
		fsms = { enemy_fsm_id },
		defaults = {
			space_id = constants.spaces.castle,
			enemy_id = '',
			room_id = '',
			player_id = constants.ids.player_instance,
			kind = 'enemy',
			width = 16,
			height = 16,
			damage = constants.damage.enemy_contact_damage,
			max_health = constants.enemy.default_health,
			health = constants.enemy.default_health,
			last_sword_hit_id = -1,
			dangerous = true,
			direction = 'down',
			horizontal_dir_mod = 0,
			vertical_dir_mod = 0,
			elapsed_ms = 0,
			time_before_turn_ms = constants.enemy.mijter_turn_max_ms,
			time_before_takeoff_ms = constants.enemy.mijter_wait_takeoff_max_ms,
			room_left = 0,
			room_right = constants.room.width,
			room_top = constants.room.hud_height,
			room_bottom = constants.room.height,
			spawn_x = 0,
			spawn_y = 0,
			state_name = 'boot',
			state_variant = 'boot',
			overlap_events_bound = false,
		},
	})
end

return {
	enemy = enemy,
	define_enemy_fsm = define_enemy_fsm,
	register_enemy_definition = register_enemy_definition,
	enemy_def_id = constants.ids.enemy_def,
	enemy_fsm_id = enemy_fsm_id,
}
