local constants = require('constants')
local eventemitter = require('eventemitter')
local rock_module = require('rock')

local rock_service = {}
rock_service.__index = rock_service

function rock_service:sync_rock_instance(rock_def, room)
	local id = rock_def.id
	local instance = object(id)
	if instance == nil then
		instance = spawn_object(self.rock_def_id, {
			id = id,
			space_id = room.space_id,
			pos = { x = rock_def.x, y = rock_def.y, z = 140 },
		})
	end

	self.rocks_by_id[id] = instance
	if not instance.active then
		instance:activate()
	end
	instance.space_id = room.space_id
	instance.visible = true
	instance:configure_from_room_def(rock_def, room, self.id)
	return instance
end

function rock_service:deactivate_unused_rocks(active_ids)
	for id, instance in pairs(self.rocks_by_id) do
		local live_instance = object(id)
		if live_instance == nil then
			self.rocks_by_id[id] = nil
			goto continue
		end

		instance = live_instance
		self.rocks_by_id[id] = instance
		if active_ids[id] ~= true then
			instance.visible = false
			if instance.active then
				instance:deactivate()
			end
		end
		::continue::
	end
end

function rock_service:sync_room_rocks()
	local room = service(constants.ids.castle_service_instance).current_room
	if self.synced_room_number == room.room_number and not self.sync_dirty then
		return
	end

	self.synced_room_number = room.room_number
	self.sync_dirty = false

	local rock_defs = room.rocks
	local active_ids = {}

	for i = 1, #rock_defs do
		local def = rock_defs[i]
		if self.destroyed_rock_ids[def.id] ~= true then
			self:sync_rock_instance(def, room)
			active_ids[def.id] = true
		end
	end

	self:deactivate_unused_rocks(active_ids)
end

function rock_service:on_rock_break_started(rock_id, room_number, item_type, x, y)
	if self.destroyed_rock_ids[rock_id] == true then
		return
	end
	self.destroyed_rock_ids[rock_id] = true
	service(self.item_service_id):add_item_drop_from_rock(rock_id, room_number, item_type, x, y)
end

function rock_service:on_rock_destroyed(rock_id)
	self.destroyed_rock_ids[rock_id] = true
	self.rocks_by_id[rock_id] = nil

	local instance = object(rock_id)
	if instance ~= nil then
		instance.visible = false
		if instance.active then
			instance:deactivate()
		end
	end
end

function rock_service:bind_events()
	eventemitter.eventemitter.instance:on({
		event = constants.events.room_switched,
		subscriber = self,
		handler = function(_event)
			self.synced_room_number = 0
			self.sync_dirty = true
			self:sync_room_rocks()
		end,
	})
end

local function define_rock_service_fsm()
	define_fsm(constants.ids.rock_service_fsm, {
		initial = 'boot',
		states = {
			boot = {
					entering_state = function(self)
						self.rocks_by_id = {}
						self.destroyed_rock_ids = {}
						self.synced_room_number = 0
						self.sync_dirty = true
						self:bind_events()
						self:sync_room_rocks()
					return '/active'
				end,
			},
			active = {
				tick = function(self)
					self:sync_room_rocks()
				end,
			},
		},
	})
end

local function register_rock_service_definition()
	define_service({
		def_id = constants.ids.rock_service_def,
		class = rock_service,
		fsms = { constants.ids.rock_service_fsm },
		auto_activate = true,
		defaults = {
			id = constants.ids.rock_service_instance,
			item_service_id = constants.ids.item_service_instance,
			rock_def_id = rock_module.rock_def_id,
			rocks_by_id = {},
			destroyed_rock_ids = {},
			synced_room_number = 0,
			sync_dirty = true,
			registrypersistent = false,
			tick_enabled = true,
		},
	})
end

return {
	rock_service = rock_service,
	define_rock_service_fsm = define_rock_service_fsm,
	register_rock_service_definition = register_rock_service_definition,
	rock_service_def_id = constants.ids.rock_service_def,
	rock_service_instance_id = constants.ids.rock_service_instance,
	rock_service_fsm_id = constants.ids.rock_service_fsm,
}
