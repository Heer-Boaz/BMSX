local constants = require('constants')

local enemy_explosion = {}
enemy_explosion.__index = enemy_explosion

local loot_drop_module = require('loot_drop')

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
			self:sync_explosion_sprite(event.frame_value)
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
end

function enemy_explosion:sync_explosion_sprite(imgid)
	self.sprite_component.imgid = imgid
	self.visible = true
end

function enemy_explosion:spawn_loot()
	if self.loot_type == 'none' then
		return
	end

	local room_space = service(constants.ids.castle_service_instance).current_room.space_id
	loot_spawn_sequence = loot_spawn_sequence + 1
	local loot_id = string.format('%s.loot.%d', self.id, loot_spawn_sequence)
	inst(loot_drop_module.loot_drop_def_id, {
		id = loot_id,
		loot_type = self.loot_type,
		space_id = room_space,
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
					self.sprite_component.imgid = explosion_frames[1]
					self.sprite_component.offset = { x = 0, y = 0, z = 114 }
						self:define_timeline(new_timeline({
							id = constants.ids.enemy_explosion_def .. '.timeline.explosion',
						frames = explosion_frames,
						ticks_per_frame = constants.enemy.explosion_frame_steps,
						playback_mode = 'once',
						}))
						self:bind_events()
						self:sync_explosion_sprite(explosion_frames[1])
						return '/animating'
					end,
				},
			animating = {
				entering_state = function(self)
					self:play_timeline(constants.ids.enemy_explosion_def .. '.timeline.explosion', { rewind = true, snap_to_start = true })
				end,
			},
		},
	})
end

local function register_enemy_explosion_definition()
	define_prefab({
		def_id = constants.ids.enemy_explosion_def,
		class = enemy_explosion,
		type = 'sprite',
		fsms = { constants.ids.enemy_explosion_fsm },
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
	enemy_explosion_def_id = constants.ids.enemy_explosion_def,
	enemy_explosion_fsm_id = constants.ids.enemy_explosion_fsm,
}
