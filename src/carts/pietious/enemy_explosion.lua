local constants = require('constants.lua')
local components = require('components')
local engine = require('engine')
local eventemitter = require('eventemitter')

local enemy_explosion = {}
enemy_explosion.__index = enemy_explosion

local loot_drop_module = require('loot_drop.lua')

local enemy_explosion_fsm_id = constants.ids.enemy_explosion_fsm
local enemy_explosion_timeline_id = constants.ids.enemy_explosion_def .. '.timeline.explosion'
local enemy_explosion_frame_event = 'timeline.frame.' .. enemy_explosion_timeline_id
local enemy_explosion_end_event = 'timeline.end.' .. enemy_explosion_timeline_id

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

	self.events:on({
		event_name = enemy_explosion_frame_event,
		subscriber = self,
		handler = function(event)
			self:update_visual(event.frame_value)
		end,
	})

	self.events:on({
		event_name = enemy_explosion_end_event,
		subscriber = self,
		handler = function()
			self:spawn_loot()
			self:mark_for_disposal()
		end,
	})

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

function enemy_explosion:update_visual(imgid)
	self:ensure_components()
	self.body_sprite.imgid = imgid or explosion_frames[1]
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
		space_id = self.space_id,
		room_id = self.room_id,
		player_id = self.player_id,
		loot_type = self.loot_type,
		loot_value = loot_value_for_type(self.loot_type),
		pos = { x = self.x, y = self.y, z = 113 },
	})
end

local function define_enemy_explosion_fsm()
	define_fsm(enemy_explosion_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.state_name = 'boot'
					self.state_variant = 'boot'
					self:ensure_components()
					self:define_timeline(engine.new_timeline({
						id = enemy_explosion_timeline_id,
						frames = explosion_frames,
						ticks_per_frame = constants.enemy.explosion_frame_steps,
						playback_mode = 'once',
					}))
					self:bind_events()
					self:update_visual(explosion_frames[1])
					return '/animating'
				end,
			},
			animating = {
				entering_state = function(self)
					self.state_name = 'animating'
					self.state_variant = 'animating'
					self:play_timeline(enemy_explosion_timeline_id, { rewind = true, snap_to_start = true })
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
			state_name = 'boot',
			state_variant = 'boot',
			events_bound = false,
			registrypersistent = false,
			tick_enabled = false,
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
