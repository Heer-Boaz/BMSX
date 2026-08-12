local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
require('constants')
local castle_map<const> = require('castle/map')

local item_screen<const> = {}
item_screen.__index = item_screen
local sources<const> = {
	screen_background = image.resolve('f1_screen'),
	selector = image.resolve('f1_selector_white'),
	map_title = image.resolve('f1_map_title'),
	room_proxy = image.resolve('room_proxy'),
	room_proxy_red = image.resolve('room_proxy_red'),
	room_proxy_blue = image.resolve('room_proxy_blue'),
	items = {},
}
for item_type, id in pairs(world_item_sprite) do
	sources.items[item_type] = image.resolve(id)
end

local item_offset_x<const> = 11
local item_offset_y<const> = 6
local selector_blink_frames<const> = 5
local selector_blink_timeline_id<const> = 'item_screen.blink'
local map_title_x<const> = 49

local secondary_weapon_order<const> = {
	'pepernoot',
	'spyglass',
}

local inventory_item_order<const> = {
	'keyworld1',
	'spyglass',
	'halo',
	'lamp',
	'schoentjes',
	'greenvase',
	'map_world1',
	'pepernoot',
}

local item_position_offsets<const> = {
	halo = { x = 5, y = 0 },
	keyworld1 = { x = 14, y = 8 },
	map_world1 = { x = 8, y = 8 },
	lamp = { x = 5, y = 2 },
	pepernoot = { x = 3, y = 11 },
	spyglass = { x = 6, y = 11 },
	schoentjes = { x = 3, y = 0 },
	greenvase = { x = 3, y = 2 },
}

local item_screen_mode_exit_events<const> = {
	'room',
	'transition',
	'halo',
	'shrine',
	'lithograph',
	'title',
	'story',
	'ending',
	'victory_dance',
	'death',
	'seal_dissolution',
	'daemon_appearance',
}

function item_screen:ctor()
	self:get_component(custom_visual_component).producer = item_screen.draw_screen
	self.secondary_weapon_selection_index = 0
	self.selector_hidden = false
	self.map_highlight = true
end

function item_screen:reset_for_open()
	self.selector_hidden = false
	self.map_highlight = true
	self:apply_selected_secondary_weapon()
end

function item_screen:item_position_px(item_type)
	local offset<const> = item_position_offsets[item_type]
	local tx<const> = item_offset_x + offset.x
	local ty<const> = item_offset_y + offset.y + (room_hud_height / room_tile_size)
	return tx * room_tile_size, ty * room_tile_size
end

function item_screen:draw_inventory_items(draw)
	local player<const> = self.player
	local world_number<const> = self.room.world_number
	for i = 1, #inventory_item_order do
		local item_type<const> = inventory_item_order[i]
		if player.inventory_items[item_type] then
			if item_type ~= 'map_world1' or world_number > 0 then
				local x<const>, y<const> = self:item_position_px(item_type)
				sources.items[item_type]:draw(draw, x, y, 0xffffffff, 0, gp0.draw_mode_blend_half)
			end
		end
	end
end

function item_screen:draw_secondary_weapon_selector(draw)
	if self.selector_hidden then
		return
	end
	local x<const> = (14 * room_tile_size) + (self.secondary_weapon_selection_index * (3 * room_tile_size))
	local y<const> = room_hud_height + (16 * room_tile_size) + room_tile_half - 1
	sources.selector:draw(draw, x, y, 0xffffffff, 0, gp0.draw_mode_blend_half)
end

