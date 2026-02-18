local constants = require('constants')
local item_service = {}
item_service.__index = item_service

local pickup_handlers

local function pickup_inventory_item(player, item_type)
	player.inventory_items[item_type] = true
	player.events:emit('evt.cue.pickupitem', {})
	return true
end

local function pickup_keyworld1(player)
	player.health = player.max_health
	player.inventory_items.keyworld1 = true
	player.events:emit('evt.cue.worldkey', {})
	return true
end

local function pickup_life(player)
	local picked = player:collect_loot('life', constants.pickup_item.life_regen)
	if picked then
		player.events:emit('evt.cue.healing', {})
	end
	return picked
end

local function pickup_ammo(player)
	local picked = player:collect_loot('ammo', constants.pickup_item.ammo_regen)
	if picked then
		player.events:emit('evt.cue.pickupitem', {})
	end
	return picked
end

pickup_handlers = {
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

local function room_flags_for(self, room_number)
	local room_flags = self.condition_flags_by_room[room_number]
	if room_flags == nil then
		room_flags = {}
		self.condition_flags_by_room[room_number] = room_flags
	end
	return room_flags
end

local function event_item_defs_for(self, room_number)
	local defs = self.event_item_defs_by_room[room_number]
	if defs == nil then
		defs = {}
		self.event_item_defs_by_room[room_number] = defs
	end
	return defs
end

local function condition_matches(condition, player, room_flags)
	if condition == 'not_destroyed' then
		return true
	end

	local inverted = condition:sub(1, 1) == '!'
	local token = inverted and condition:sub(2) or condition

	if token:sub(1, 4) == 'has_' then
		local has_item = player.inventory_items[token:sub(5)] == true
		if inverted then
			return not has_item
		end
		return has_item
	end

	local flag_is_set = room_flags[token] == true
	if inverted then
		return not flag_is_set
	end
	return flag_is_set
end

function item_service:item_should_spawn(item_def, room_number, player)
	if item_def.item_def == nil then return false end -- Don't spawn items that are not there (e.g. empty stone)
	if self.picked_item_ids[item_def.id] == true then
		return false
	end
	if player.inventory_items[item_def.item_type] == true then
		return false
	end

	local room_flags = room_flags_for(self, room_number)
	local conditions = item_def.conditions
	for i = 1, #conditions do
		if not condition_matches(conditions[i], player, room_flags) then
			return false
		end
	end
	return true
end

function item_service:sync_item_instance(item_def, room)
	local id = item_def.id
	local instance = object(id)
	if instance == nil then
		instance = inst(self.world_item_def_id, {
			id = id,
			space_id = room.space_id,
			pos = { x = item_def.x, y = item_def.y, z = 140 },
			item_id = item_def.id,
			room_number = room.room_number,
			item_type = item_def.item_type,
		})
		self.items_by_id[id] = instance
		return instance
	end
	instance.space_id = room.space_id

	self.items_by_id[id] = instance
	if not instance.active then
		instance:activate()
	end
	instance.visible = true
	instance:configure_from_room_def(item_def, room, self.id)
	return instance
end

function item_service:deactivate_unused_items(active_ids)
	for id, instance in pairs(self.items_by_id) do
		local live_instance = object(id)
		if live_instance == nil then
			self.items_by_id[id] = nil
			goto continue
		end

		instance = live_instance
		self.items_by_id[id] = instance
		if active_ids[id] ~= true then
			instance.visible = false
			if instance.active then
				instance:deactivate()
			end
		end
		::continue::
	end
end

function item_service:refresh_current_room_items()
	local room = service('c').current_room
	local room_number = room.room_number
	self.synced_room_number = room_number

	local player = object('pietolon')
	local active_ids = {}

	local room_item_defs = room.items
	for i = 1, #room_item_defs do
		local item_def = room_item_defs[i]
		if self:item_should_spawn(item_def, room_number, player) then
			self:sync_item_instance(item_def, room)
			active_ids[item_def.id] = true
		end
	end

	local event_defs = self.event_item_defs_by_room[room_number]
	if event_defs ~= nil then
		for item_id, item_def in pairs(event_defs) do
			if self:item_should_spawn(item_def, room_number, player) then
				self:sync_item_instance(item_def, room)
				active_ids[item_id] = true
			end
		end
	end

	self:deactivate_unused_items(active_ids)
end

function item_service:set_room_condition(room_number, condition)
	room_flags_for(self, room_number)[condition] = true
end

function item_service:add_item_drop_from_rock(rock_id, room_number, item_type, x, y)
	if item_type == nil then
		return
	end

	local drop_id = string.format('rock_drop_%s', rock_id)
	if self.picked_item_ids[drop_id] == true then
		return
	end

	local player = object('pietolon')
	if player.inventory_items[item_type] == true then
		self.picked_item_ids[drop_id] = true
		return
	end

	event_item_defs_for(self, room_number)[drop_id] = {
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

function item_service:apply_pickup_to_player(player, item_type)
	local pickup_handler = pickup_handlers[item_type]
	if pickup_handler == pickup_inventory_item then
		return pickup_handler(player, item_type)
	end
	return pickup_handler(player)
end

function item_service:try_pick_item(item_id, room_number, item_type)
	local player = object('pietolon')
	if player.health <= 0 then
		return false
	end
	if not self:apply_pickup_to_player(player, item_type) then
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
		emitter = 'c',
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
		emitter = 'c',
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
	self.event_item_defs_by_room = {}
	self.picked_item_ids = {}
	self.condition_flags_by_room = {}
	self.synced_room_number = 0
	self:bind_events()
	self:refresh_current_room_items()
end

local function define_item_service_fsm()
	define_fsm('item_service.fsm', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_item_service_definition()
	define_service({
		def_id = 'item_service.def',
		class = item_service,
		fsms = { 'item_service.fsm' },
		auto_activate = true,
		defaults = {
			id = 'i',
				world_item_def_id = 'world_item.def',
			items_by_id = {},
			event_item_defs_by_room = {},
			picked_item_ids = {},
			condition_flags_by_room = {},
			synced_room_number = 0,
			tick_enabled = false,
		},
	})
end

return {
	item_service = item_service,
	define_item_service_fsm = define_item_service_fsm,
	register_item_service_definition = register_item_service_definition,
}
