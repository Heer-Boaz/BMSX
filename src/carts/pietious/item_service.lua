local constants = require('constants')
local progression = require('progression')
local room_object_pool = require('room_object_pool')
local item_service = {}
item_service.__index = item_service

local function pickup_inventory_item(player, item_type)
	player.inventory_items[item_type] = true
	player.events:emit('pickupitem')
	return true
end

local function pickup_keyworld1(player, _item_type)
	player.health = player.max_health
	player:emit_health_changed()
	player.inventory_items.keyworld1 = true
	player.events:emit('worldkey')
	return true
end

local function pickup_life(player, _item_type)
	local picked = player:collect_loot('life', constants.pickup_item.life_regen)
	if picked then
		player.events:emit('healing')
	end
	return picked
end

local function pickup_ammo(player, _item_type)
	local picked = player:collect_loot('ammo', constants.pickup_item.ammo_regen)
	if picked then
		player.events:emit('pickupitem')
	end
	return picked
end

local pickup_handlers = {
	ammo = pickup_ammo,
	ammofromrock = pickup_ammo,
	life = pickup_life,
	lifefromrock = pickup_life,
	keyworld1 = pickup_keyworld1,
	map_world1 = pickup_inventory_item,
	halo = pickup_inventory_item,
	pepernoot = pickup_inventory_item,
	spyglass = pickup_inventory_item,
	lamp = pickup_inventory_item,
	schoentjes = pickup_inventory_item,
	greenvase = pickup_inventory_item,
}

function item_service:item_should_spawn(item_def, room_number, player)
	local item_type = item_def.item_type
	if item_type == nil then
		return false
	end
	if self.picked_item_ids[item_def.id] then
		return false
	end
	if player.inventory_items[item_type] then
		return false
	end

	return progression.matches(self, item_def.conditions)
end

function item_service:sync_progression_flags(room_number, player)
	local desired_flags = {}
	for item_type, has_item in pairs(player.inventory_items) do
		if has_item then
			desired_flags[item_type] = true
		end
	end
	local room_flags = self.condition_flags_by_room[room_number]
	if room_flags ~= nil then
		for condition, is_set in pairs(room_flags) do
			if is_set then
				desired_flags[condition] = true
			end
		end
	end

	local progression_flags = self.progression_flags
	for key in pairs(progression_flags) do
		if not desired_flags[key] then
			progression.set(self, key, false)
			progression_flags[key] = nil
		end
	end
	for key in pairs(desired_flags) do
		if not progression_flags[key] then
			progression.set(self, key, true)
			progression_flags[key] = true
		end
	end
end

function item_service:refresh_current_room_items()
	local room = object('c').current_room
	local room_number = room.room_number
	self.synced_room_number = room_number

	local player = object('pietolon')
	self:sync_progression_flags(room_number, player)
	self.item_pool:begin_cycle()

	local room_item_defs = room.items
	for i = 1, #room_item_defs do
		local item_def = room_item_defs[i]
		if self:item_should_spawn(item_def, room_number, player) then
			self.item_pool:use(item_def, room)
		end
	end

	local event_defs = self.event_item_defs_by_room[room_number]
	if event_defs ~= nil then
		for _, item_def in pairs(event_defs) do
			if self:item_should_spawn(item_def, room_number, player) then
				self.item_pool:use(item_def, room)
			end
		end
	end

	self.item_pool:end_cycle()
end

function item_service:set_room_condition(room_number, condition)
	local room_flags = self.condition_flags_by_room[room_number]
	if room_flags == nil then
		room_flags = {}
		self.condition_flags_by_room[room_number] = room_flags
	end
	room_flags[condition] = true
end

function item_service:add_item_drop_from_rock(rock_id, room_number, item_type, x, y)
	if item_type == nil then
		return
	end

	local drop_id = string.format('rock_drop_%s', rock_id)
	if self.picked_item_ids[drop_id] then
		return
	end

	local player = object('pietolon')
	if player.inventory_items[item_type] then
		self.picked_item_ids[drop_id] = true
		return
	end

	local event_defs = self.event_item_defs_by_room[room_number]
	if event_defs == nil then
		event_defs = {}
		self.event_item_defs_by_room[room_number] = event_defs
	end
	event_defs[drop_id] = {
		id = drop_id,
		room_number = room_number,
		x = x,
		y = y,
		item_type = item_type,
		conditions = {},
	}

	if self.synced_room_number == room_number then
		self:refresh_current_room_items()
	end
end

function item_service:try_pick_item(item_id, room_number, item_type)
	local player = object('pietolon')
	if player.health <= 0 then
		return false
	end
	if not pickup_handlers[item_type](player, item_type) then
		return false
	end
	self:on_item_picked(item_id, room_number, item_type)
	return true
end

function item_service:on_item_picked(item_id, room_number, _item_type)
	self.picked_item_ids[item_id] = true
	local event_defs = self.event_item_defs_by_room[room_number]
	if event_defs ~= nil then
		event_defs[item_id] = nil
	end
	if self.synced_room_number == room_number then
		self:refresh_current_room_items()
	end
end

function item_service:bind_events()
	self.events:on({
		event = 'room.switched',
		emitter = 'pietolon',
		subscriber = self,
		handler = function(_event)
			self:refresh_current_room_items()
		end,
	})

	self.events:on({
		event = 'enemy.defeated',
		subscriber = self,
		handler = function(event)
			self:set_room_condition(event.room_number, 'defeated_' .. event.kind)
			if event.kind == 'cloud' then
				self:set_room_condition(event.room_number, 'clouddestroyed')
				self:set_room_condition(event.room_number, 'no_clouds')
			end
			if self.synced_room_number == event.room_number then
				self:refresh_current_room_items()
			end
		end,
	})

	self.events:on({
		event = 'room.condition_set',
		subscriber = self,
		handler = function(event)
			self:set_room_condition(event.room_number, event.condition)
			if self.synced_room_number == event.room_number then
				self:refresh_current_room_items()
			end
		end,
	})
end

function item_service:ctor()
	self.items_by_id = {}
	self.active_item_ids_scratch = {}
	self.event_item_defs_by_room = {}
	self.picked_item_ids = {}
	self.condition_flags_by_room = {}
	self.progression_flags = {}
	self.synced_room_number = 0
	self.item_pool = room_object_pool.new({
		instances_by_id = self.items_by_id,
		active_ids = self.active_item_ids_scratch,
		create_instance = function(definition, room_state)
			return inst(self.world_item_def_id, {
				id = definition.id,
				pos = { x = definition.x, y = definition.y, z = 140 },
				item_id = definition.id,
				room_number = room_state.room_number,
				item_type = definition.item_type,
			})
		end,
		sync_instance = function(instance, definition, room_state)
			instance:configure_from_room_def(definition, room_state, self.id)
		end,
	})
	progression.mount(self, progression.compile_program({ rules = {} }))
	self:bind_events()
	self:refresh_current_room_items()
end

local function register_item_service_definition()
	define_prefab({
		def_id = 'item',
		class = item_service,
		defaults = {
			id = 'i',
			world_item_def_id = 'world_item',
			items_by_id = {},
			active_item_ids_scratch = {},
			event_item_defs_by_room = {},
			picked_item_ids = {},
			condition_flags_by_room = {},
			synced_room_number = 0,
		},
	})
end

return {
	item_service = item_service,
	register_item_service_definition = register_item_service_definition,
}
