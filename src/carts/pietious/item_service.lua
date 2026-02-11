local constants = require('constants.lua')
local eventemitter = require('eventemitter')
local world_item_module = require('world_item.lua')

local item_service = {}
item_service.__index = item_service

local pickup_handlers

local function pickup_inventory_item(player, item_type)
	if player:has_inventory_item(item_type) then
		return false
	end
	player:add_inventory_item(item_type)
	return true
end

local function pickup_keyworld1(player)
	if not pickup_inventory_item(player, 'keyworld1') then
		return false
	end
	player.health = player.max_health
	return true
end

local function pickup_life(player)
	return player:collect_loot('life', constants.pickup_item.life_regen)
end

local function pickup_ammo(player)
	return player:collect_loot('ammo', constants.pickup_item.ammo_regen)
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

local function room_flags_for(self, room_id)
	local room_flags = self.condition_flags_by_room[room_id]
	if room_flags == nil then
		room_flags = {}
		self.condition_flags_by_room[room_id] = room_flags
	end
	return room_flags
end

local function event_item_defs_for(self, room_id)
	local defs = self.event_item_defs_by_room[room_id]
	if defs == nil then
		defs = {}
		self.event_item_defs_by_room[room_id] = defs
	end
	return defs
end

local function condition_matches(condition, player, room_flags)
	if condition == 'not_destroyed' then
		return true
	end

	local inverted = condition:sub(1, 1) == '!'
	local token = condition
	if inverted then
		token = condition:sub(2)
	end

	if token:sub(1, 4) == 'has_' then
		local has_item = player:has_inventory_item(token:sub(5))
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

function item_service:item_should_spawn(item_def, room_id, player)
	if self.picked_item_ids[item_def.id] == true then
		return false
	end
	if player:has_inventory_item(item_def.item_type) then
		return false
	end

	local room_flags = room_flags_for(self, room_id)
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
			instance = spawn_object(self.world_item_def_id, {
				id = id,
				space_id = room.space_id,
				pos = { x = item_def.x, y = item_def.y, z = 140 },
				item_id = item_def.id,
				room_id = room.room_id,
				item_service_id = self.id,
				source_kind = item_def.source_kind,
				item_type = item_def.item_type,
			})
		self.items_by_id[id] = instance
		return instance
	end

	self.items_by_id[id] = instance
	if not instance.active then
		instance:activate()
	end
	instance.space_id = room.space_id
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
	local room = service(self.game_service_id).current_room
	local room_id = room.room_id
	self.synced_room_id = room_id

	local player = object(constants.ids.player_instance)
	local active_ids = {}

	local room_item_defs = room.items
	for i = 1, #room_item_defs do
		local item_def = room_item_defs[i]
		if self:item_should_spawn(item_def, room_id, player) then
			self:sync_item_instance(item_def, room)
			active_ids[item_def.id] = true
		end
	end

	local event_defs = self.event_item_defs_by_room[room_id]
	if event_defs ~= nil then
		for item_id, item_def in pairs(event_defs) do
			if self:item_should_spawn(item_def, room_id, player) then
				self:sync_item_instance(item_def, room)
				active_ids[item_id] = true
			end
		end
	end

	self:deactivate_unused_items(active_ids)
end

function item_service:set_room_condition(room_id, condition)
	room_flags_for(self, room_id)[condition] = true
end

function item_service:add_item_drop_from_rock(rock_id, room_id, item_type, x, y)
	if item_type == 'none' then
		return
	end

	local drop_id = string.format('rock_drop_%s', rock_id)
	if self.picked_item_ids[drop_id] == true then
		return
	end

	local player = object(constants.ids.player_instance)
	if player:has_inventory_item(item_type) then
		self.picked_item_ids[drop_id] = true
		return
	end

	event_item_defs_for(self, room_id)[drop_id] = {
		id = drop_id,
		room_id = room_id,
		x = x,
		y = y,
		item_type = item_type,
		source_kind = 'rock',
		conditions = {},
	}

	if self.synced_room_id == room_id then
		self:refresh_current_room_items()
	end
end

function item_service:apply_pickup_to_player(player, item_type)
	local pickup_handler = pickup_handlers[item_type]
	if pickup_handler == nil then
		error('pietious item_service invalid item_type=' .. tostring(item_type))
	end
	if pickup_handler == pickup_inventory_item then
		return pickup_handler(player, item_type)
	end
	return pickup_handler(player)
end

function item_service:try_pick_item(item_id, room_id, item_type, source_kind)
	local player = object(constants.ids.player_instance)
	if player.health <= 0 then
		return false
	end
	if not self:apply_pickup_to_player(player, item_type) then
		return false
	end
	self:on_item_picked(item_id, room_id, item_type, source_kind)
	return true
end

function item_service:on_item_picked(item_id, room_id, _item_type, _source_kind)
	self.picked_item_ids[item_id] = true
	local event_defs = self.event_item_defs_by_room[room_id]
	if event_defs ~= nil then
		event_defs[item_id] = nil
	end
	if self.synced_room_id == room_id then
		self:refresh_current_room_items()
	end
end

function item_service:bind_events()
	eventemitter.eventemitter.instance:on({
		event = constants.events.room_switched,
		subscriber = self,
		handler = function(_event)
			self:refresh_current_room_items()
		end,
	})

	eventemitter.eventemitter.instance:on({
		event = constants.events.enemy_defeated,
		subscriber = self,
		handler = function(event)
			self:set_room_condition(event.room_id, 'defeated_' .. event.kind)
			if event.kind == 'cloud' then
				self:set_room_condition(event.room_id, 'clouddestroyed')
				self:set_room_condition(event.room_id, 'no_clouds')
			end
			if self.synced_room_id == event.room_id then
				self:refresh_current_room_items()
			end
		end,
	})

	eventemitter.eventemitter.instance:on({
		event = constants.events.room_condition_set,
		subscriber = self,
		handler = function(event)
			self:set_room_condition(event.room_id, event.condition)
			if self.synced_room_id == event.room_id then
				self:refresh_current_room_items()
			end
		end,
	})
end

local function define_item_service_fsm()
	define_fsm(constants.ids.item_service_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.items_by_id = {}
					self.event_item_defs_by_room = {}
					self.picked_item_ids = {}
					self.condition_flags_by_room = {}
					self.synced_room_id = ''
					self:bind_events()
					self:refresh_current_room_items()
					return '/active'
				end,
			},
			active = {},
		},
	})
end

local function register_item_service_definition()
	define_service({
		def_id = constants.ids.item_service_def,
		class = item_service,
		fsms = { constants.ids.item_service_fsm },
		auto_activate = true,
			defaults = {
				id = constants.ids.item_service_instance,
				game_service_id = constants.ids.castle_service_instance,
				world_item_def_id = world_item_module.world_item_def_id,
			items_by_id = {},
			event_item_defs_by_room = {},
			picked_item_ids = {},
			condition_flags_by_room = {},
			synced_room_id = '',
			registrypersistent = false,
			tick_enabled = false,
		},
	})
end

return {
	item_service = item_service,
	define_item_service_fsm = define_item_service_fsm,
	register_item_service_definition = register_item_service_definition,
	item_service_def_id = constants.ids.item_service_def,
	item_service_instance_id = constants.ids.item_service_instance,
	item_service_fsm_id = constants.ids.item_service_fsm,
}
