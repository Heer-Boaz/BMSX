local constants = require('constants.lua')
local components = require('components')
local eventemitter = require('eventemitter')

local enemy_explosion = {}
enemy_explosion.__index = enemy_explosion

local loot_drop_module = require('loot_drop.lua')

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

function enemy_explosion:bind_events()
	self.events:on({
		event_name = 'timeline.frame.' .. constants.ids.enemy_explosion_def .. '.timeline.explosion',
		subscriber = self,
		handler = function(event)
			self:update_visual(event.frame_value)
		end,
	})

	self.events:on({
		event_name = 'timeline.end.' .. constants.ids.enemy_explosion_def .. '.timeline.explosion',
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
			if event.to ~= self.room_number then
				self:mark_for_disposal()
			end
		end,
	})
end

function enemy_explosion:update_visual(imgid)
	self.body_sprite.imgid = imgid
	self.body_sprite.enabled = true
end

function enemy_explosion:spawn_loot()
	if self.loot_type == 'none' then
		return
	end

	loot_spawn_sequence = loot_spawn_sequence + 1
	local loot_id = string.format('%s.loot.%d', self.id, loot_spawn_sequence)
	spawn_object(loot_drop_module.loot_drop_def_id, {
		id = loot_id,
		space_id = self.space_id,
		room_number = self.room_number,
		loot_type = self.loot_type,
		loot_value = loot_value_for_type(self.loot_type),
		pos = { x = self.x, y = self.y, z = 113 },
	})
end

local function define_enemy_explosion_fsm()
	define_fsm(constants.ids.enemy_explosion_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.state_name = 'boot'
					self.body_sprite = components.spritecomponent.new({
						parent = self,
						id_local = 'body',
						imgid = explosion_frames[1],
						offset = { x = 0, y = 0, z = 114 },
					})
					self:add_component(self.body_sprite)
					self:define_timeline(new_timeline({
						id = constants.ids.enemy_explosion_def .. '.timeline.explosion',
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
					self:play_timeline(constants.ids.enemy_explosion_def .. '.timeline.explosion', { rewind = true, snap_to_start = true })
				end,
			},
		},
	})
end

local function register_enemy_explosion_definition()
	define_world_object({
		def_id = constants.ids.enemy_explosion_def,
		class = enemy_explosion,
		fsms = { constants.ids.enemy_explosion_fsm },
		defaults = {
			space_id = constants.spaces.castle,
			room_number = 0,
			loot_type = 'none',
			state_name = 'boot',
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
	enemy_explosion_fsm_id = constants.ids.enemy_explosion_fsm,
}
