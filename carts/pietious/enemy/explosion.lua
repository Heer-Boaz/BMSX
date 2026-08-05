local fsm_library<const> = require('cartlib/fsm/library')
local state_machine_component<const> = require('cartlib/fsm/component')
local prefab<const> = require('cartlib/prefab')
local spriteobject<const> = require('cartlib/sprite')
local timelinecomponent<const> = require('cartlib/timeline/component')
require('constants')
local worldobject<const> = require('cartlib/world/object')

local enemy_explosion<const> = {}
enemy_explosion.__index = enemy_explosion

local explosion_frames<const> = {
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
local explosion_timeline_id<const> = 'enemy_explosion.timeline.explosion'

local loot_value_for_type<const> = function(loot_type)
	if loot_type == 'life' then
		return enemy_loot_life_regen
	end
	if loot_type == 'ammo' then
		return enemy_loot_ammo_regen
	end
	error('pietious enemy_explosion invalid loot_type=' .. tostring(loot_type))
end

function enemy_explosion:sync_explosion_sprite(imgid)
	self:gfx(imgid)
	self.visible = true
end

function enemy_explosion:spawn_loot()
	if self.loot_type == nil then
		return
	end

	loot_spawn_sequence = loot_spawn_sequence + 1
	local loot_id<const> = string.format('%s.loot.%d', self.id, loot_spawn_sequence)
	prefab.spawn('loot_drop', {
		id = loot_id,
		loot_type = self.loot_type,
		loot_value = loot_value_for_type(self.loot_type),
		pos = { x = self.x, y = self.y, z = 113 },
	})
end

function enemy_explosion:ctor()
	self:gfx(explosion_frames[1])
	self:sync_explosion_sprite(explosion_frames[1])
end

local define_enemy_explosion_fsm<const> = function()
	fsm_library.register('enemy_explosion', {
		timelines = {
			[explosion_timeline_id] = {
				def = {
					frames = explosion_frames,
					ticks_per_frame = enemy_explosion_frame_steps,
					playback_mode = 'once',
				},
				autoplay = false,
				on_frame = function(self, _state, event)
					self:sync_explosion_sprite(event.frame_value)
				end,
				on_end = function(self)
					self:spawn_loot()
					self:despawn()
				end,
			},
		},
		initial = 'animating',
		on = {
			['room.switched'] = {
				emitter = 'pietolon',
				go = worldobject.despawn,
			},
		},
		states = {
			animating = {
				entering_state = function(self)
					self.timelines:play(explosion_timeline_id, { rewind = true, snap_to_start = true })
				end,
			},
		},
	})
end

local register_enemy_explosion_definition<const> = function()
	prefab.define({
		def_id = 'enemy_explosion',
		class = enemy_explosion,
		base = spriteobject,
		components = { timelinecomponent.new, state_machine_component.factory({ 'enemy_explosion' }) },
		defaults = {
			loot_type = nil,
		},
	})
end

return {
	enemy_explosion = enemy_explosion,
	define_enemy_explosion_fsm = define_enemy_explosion_fsm,
	register_enemy_explosion_definition = register_enemy_explosion_definition,
}
