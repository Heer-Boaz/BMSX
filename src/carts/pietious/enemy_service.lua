local constants = require('constants')
local eventemitter = require('eventemitter')
local boekfoe_module = require('enemies/boekfoe')
local cloud_module = require('enemies/cloud')
local crossfoe_module = require('enemies/crossfoe')
local marspeinenaardappel_module = require('enemies/marspeinenaardappel')
local mijterfoe_module = require('enemies/mijterfoe')
local muziekfoe_module = require('enemies/muziekfoe')
local nootfoe_module = require('enemies/nootfoe')
local paperfoe_module = require('enemies/paperfoe')
local stafffoe_module = require('enemies/stafffoe')
local staffspawn_module = require('enemies/staffspawn')
local vlokfoe_module = require('enemies/vlokfoe')
local vlokspawner_module = require('enemies/vlokspawner')
local zakfoe_module = require('enemies/zakfoe')

local enemy_modules = {
	boekfoe = boekfoe_module,
	cloud = cloud_module,
	crossfoe = crossfoe_module,
	marspeinenaardappel = marspeinenaardappel_module,
	mijterfoe = mijterfoe_module,
	muziekfoe = muziekfoe_module,
	nootfoe = nootfoe_module,
	paperfoe = paperfoe_module,
	stafffoe = stafffoe_module,
	staffspawn = staffspawn_module,
	vlokfoe = vlokfoe_module,
	vlokspawner = vlokspawner_module,
	zakfoe = zakfoe_module,
}

local enemy_kinds = {
	'boekfoe',
	'cloud',
	'crossfoe',
	'marspeinenaardappel',
	'mijterfoe',
	'muziekfoe',
	'nootfoe',
	'paperfoe',
	'stafffoe',
	'staffspawn',
	'vlokfoe',
	'vlokspawner',
	'zakfoe',
}

local enemy_service = {}
enemy_service.__index = enemy_service

local function room_conditions_for(self, room_number)
	local room_conditions = self.room_conditions_by_number[room_number]
	if room_conditions == nil then
		room_conditions = {}
		self.room_conditions_by_number[room_number] = room_conditions
	end
	return room_conditions
end

local function enemy_condition_matches(self, condition, enemy_def, room_number)
	if condition == 'not_destroyed' then
		return self.destroyed_enemy_ids[enemy_def.id] ~= true
	end

	local inverted = condition:sub(1, 1) == '!'
	local token = inverted and condition:sub(2) or condition

	local room_conditions = room_conditions_for(self, room_number)
	local condition_is_set = room_conditions[token] == true
	if inverted then
		return not condition_is_set
	end
	return condition_is_set
end

function enemy_service:is_enemy_active_in_room(enemy_def, room_number)
	local conditions = enemy_def.conditions or {}
	for i = 1, #conditions do
		if not enemy_condition_matches(self, conditions[i], enemy_def, room_number) then
			return false
		end
	end
	return true
end

function enemy_service:mark_room_condition(room_number, condition)
	room_conditions_for(self, room_number)[condition] = true
end

function enemy_service:emit_room_condition_set(room_number, condition)
	eventemitter.eventemitter.instance:emit(constants.events.room_condition_set, self.id, {
		room_number = room_number,
		condition = condition,
	})
end

function enemy_service:sync_enemy_instance(enemy_def, room)
	local id = enemy_def.id
	local instance = object(id)
	if instance == nil then
		instance = spawn_sprite('pietious.enemy.def.' .. enemy_def.kind, {
			id = id,
			space_id = room.space_id,
			pos = { x = enemy_def.x, y = enemy_def.y, z = 140 },
		})
	end
	instance.space_id = room.space_id
	self.enemies_by_id[id] = instance
	if not instance.active then
		instance:activate()
	end
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
		if self:is_enemy_active_in_room(enemy_def, room.room_number) then
			self:sync_enemy_instance(enemy_def, room)
		end
	end
end

function enemy_service:on_enemy_defeated(event)
	self.destroyed_enemy_ids[event.emitter] = true
	self.enemies_by_id[event.emitter] = nil
	if event.kind == 'cloud' then
		self:emit_room_condition_set(event.room_number, 'cloud_1_destroyed')
	end
	if event.trigger ~= '' then
		self:emit_room_condition_set(event.room_number, event.trigger)
	end
end

function enemy_service:bind_events()
	eventemitter.eventemitter.instance:on({
		event = constants.events.room_switched,
		subscriber = self,
		handler = function(_event)
			self:enter_current_room()
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
			self:mark_room_condition(event.room_number, event.condition)
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
					self.room_conditions_by_number = {}
					self:bind_events()
					self:enter_current_room()
					return '/active'
				end,
			},
			active = {},
		},
	})
end

local function define_enemy_fsm()
	define_fsm(constants.ids.enemy_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self:bind_overlap_events()
					return '/waiting'
				end,
			},
			waiting = {
				tags = { 'e.w' },
				on = {
					['takeoff'] = '/flying',
					['reset_to_waiting'] = '/waiting',
				},
				entering_state = function(self)
				end,
			},
			flying = {
				tags = { 'e.f' },
				on = {
					['land'] = '/waiting',
					['reset_to_waiting'] = '/waiting',
				},
				entering_state = function(self)
				end,
			},
		},
	})
end

local function define_enemy_behaviour_trees()
	for i = 1, #enemy_kinds do
		local kind = enemy_kinds[i]
		local enemy_module = enemy_modules[kind]
		local bt_id = string.format('%s.%s', constants.ids.enemy_bt, kind)
		enemy_module.register_behaviour_tree(bt_id)
	end
end

local function register_enemy_definitions()
	for i = 1, #enemy_kinds do
		enemy_modules[enemy_kinds[i]].register_enemy_definition()
	end
end

local function register_enemy_service_definition()
	define_service({
		def_id = constants.ids.enemy_service_def,
		class = enemy_service,
		fsms = { constants.ids.enemy_service_fsm },
		auto_activate = true,
		defaults = {
			id = constants.ids.enemy_service_instance,
			enemies_by_id = {},
			destroyed_enemy_ids = {},
			room_conditions_by_number = {},
			tick_enabled = false,
		},
	})
end

return {
	enemy_service = enemy_service,
	define_enemy_fsm = define_enemy_fsm,
	define_enemy_behaviour_trees = define_enemy_behaviour_trees,
	register_enemy_definitions = register_enemy_definitions,
	define_enemy_service_fsm = define_enemy_service_fsm,
	register_enemy_service_definition = register_enemy_service_definition,
	enemy_service_def_id = constants.ids.enemy_service_def,
	enemy_service_instance_id = constants.ids.enemy_service_instance,
	enemy_service_fsm_id = constants.ids.enemy_service_fsm,
}
