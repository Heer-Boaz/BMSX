local constants = require('constants')
local castle_map = require('castle_map')

local item_screen = {}
item_screen.__index = item_screen

local item_offset_x = 11
local item_offset_y = 6
local selector_blink_frames = 5
local map_title_x = 49

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

function item_screen:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_screen()
	end
end

function item_screen:bind_events()
	self.events:on({
		event = 'flow.state_changed',
		emitter = 'f',
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
	local tx = item_offset_x + offset.x
	local ty = item_offset_y + offset.y + (constants.room.hud_height / constants.room.tile_size)
	return tx * constants.room.tile_size, ty * constants.room.tile_size
end

function item_screen:draw_inventory_items()
	local player = object('pietolon')
	local room_space = service('c').current_room.space_id
	for i = 1, #inventory_item_order do
		local item_type = inventory_item_order[i]
		if player.inventory_items[item_type] == true then
			if item_type ~= 'map_world1' or room_space == 'world' then
				local x, y = self:item_position_px(item_type)
				put_sprite(constants.world_item.sprite[item_type], x, y, 321)
			end
		end
	end
end

function item_screen:draw_secondary_weapon_selector()
	if self.selector_hidden then
		return
	end
	local x = (14 * constants.room.tile_size) + (self.secondary_weapon_selection_index * (3 * constants.room.tile_size))
	local y = constants.room.hud_height + (16 * constants.room.tile_size) + constants.room.tile_half - 1
	put_sprite('f1_selector_white', x, y, 322)
end

function item_screen:draw_map()
	local player = object('pietolon')
	local room = service('c').current_room
	local world_number = room.world_number
	if world_number <= 0 then
		return
	end
	if world_number == 1 and not player:has_inventory_item('map_world1') then
		return
	end

	local map_proxies = castle_map.map_world_proxies[world_number]

	put_sprite('f1_map_title', map_title_x, 103 + constants.room.hud_height, 323)

	for i = 1, #map_proxies do
		local proxy = map_proxies[i]
		local sprite_id
		if self.map_highlight and proxy.room_number == room.room_number then
			sprite_id = 'room_proxy_red'
		elseif self.map_highlight and proxy.is_boss_room and player.inventory_items['lamp'] == true then
			sprite_id = 'room_proxy_blue'
		else
			sprite_id = 'room_proxy'
		end
		local proxy_x = (5 * constants.room.tile_size) + (proxy.x * constants.room.tile_size)
		local proxy_y = constants.room.hud_height + (14 * constants.room.tile_size) + constants.room.tile_half + (proxy.y * constants.room.tile_half)
		put_sprite(sprite_id, proxy_x, proxy_y, 323)
	end
end

function item_screen:tick_selector_blink()
	self.selector_blink_counter = self.selector_blink_counter + 1
	if self.selector_blink_counter >= selector_blink_frames then
		self.selector_blink_counter = 0
		self.selector_hidden = not self.selector_hidden
		self.map_highlight = not self.map_highlight
	end
end

function item_screen:tick_secondary_weapon_selection()
	local player = object('pietolon')
	if action_triggered('right[jp]') then
		for i = self.secondary_weapon_selection_index + 2, #secondary_weapon_order do
			if player.inventory_items[secondary_weapon_order[i]] == true then
				self.secondary_weapon_selection_index = i - 1
				break
			end
		end
	elseif action_triggered('left[jp]') then
		for i = self.secondary_weapon_selection_index, 1, -1 do
			if player.inventory_items[secondary_weapon_order[i]] == true then
				self.secondary_weapon_selection_index = i - 1
				break
			end
		end
	end

	local selected_weapon = secondary_weapon_order[self.secondary_weapon_selection_index + 1]
	if selected_weapon ~= nil and player.inventory_items[selected_weapon] == true then
		player:equip_subweapon(selected_weapon)
	end
end

function item_screen:tick()
	if get_space() ~= 'item' then
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
	define_fsm('item_screen.fsm', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_item_screen_definition()
		define_prefab({
			def_id = 'item_screen.def',
			class = item_screen,
			fsms = { 'item_screen.fsm' },
			components = { 'customvisualcomponent' },
			defaults = {
				space_id = 'item',
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
}
