local constants = require('constants.lua')
local engine = require('engine')
local eventemitter = require('eventemitter')
local enemy_module = require('enemy.lua')

local enemy_service = {}
enemy_service.__index = enemy_service

local enemy_service_fsm_id = constants.ids.enemy_service_fsm

function enemy_service:get_castle_service()
	local service = engine.service(self.game_service_id)
	if service == nil then
		error('pietious enemy_service missing castle service id=' .. tostring(self.game_service_id))
	end
	return service
end

function enemy_service:ensure_enemy_instance(enemy_def, room)
	local id = enemy_def.id
	local instance = self.enemies_by_id[id]
	if instance == nil then
		instance = engine.spawn_object(self.enemy_def_id, {
			id = id,
			space_id = room.space_id,
			pos = { x = enemy_def.x, y = enemy_def.y, z = 140 },
		})
		self.enemies_by_id[id] = instance
	end
	if not instance.active then
		instance:activate()
	end
	instance.space_id = room.space_id
	instance.visible = true
	instance:configure_from_room_def(enemy_def, room, self.player_id)
	return instance
end

function enemy_service:deactivate_unused_enemies(active_ids)
	for id, instance in pairs(self.enemies_by_id) do
		if active_ids[id] ~= true then
			instance.visible = false
			if instance.active then
				instance:deactivate()
			end
		end
	end
end

function enemy_service:sync_room_enemies()
	local castle_service = self:get_castle_service()
	local room = castle_service:get_current_room()
	local enemy_defs = room.enemies
	local active_ids = {}

	for i = 1, #enemy_defs do
		local def = enemy_defs[i]
		local instance = self:ensure_enemy_instance(def, room)
		active_ids[instance.id] = true
	end

	self:deactivate_unused_enemies(active_ids)
end

function enemy_service:bind_events()
	if self.events_bound then
		return
	end
	self.events_bound = true
	eventemitter.eventemitter.instance:on({
		event = constants.events.room_switched,
		subscriber = self,
		handler = function(_event)
			self:sync_room_enemies()
		end,
	})
end

local function define_enemy_service_fsm()
	define_fsm(enemy_service_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.enemies_by_id = {}
					self:bind_events()
					self:sync_room_enemies()
					return '/active'
				end,
			},
			active = {
				tick = function(_self)
				end,
			},
		},
	})
end

local function register_enemy_service_definition()
	define_service({
		def_id = constants.ids.enemy_service_def,
		class = enemy_service,
		fsms = { enemy_service_fsm_id },
		auto_activate = true,
		defaults = {
			id = constants.ids.enemy_service_instance,
			game_service_id = constants.ids.castle_service_instance,
			player_id = constants.ids.player_instance,
			enemy_def_id = enemy_module.enemy_def_id,
			enemies_by_id = {},
			events_bound = false,
			registrypersistent = false,
			tick_enabled = true,
		},
	})
end

return {
	enemy_service = enemy_service,
	define_enemy_service_fsm = define_enemy_service_fsm,
	register_enemy_service_definition = register_enemy_service_definition,
	enemy_service_def_id = constants.ids.enemy_service_def,
	enemy_service_instance_id = constants.ids.enemy_service_instance,
	enemy_service_fsm_id = enemy_service_fsm_id,
}
