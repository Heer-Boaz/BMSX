local constants = require('constants.lua')
local eventemitter = require('eventemitter')
local enemy_module = require('enemy.lua')

local enemy_service = {}
enemy_service.__index = enemy_service

local function room_conditions_for(self, room_id)
	local room_conditions = self.room_conditions_by_id[room_id]
	if room_conditions == nil then
		room_conditions = {}
		self.room_conditions_by_id[room_id] = room_conditions
	end
	return room_conditions
end

local function enemy_condition_matches(self, condition, enemy_def, room_id)
	if condition == 'not_destroyed' then
		return self.destroyed_enemy_ids[enemy_def.id] ~= true
	end

	local inverted = condition:sub(1, 1) == '!'
	local token = condition
	if inverted then
		token = condition:sub(2)
	end

	local room_conditions = room_conditions_for(self, room_id)
	local condition_is_set = room_conditions[token] == true
	if inverted then
		return not condition_is_set
	end
	return condition_is_set
end

function enemy_service:require_current_room_event(event_room_id, event_name)
	local current_room_id = service(constants.ids.castle_service_instance).current_room.room_id
	if event_room_id ~= current_room_id then
		error('pietious enemy_service received ' .. event_name .. ' for room ' .. tostring(event_room_id) .. ' while current room is ' .. tostring(current_room_id))
	end
end

function enemy_service:is_enemy_active_in_room(enemy_def, room_id)
	local conditions = enemy_def.conditions or {}
	for i = 1, #conditions do
		if not enemy_condition_matches(self, conditions[i], enemy_def, room_id) then
			return false
		end
	end
	return true
end

function enemy_service:mark_room_condition(room_id, condition)
	room_conditions_for(self, room_id)[condition] = true
end

function enemy_service:emit_room_condition_set(room_id, condition)
	eventemitter.eventemitter.instance:emit(constants.events.room_condition_set, self.id, {
		room_id = room_id,
		condition = condition,
	})
end

function enemy_service:sync_enemy_instance(enemy_def, room)
	local id = enemy_def.id
	local instance = object(id)
	if instance == nil then
		instance = spawn_object(self.enemy_def_id, {
			id = id,
			space_id = room.space_id,
			pos = { x = enemy_def.x, y = enemy_def.y, z = 140 },
		})
	end
	self.enemies_by_id[id] = instance
	if not instance.active then
		instance:activate()
	end
	instance.space_id = room.space_id
	instance.visible = true
	instance:configure_from_room_def(enemy_def, room)
	return instance
end

function enemy_service:deactivate_all_enemies()
	for id, instance in pairs(self.enemies_by_id) do
		local live_instance = object(id)
		if live_instance == nil then
			self.enemies_by_id[id] = nil
		else
			self.enemies_by_id[id] = live_instance
			live_instance.visible = false
			if live_instance.active then
				live_instance:deactivate()
			end
		end
	end
end

function enemy_service:enter_current_room()
	local room = service(constants.ids.castle_service_instance).current_room
	local enemy_defs = room.enemies

	self:deactivate_all_enemies()

	for i = 1, #enemy_defs do
		local enemy_def = enemy_defs[i]
		if self:is_enemy_active_in_room(enemy_def, room.room_id) then
			self:sync_enemy_instance(enemy_def, room)
		end
	end
end

function enemy_service:on_room_switched(_event)
	self:enter_current_room()
end

function enemy_service:on_enemy_defeated(event)
	self:require_current_room_event(event.room_id, 'enemy_defeated')
	self.destroyed_enemy_ids[event.enemy_id] = true
	self.enemies_by_id[event.enemy_id] = nil
	if event.kind == 'cloud' then
		self:emit_room_condition_set(event.room_id, 'cloud_1_destroyed')
	end
	if event.trigger ~= '' then
		self:emit_room_condition_set(event.room_id, event.trigger)
	end
end

function enemy_service:on_room_condition_set(event)
	self:require_current_room_event(event.room_id, 'room_condition_set')
	self:mark_room_condition(event.room_id, event.condition)
end

function enemy_service:bind_events()
	eventemitter.eventemitter.instance:on({
		event = constants.events.room_switched,
		subscriber = self,
		handler = function(event)
			self:on_room_switched(event)
		end,
	})

	eventemitter.eventemitter.instance:on({
		event = constants.events.enemy_defeated,
		subscriber = self,
		handler = function(event)
			self:on_enemy_defeated(event)
		end,
	})

	eventemitter.eventemitter.instance:on({
		event = constants.events.room_condition_set,
		subscriber = self,
		handler = function(event)
			self:on_room_condition_set(event)
		end,
	})
end

local function define_enemy_service_fsm()
	define_fsm(constants.ids.enemy_service_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.enemies_by_id = {}
					self.destroyed_enemy_ids = {}
					self.room_conditions_by_id = {}
					self:bind_events()
					self:enter_current_room()
					return '/active'
				end,
			},
			active = {},
		},
	})
end

local function register_enemy_service_definition()
	define_service({
		def_id = constants.ids.enemy_service_def,
		class = enemy_service,
		fsms = { constants.ids.enemy_service_fsm },
		auto_activate = true,
		defaults = {
			id = constants.ids.enemy_service_instance,
			enemy_def_id = enemy_module.enemy_def_id,
			enemies_by_id = {},
			destroyed_enemy_ids = {},
			room_conditions_by_id = {},
			registrypersistent = false,
			tick_enabled = false,
		},
	})
end

return {
	enemy_service = enemy_service,
	define_enemy_service_fsm = define_enemy_service_fsm,
	register_enemy_service_definition = register_enemy_service_definition,
	enemy_service_def_id = constants.ids.enemy_service_def,
	enemy_service_instance_id = constants.ids.enemy_service_instance,
	enemy_service_fsm_id = constants.ids.enemy_service_fsm,
}
