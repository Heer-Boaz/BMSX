local constants = require('constants.lua')
local eventemitter = require('eventemitter')

local item_screen = {}
item_screen.__index = item_screen

local ITEM_OFFSET_X = 11
local ITEM_OFFSET_Y = 6
local SELECTOR_BLINK_FRAMES = 5
local MAP_TITLE_X = 49
local MAP_TITLE_Y = 103 + constants.room.hud_height
local MAP_PROXY_ORIGIN_X = 5 * constants.room.tile_size
local MAP_PROXY_ORIGIN_Y = constants.room.hud_height + math.floor(14.5 * constants.room.tile_size)
local MAP_PROXY_STEP_X = constants.room.tile_size
local MAP_PROXY_STEP_Y = math.floor(constants.room.tile_size / 2)

local map_world_proxies = {
	[1] = {
		{ x = 3, y = 2, room_number = 101, is_boss_room = false },
		{ x = 2, y = 2, room_number = 102, is_boss_room = false },
		{ x = 2, y = 1, room_number = 103, is_boss_room = false },
		{ x = 2, y = 0, room_number = 104, is_boss_room = false },
		{ x = 1, y = 2, room_number = 105, is_boss_room = false },
		{ x = 1, y = 3, room_number = 106, is_boss_room = false },
		{ x = 0, y = 3, room_number = 107, is_boss_room = false },
		{ x = 1, y = 4, room_number = 108, is_boss_room = false },
		{ x = 2, y = 4, room_number = 109, is_boss_room = false },
		{ x = 3, y = 4, room_number = 110, is_boss_room = false },
		{ x = 2, y = 5, room_number = 100, is_boss_room = true },
	},
}

local secondary_weapon_order = {
	'pepernoot',
	'spyglass',
}

local inventory_item_order = {
	'keyworld1',
	'spyglass',
	'halo',
	'lamp',
	'schoentjes',
	'greenvase',
	'map_world1',
	'pepernoot',
}

local item_position_offsets = {
	halo = { x = 5, y = 0 },
	keyworld1 = { x = 14, y = 8 },
	map_world1 = { x = 8, y = 8 },
	lamp = { x = 5, y = 2 },
	pepernoot = { x = 3, y = 11 },
	spyglass = { x = 6, y = 11 },
	schoentjes = { x = 3, y = 0 },
	greenvase = { x = 3, y = 2 },
}

local function sprite_for_item_type(item_type)
	local sprite_id = constants.world_item.sprite[item_type]
	if sprite_id == nil then
		error('pietious item_screen invalid item_type=' .. tostring(item_type))
	end
	return sprite_id
end

function item_screen:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_screen()
	end
end

function item_screen:bind_events()
	eventemitter.eventemitter.instance:on({
		event = constants.events.flow_state_changed,
		subscriber = self,
		handler = function(event)
			if event.state ~= 'item' then
				return
			end
			self:reset_for_open()
		end,
	})
end

function item_screen:ctor()
	self:bind_visual()
	self:bind_events()
	self.secondary_weapon_selection_index = 0
	self.selector_hidden = false
	self.selector_blink_counter = 0
	self.map_highlight = true
end

function item_screen:reset_for_open()
	self.selector_hidden = false
	self.selector_blink_counter = 0
	self.map_highlight = true
end

function item_screen:item_position_px(item_type)
	local offset = item_position_offsets[item_type]
	local tx = ITEM_OFFSET_X + offset.x
	local ty = ITEM_OFFSET_Y + offset.y + (constants.room.hud_height / constants.room.tile_size)
	return tx * constants.room.tile_size, ty * constants.room.tile_size
end

function item_screen:draw_inventory_items()
	local player = object(constants.ids.player_instance)
	local room_space = service(constants.ids.castle_service_instance).current_room.space_id
	for i = 1, #inventory_item_order do
		local item_type = inventory_item_order[i]
		if player:has_inventory_item(item_type) then
			if item_type ~= 'map_world1' or room_space == constants.spaces.world then
				local x, y = self:item_position_px(item_type)
				put_sprite(sprite_for_item_type(item_type), x, y, 321)
			end
		end
	end
end

