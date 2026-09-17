local scene_library<const> = require('cartlib/world/scene_library')
local scene<const> = require('scenes/inventory')
local map_widget<const> = require('map_widget')
local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
require('constants')

local item_screen<const> = {}
item_screen.__index = item_screen
local selector_blink_frames<const> = 5
local selector_blink_timeline_id<const> = 'item_screen.blink'

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

local item_screen_mode_exit_events<const> = {
	'room',
	'transition',
	'halo',
	'shrine',
	'lithograph',
	'title',
	'intro',
	'story',
	'epilogue',
	'end_demo',
	'victory_dance',
	'death',
	'seal_dissolution',
	'daemon_appearance',
}

function item_screen:ctor()
	self.presentation = scene_library.instantiate(scene.id, {
		map = { castle = self.castle, player = self.player },
	})
	self.members = self.presentation.members
end

function item_screen:reset_for_open()
	local members<const> = self.members
	members.selector.sprite_component.visible = true
	members.selector.sprite_component.offset_x = self.secondary_weapon_selection_index * 24
	members.map.highlight = true
	local world_number<const> = self.castle.room.world_number
	local inventory<const> = self.player.status.inventory_items
	for i = 1, #inventory_item_order do
		local item_type<const> = inventory_item_order[i]
		members[item_type].visible = inventory[item_type]
			and (item_type ~= 'map_world1' or world_number > 0)
	end
	local show_map<const> = world_number > 0 and (world_number ~= 1 or inventory.map_world1)
	members.map.visible = show_map
	members.map_title.visible = show_map
	self:apply_selected_secondary_weapon()
end

function item_screen:apply_selected_secondary_weapon()
	local player<const> = self.player
	local selected_weapon<const> = secondary_weapon_order[self.secondary_weapon_selection_index + 1]
	if selected_weapon ~= nil and player.status.inventory_items[selected_weapon] then
		player:equip_subweapon(selected_weapon)
	end
end

function item_screen:shift_secondary_weapon_selection(direction)
	local player<const> = self.player
	local previous_index<const> = self.secondary_weapon_selection_index
	local weapon_count<const> = #secondary_weapon_order
	local index = previous_index
	for _ = 1, weapon_count do
		index = index + direction
		if index < 0 then
			index = weapon_count - 1
		elseif index == weapon_count then
			index = 0
		end
		if player.status.inventory_items[secondary_weapon_order[index + 1]] then
			self.secondary_weapon_selection_index = index
			self.members.selector.sprite_component.offset_x = index * 24
			break
		end
	end
	if self.secondary_weapon_selection_index ~= previous_index then
		self.events:emit('select')
	end
	self:apply_selected_secondary_weapon()
end

local define_item_screen_fsm<const> = function()
	local open_on<const> = {
		['item_screen.blink_toggle'] = function(self)
			local selector<const> = self.members.selector.sprite_component
			selector.visible = not selector.visible
			self.members.map.highlight = not self.members.map.highlight
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
	map_widget.register()
	scene.register()
	prefab.define({
		def_id = 'item_screen',
		class = item_screen,
		components = {
			timeline_component.new,
			fsm_component.factory({ 'item_screen' }),
		},
		defaults = {
			player_index = 1,
			secondary_weapon_selection_index = 0,
		},
	})
end

return {
	item_screen = item_screen,
	define_item_screen_fsm = define_item_screen_fsm,
	register_item_screen_definition = register_item_screen_definition,
}
