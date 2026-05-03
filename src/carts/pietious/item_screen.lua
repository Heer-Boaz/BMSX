local constants<const> = require('constants')
local castle_map<const> = require('castle/map')

local item_screen<const> = {}
item_screen.__index = item_screen

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

function item_screen:bind_visual()
	local rc<const> = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_screen()
	end
end

function item_screen:ctor()
	self:bind_visual()
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
	local ty<const> = item_offset_y + offset.y + (constants.room.hud_height / constants.room.tile_size)
	return tx * constants.room.tile_size, ty * constants.room.tile_size
end

function item_screen:draw_inventory_items()
	local player<const> = oget('pietolon')
	local world_number<const> = oget('room').world_number
	for i = 1, #inventory_item_order do
		local item_type<const> = inventory_item_order[i]
		if player.inventory_items[item_type] then
			if item_type ~= 'map_world1' or world_number > 0 then
				local x<const>, y<const> = self:item_position_px(item_type)
				vdp_blit_img_color(constants.world_item.sprite[item_type], x, y, 321, sys_vdp_layer_ui, 1, 1, 0, 0xffffffff, 0)
			end
		end
	end
end

function item_screen:draw_secondary_weapon_selector()
	if self.selector_hidden then
		return
	end
	local x<const> = (14 * constants.room.tile_size) + (self.secondary_weapon_selection_index * (3 * constants.room.tile_size))
	local y<const> = constants.room.hud_height + (16 * constants.room.tile_size) + constants.room.tile_half - 1
	vdp_blit_img_color('f1_selector_white', x, y, 322, sys_vdp_layer_ui, 1, 1, 0, 0xffffffff, 0)
end

function item_screen:draw_map()
	local player<const> = oget('pietolon')
	local room<const> = oget('room')
	local world_number<const> = room.world_number
	if world_number <= 0 then
		return
	end
	if world_number == 1 and not player.inventory_items.map_world1 then
		return
	end

	local map_proxies<const> = castle_map.map_world_proxies[world_number]

	vdp_blit_img_color('f1_map_title', map_title_x, 103 + constants.room.hud_height, 323, sys_vdp_layer_ui, 1, 1, 0, 0xffffffff, 0)

	for i = 1, #map_proxies do
		local proxy<const> = map_proxies[i]
		local sprite_id
		if self.map_highlight and proxy.room_number == oget('c').current_room_number then
			sprite_id = 'room_proxy_red'
		elseif self.map_highlight and proxy.is_boss_room and player.inventory_items['lamp'] then
			sprite_id = 'room_proxy_blue'
		else
			sprite_id = 'room_proxy'
		end
		local proxy_x<const> = (5 * constants.room.tile_size) + (proxy.x * constants.room.tile_size)
		local proxy_y<const> = constants.room.hud_height + (14 * constants.room.tile_size) + constants.room.tile_half + (proxy.y * constants.room.tile_half)
		vdp_blit_img_color(sprite_id, proxy_x, proxy_y, 323, sys_vdp_layer_ui, 1, 1, 0, 0xffffffff, 0)
	end
end

function item_screen:apply_selected_secondary_weapon()
	local player<const> = oget('pietolon')
	local selected_weapon<const> = secondary_weapon_order[self.secondary_weapon_selection_index + 1]
	if selected_weapon ~= nil and player.inventory_items[selected_weapon] then
		player:equip_subweapon(selected_weapon)
	end
end

function item_screen:shift_secondary_weapon_selection(direction)
	local player<const> = oget('pietolon')
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

function item_screen:draw_screen()
	vdp_blit_img_color('f1_screen', 0, constants.room.hud_height, 320, sys_vdp_layer_ui, 1, 1, 0, 0xffffffff, 0)
	self:draw_inventory_items()
	self:draw_secondary_weapon_selector()
	self:draw_map()
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
	define_fsm('item_screen', {
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
							markers = {
								{ frame = selector_blink_frames - 1, event = 'item_screen.blink_toggle' },
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
					['right[jp]'] = function(self)
						self:shift_secondary_weapon_selection(1)
					end,
					['left[jp]'] = function(self)
						self:shift_secondary_weapon_selection(-1)
					end,
				},
			},
		},
	})
end

local register_item_screen_definition<const> = function()
	define_prefab({
		def_id = 'item_screen',
		class = item_screen,
		fsms = { 'item_screen' },
		components = { 'customvisualcomponent' },
		defaults = {
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