function item_screen:draw_secondary_weapon_selector()
	if self.selector_hidden then
		return
	end
	local x = (14 * constants.room.tile_size) + (self.secondary_weapon_selection_index * (3 * constants.room.tile_size))
	local y = constants.room.hud_height + math.floor(16.5 * constants.room.tile_size) - 1
	put_sprite('f1_selector_white', x, y, 322)
end

function item_screen:draw_map()
	local player = object(constants.ids.player_instance)
	local room = service(constants.ids.castle_service_instance).current_room
	local world_number = room.world_number
	if world_number <= 0 then
		return
	end
	if world_number == 1 and not player:has_inventory_item('map_world1') then
		return
	end

	local map_proxies = map_world_proxies[world_number]
	if map_proxies == nil then
		error('pietious item_screen missing map proxy data for world=' .. tostring(world_number))
	end

	put_sprite('f1_map_title', MAP_TITLE_X, MAP_TITLE_Y, 323)

	for i = 1, #map_proxies do
		local proxy = map_proxies[i]
		local sprite_id = 'room_proxy'
		if self.map_highlight then
			if proxy.room_number == room.room_number then
				sprite_id = 'room_proxy_red'
			elseif proxy.is_boss_room and player:has_inventory_item('lamp') then
				sprite_id = 'room_proxy_blue'
			end
		end
		local proxy_x = MAP_PROXY_ORIGIN_X + (proxy.x * MAP_PROXY_STEP_X)
		local proxy_y = MAP_PROXY_ORIGIN_Y + (proxy.y * MAP_PROXY_STEP_Y)
		put_sprite(sprite_id, proxy_x, proxy_y, 323)
	end
end

function item_screen:tick_selector_blink()
	self.selector_blink_counter = self.selector_blink_counter + 1
	if self.selector_blink_counter >= SELECTOR_BLINK_FRAMES then
		self.selector_blink_counter = 0
		self.selector_hidden = not self.selector_hidden
		self.map_highlight = not self.map_highlight
	end
end

function item_screen:tick_secondary_weapon_selection()
	local player = object(constants.ids.player_instance)
	if action_triggered('right[jp]') then
		for i = self.secondary_weapon_selection_index + 2, #secondary_weapon_order do
			if player:has_inventory_item(secondary_weapon_order[i]) then
				self.secondary_weapon_selection_index = i - 1
				break
			end
		end
	elseif action_triggered('left[jp]') then
		for i = self.secondary_weapon_selection_index, 1, -1 do
			if player:has_inventory_item(secondary_weapon_order[i]) then
				self.secondary_weapon_selection_index = i - 1
				break
			end
		end
	end

	local selected_weapon = secondary_weapon_order[self.secondary_weapon_selection_index + 1]
	if selected_weapon ~= nil and player:has_inventory_item(selected_weapon) then
		player:equip_secondary_weapon(selected_weapon)
	end
end

function item_screen:tick()
	if get_space() ~= constants.spaces.item then
		return
	end
	self:tick_selector_blink()
	self:tick_secondary_weapon_selection()
end

function item_screen:draw_screen()
	put_sprite('f1_screen', 0, constants.room.hud_height, 320)
	self:draw_inventory_items()
	self:draw_secondary_weapon_selector()
	self:draw_map()
end

local function define_item_screen_fsm()
	define_fsm(constants.ids.item_screen_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					return '/active'
				end,
			},
			active = {},
		},
	})
end

local function register_item_screen_definition()
		define_world_object({
			def_id = constants.ids.item_screen_def,
			class = item_screen,
			fsms = { constants.ids.item_screen_fsm },
			components = { 'customvisualcomponent' },
			defaults = {
				space_id = constants.spaces.item,
				secondary_weapon_selection_index = 0,
				selector_hidden = false,
				selector_blink_counter = 0,
				map_highlight = true,
				tick_enabled = true,
			},
		})
end

return {
	item_screen = item_screen,
	define_item_screen_fsm = define_item_screen_fsm,
	register_item_screen_definition = register_item_screen_definition,
	item_screen_def_id = constants.ids.item_screen_def,
	item_screen_instance_id = constants.ids.item_screen_instance,
	item_screen_fsm_id = constants.ids.item_screen_fsm,
}