function item_screen:draw_map(draw)
	local player<const> = self.player
	local room<const> = self.room
	local world_number<const> = room.world_number
	if world_number <= 0 then
		return
	end
	if world_number == 1 and not player.inventory_items.map_world1 then
		return
	end

	local map_proxies<const> = castle_map.map_world_proxies[world_number]

	sources.map_title:draw(draw, map_title_x, 103 + room_hud_height, 0xffffffff, 0, gp0.draw_mode_blend_half)

	for i = 1, #map_proxies do
		local proxy<const> = map_proxies[i]
		local source
		if self.map_highlight and proxy.room_number == self.castle.current_room_number then
			source = sources.room_proxy_red
		elseif self.map_highlight and proxy.is_boss_room and player.inventory_items['lamp'] then
			source = sources.room_proxy_blue
		else
			source = sources.room_proxy
		end
		local proxy_x<const> = (5 * room_tile_size) + (proxy.x * room_tile_size)
		local proxy_y<const> = room_hud_height + (14 * room_tile_size) + room_tile_half + (proxy.y * room_tile_half)
		source:draw(draw, proxy_x, proxy_y, 0xffffffff, 0, gp0.draw_mode_blend_half)
	end
end

function item_screen:apply_selected_secondary_weapon()
	local player<const> = self.player
	local selected_weapon<const> = secondary_weapon_order[self.secondary_weapon_selection_index + 1]
	if selected_weapon ~= nil and player.inventory_items[selected_weapon] then
		player:equip_subweapon(selected_weapon)
	end
end

function item_screen:shift_secondary_weapon_selection(direction)
	local player<const> = self.player
	local previous_index<const> = self.secondary_weapon_selection_index
	if direction > 0 then
		for i = self.secondary_weapon_selection_index + 2, #secondary_weapon_order do
			if player.inventory_items[secondary_weapon_order[i]] then
				self.secondary_weapon_selection_index = i - 1
				break
			end
		end
	elseif direction < 0 then
		for i = self.secondary_weapon_selection_index, 1, -1 do
			if player.inventory_items[secondary_weapon_order[i]] then
				self.secondary_weapon_selection_index = i - 1
				break
			end
		end
	end
	if self.secondary_weapon_selection_index ~= previous_index then
		self.events:emit('select')
	end
	self:apply_selected_secondary_weapon()
end

function item_screen:draw_screen(draw)
	sources.screen_background:draw(draw, 0, room_hud_height, 0xffffffff, 0, gp0.draw_mode_blend_half)
	self:draw_inventory_items(draw)
	self:draw_secondary_weapon_selector(draw)
	self:draw_map(draw)
end

local define_item_screen_fsm<const> = function()
	local open_on<const> = {
		['item_screen.blink_toggle'] = function(self)
			self.selector_hidden = not self.selector_hidden
			self.map_highlight = not self.map_highlight
		end,
	}
	for i = 1, #item_screen_mode_exit_events do
		open_on[item_screen_mode_exit_events[i]] = {
			emitter = 'd',
			go = '/closed',
		}
	end
	fsm_library.register('item_screen', {
		initial = 'closed',
		states = {
			closed = {
				on = {
					['item'] = {
						emitter = 'd',
						go = '/open',
					},
				},
			},
			open = {
				entering_state = item_screen.reset_for_open,
				timelines = {
					[selector_blink_timeline_id] = {
						def = {
							frames = timeline.range(selector_blink_frames),
							playback_mode = 'loop',
							tracks = {
								{
									kind = 'event',
									keys = {
										{ frame = selector_blink_frames - 1, event = 'item_screen.blink_toggle', direction = 'forward' },
									},
								},
							},
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = true,
							snap_to_start = true,
						},
					},
				},
				on = open_on,
				input_event_handlers = {
					{
						pattern = 'right[jp]',
						go = function(self)
							self:shift_secondary_weapon_selection(1)
						end,
					},
					{
						pattern = 'left[jp]',
						go = function(self)
							self:shift_secondary_weapon_selection(-1)
						end,
					},
				},
			},
		},
	})
end

local register_item_screen_definition<const> = function()
	prefab.define({
		def_id = 'item_screen',
		class = item_screen,
		components = {
			custom_visual_component.new,
			timeline_component.new,
			fsm_component.factory({ 'item_screen' }),
		},
		defaults = {
			player_index = 1,
			secondary_weapon_selection_index = 0,
			selector_hidden = false,
			map_highlight = true,
		},
	})
end

return {
	item_screen = item_screen,
	define_item_screen_fsm = define_item_screen_fsm,
	register_item_screen_definition = register_item_screen_definition,
}
