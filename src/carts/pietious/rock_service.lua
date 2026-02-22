
local rock_service = {}
rock_service.__index = rock_service

function rock_service:sync_rock_instance(rock_def, room)
	local id = rock_def.id
	local instance = object(id)
	if instance == nil then
		instance = inst(self.rock_def_id, {
			id = id,
			space_id = room.space_id,
			pos = { x = rock_def.x, y = rock_def.y, z = 140 },
		})
	end
	instance.space_id = room.space_id

	self.rocks_by_id[id] = instance
	if not instance.active then
		instance:activate()
	end
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
		if not active_ids[id] then
			instance.visible = false
			if instance.active then
				instance:deactivate()
			end
		end
		::continue::
	end
end

function rock_service:sync_room_rocks()
	local room = service('c').current_room
	if self.synced_room_number == room.room_number and not self.sync_dirty then
		return
	end

	self.synced_room_number = room.room_number
	self.sync_dirty = false

	local rock_defs = room.rocks
	local active_ids = {}

	for i = 1, #rock_defs do
		local def = rock_defs[i]
		if not self.destroyed_rock_ids[def.id] then
			self:sync_rock_instance(def, room)
			active_ids[def.id] = true
		end
	end

	self:deactivate_unused_rocks(active_ids)
end

function rock_service:on_rock_break_started(rock_id, room_number, item_type, x, y)
	if self.destroyed_rock_ids[rock_id] then
		return
	end
	self.destroyed_rock_ids[rock_id] = true
	service('i'):add_item_drop_from_rock(rock_id, room_number, item_type, x, y)
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
	self.events:on({
		event = 'room.switched',
		emitter = 'pietolon',
		subscriber = self,
		handler = function(_event)
			self.synced_room_number = 0
			self.sync_dirty = true
			self:sync_room_rocks()
		end,
	})
end

function rock_service:ctor()
	self.rocks_by_id = {}
	self.destroyed_rock_ids = {}
	self.synced_room_number = 0
	self.sync_dirty = true
	self:bind_events()
	self:sync_room_rocks()
end

local function define_rock_service_fsm()
	define_fsm('rock_service.fsm', {
		initial = 'active',
		states = {
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
		def_id = 'rock_service',
		class = rock_service,
		fsms = { 'rock_service.fsm' },
		auto_activate = true,
		defaults = {
			id = 'r',
				rock_def_id = 'rock',
			rocks_by_id = {},
			destroyed_rock_ids = {},
			synced_room_number = 0,
			sync_dirty = true,
			tick_enabled = true,
		},
	})
end

return {
	rock_service = rock_service,
	define_rock_service_fsm = define_rock_service_fsm,
	register_rock_service_definition = register_rock_service_definition,
}
