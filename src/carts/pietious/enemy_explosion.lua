local constants = require('constants')
local eventemitter = require('eventemitter')

local enemy_explosion = {}
enemy_explosion.__index = enemy_explosion

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
		event_name = 'timeline.frame.' .. 'enemy_explosion.def' .. '.timeline.explosion',
		subscriber = self,
		handler = function(event)
			self:sync_explosion_sprite(event.frame_value)
		end,
	})

	self.events:on({
		event_name = 'timeline.end.' .. 'enemy_explosion.def' .. '.timeline.explosion',
		subscriber = self,
		handler = function()
			self:spawn_loot()
			self:mark_for_disposal()
		end,
	})

	eventemitter.eventemitter.instance:on({
		event = 'room.switched',
		subscriber = self,
		handler = function(_event)
			self:mark_for_disposal()
		end,
	})
end

function enemy_explosion:sync_explosion_sprite(imgid)
	self:gfx(imgid)
	self.visible = true
end

function enemy_explosion:spawn_loot()
	if self.loot_type == 'none' then
		return
	end

	local room_space = service('c').current_room.space_id
	loot_spawn_sequence = loot_spawn_sequence + 1
	local loot_id = string.format('%s.loot.%d', self.id, loot_spawn_sequence)
	inst('loot_drop.def', {
		id = loot_id,
		loot_type = self.loot_type,
		space_id = room_space,
		loot_value = loot_value_for_type(self.loot_type),
		pos = { x = self.x, y = self.y, z = 113 },
	})
end

function enemy_explosion:ctor()
	self:gfx(explosion_frames[1])
	self.sprite_component.offset = { x = 0, y = 0, z = 114 }
	self:define_timeline(timeline.new({
		id = 'enemy_explosion.def' .. '.timeline.explosion',
		frames = explosion_frames,
		ticks_per_frame = constants.enemy.explosion_frame_steps,
		playback_mode = 'once',
	}))
	self:bind_events()
	self:sync_explosion_sprite(explosion_frames[1])
end

local function define_enemy_explosion_fsm()
	define_fsm('enemy_explosion.fsm', {
		initial = 'animating',
		states = {
			animating = {
				entering_state = function(self)
					self:play_timeline('enemy_explosion.def' .. '.timeline.explosion', { rewind = true, snap_to_start = true })
				end,
			},
		},
	})
end

local function register_enemy_explosion_definition()
	define_prefab({
		def_id = 'enemy_explosion.def',
		class = enemy_explosion,
		type = 'sprite',
		fsms = { 'enemy_explosion.fsm' },
		defaults = {
			loot_type = 'none',
			tick_enabled = false,
		},
	})
end

return {
	enemy_explosion = enemy_explosion,
	define_enemy_explosion_fsm = define_enemy_explosion_fsm,
	register_enemy_explosion_definition = register_enemy_explosion_definition,
}
