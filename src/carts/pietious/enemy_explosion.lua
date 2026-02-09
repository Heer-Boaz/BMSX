local constants = require('constants.lua')
local components = require('components')
local engine = require('engine')
local eventemitter = require('eventemitter')

local enemy_explosion = {}
enemy_explosion.__index = enemy_explosion

local loot_drop_module = require('loot_drop.lua')

local enemy_explosion_fsm_id = constants.ids.enemy_explosion_fsm
local state_animating = enemy_explosion_fsm_id .. ':/animating'

local body_sprite_component_id = 'body'

local explosion_frames = {
	'explosion_2',
	'explosion_3',
	'explosion_1',
	'explosion_2',
	'explosion_3',
	'explosion_1',
	'explosion_2',
	'explosion_3',
}

local loot_spawn_sequence = 0

local function loot_value_for_type(loot_type)
	if loot_type == 'life' then
		return constants.enemy.loot_life_regen
	end
	if loot_type == 'ammo' then
		return constants.enemy.loot_ammo_regen
	end
	error('pietious enemy_explosion invalid loot_type=' .. tostring(loot_type))
end

function enemy_explosion:ensure_components()
	local body_sprite = self:get_component_by_local_id('spritecomponent', body_sprite_component_id)
	if body_sprite == nil then
		body_sprite = components.spritecomponent.new({
			parent = self,
			id_local = body_sprite_component_id,
			imgid = explosion_frames[1],
			offset = { x = 0, y = 0, z = 114 },
		})
		self:add_component(body_sprite)
	end
	self.body_sprite = body_sprite
end

function enemy_explosion:bind_events()
	if self.events_bound then
		return
	end
	self.events_bound = true

	eventemitter.eventemitter.instance:on({
		event = constants.events.room_switched,
		subscriber = self,
		handler = function(event)
			if event.to ~= self.room_id then
				self:mark_for_disposal()
			end
		end,
	})
end

function enemy_explosion:update_visual()
	self:ensure_components()
	self.body_sprite.imgid = explosion_frames[self.frame_index]
	self.body_sprite.enabled = true
end

function enemy_explosion:spawn_loot()
	if self.loot_type == 'none' then
		return
	end

	loot_spawn_sequence = loot_spawn_sequence + 1
	local loot_id = string.format('%s.loot.%d', self.id, loot_spawn_sequence)
	engine.spawn_object(loot_drop_module.loot_drop_def_id, {
		id = loot_id,
		space_id = constants.spaces.castle,
		room_id = self.room_id,
		player_id = self.player_id,
		loot_type = self.loot_type,
		loot_value = loot_value_for_type(self.loot_type),
		pos = { x = self.x, y = self.y, z = 113 },
	})
end

function enemy_explosion:tick_animating(delta)
	local step_delta = delta / 20
	self.elapsed_steps = self.elapsed_steps + step_delta
	local frame_duration = constants.enemy.explosion_frame_steps
	while self.elapsed_steps >= frame_duration do
		self.elapsed_steps = self.elapsed_steps - frame_duration
		self.frame_index = self.frame_index + 1
		if self.frame_index > #explosion_frames then
			self:spawn_loot()
			self:mark_for_disposal()
			return
		end
		self:update_visual()
	end
end

function enemy_explosion:tick(delta)
	if self.sc:matches_state_path(state_animating) then
		self:tick_animating(delta)
	end
end

local function define_enemy_explosion_fsm()
	define_fsm(enemy_explosion_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.state_name = 'boot'
					self.state_variant = 'boot'
					self.frame_index = 1
					self.elapsed_steps = 0
					self:ensure_components()
					self:bind_events()
					self:update_visual()
					return '/animating'
				end,
			},
			animating = {
				entering_state = function(self)
					self.state_name = 'animating'
					self.state_variant = 'animating'
					self:update_visual()
				end,
			},
		},
	})
end

local function register_enemy_explosion_definition()
	define_world_object({
		def_id = constants.ids.enemy_explosion_def,
		class = enemy_explosion,
		fsms = { enemy_explosion_fsm_id },
		defaults = {
			space_id = constants.spaces.castle,
			room_id = '',
			player_id = constants.ids.player_instance,
			loot_type = 'none',
			frame_index = 1,
			elapsed_steps = 0,
			state_name = 'boot',
			state_variant = 'boot',
			events_bound = false,
			registrypersistent = false,
			tick_enabled = true,
		},
	})
end

return {
	enemy_explosion = enemy_explosion,
	define_enemy_explosion_fsm = define_enemy_explosion_fsm,
	register_enemy_explosion_definition = register_enemy_explosion_definition,
	enemy_explosion_def_id = constants.ids.enemy_explosion_def,
	enemy_explosion_fsm_id = enemy_explosion_fsm_id,
}
