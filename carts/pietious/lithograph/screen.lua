-- lithograph_screen.lua
-- lithograph screen overlay — displays collected lithograph text.
--
-- SELF-MANAGING SUBSCRIBER PATTERN:
-- Uses an FSM with root `on` handlers (not bind()) for event subscriptions:
--   'lithograph' (from 'd') — rebuilds the retained textcomponent layout.
--   'room'       (from 'd') — clears that retained layout on mode change.
-- Same pattern as shrine.lua, just expressed via FSM `on` block instead
-- of bind().  Both approaches are equivalent — FSM `on` is preferred when
-- the object already has an FSM.

require('constants')
local font_module<const> = require('system/font')

local lithograph_screen<const> = {}
lithograph_screen.__index = lithograph_screen

local lithograph_mode_sprite_id<const> = 'lithograph_mode'

local draw_lithograph_visual<const> = function()
	gx_blit_img_color(lithograph_mode_sprite_id, room_tile_size4, room_tile_origin_y + room_tile_size2, 0xffffffff)
end

function lithograph_screen:ctor()
	local text<const> = self:get_component('textcomponent')
	text:set_font(font_module.get('pietious'))
	text.color = 0xffffffff
	text.offset.y = room_tile_origin_y + (room_tile_size * 6)
	text.offset.z = 1
	text.center_block_width = screen_width
	self.text_component = text
	self:get_component('customvisualcomponent').producer = draw_lithograph_visual
end

local define_lithograph_screen_fsm<const> = function()
	define_fsm('lithograph_screen', {
		initial = 'active',
		on = {
			['lithograph'] = {
				emitter = 'd',
				go = function(self, _state, event)
					self.text_component:set_text(event.lines)
				end,
			},
			['room'] = {
				emitter = 'd',
				go = function(self)
					self.text_component:set_text(nil)
				end,
			},
		},
		states = {
			active = {},
		},
	})
end

local register_lithograph_screen_definition<const> = function()
	define_prefab({
		def_id = 'lithograph_screen',
		class = lithograph_screen,
		fsms = { 'lithograph_screen' },
		components = { 'customvisualcomponent', 'textcomponent' },
		defaults = {
			id = 'lithograph',
		},
	})
end

return {
	lithograph_screen = lithograph_screen,
	define_lithograph_screen_fsm = define_lithograph_screen_fsm,
	register_lithograph_screen_definition = register_lithograph_screen_definition,
}
