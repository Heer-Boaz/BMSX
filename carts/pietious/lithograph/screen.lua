-- lithograph_screen.lua
-- lithograph screen overlay — displays collected lithograph text.
--
-- SELF-MANAGING SUBSCRIBER PATTERN:
-- Uses an FSM with root `on` handlers (not bind()) for event subscriptions:
--   'lithograph' (from 'd') — rebuilds the retained text_component layout.
--   'room'       (from 'd') — clears that retained layout on mode change.
-- Same pattern as shrine.lua, just expressed via FSM `on` block instead
-- of bind().  Both approaches are equivalent — FSM `on` is preferred when
-- the object already has an FSM.

local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_component<const> = require('cartlib/component/sprite_component')
local text_component<const> = require('cartlib/text/text_component')
require('constants')
local font_module<const> = require('cartlib/font')

local lithograph_screen<const> = {}
lithograph_screen.__index = lithograph_screen

function lithograph_screen:ctor()
	self:add_component(sprite_component.new({
		imgid = 'lithograph_mode',
		offset_x = room_tile_size4,
		offset_y = room_tile_origin_y + room_tile_size2,
	}))
	local text<const> = self:get_component(text_component)
	text:set_font(font_module.get('pietious'))
	text.color = 0xffffffff
	text.background_color = 0xff000000
	text.offset_y = room_tile_origin_y + (room_tile_size * 6)
	text:set_offset_z(1)
	text.center_block_width = screen_width
	self.text_component = text
end

local define_lithograph_screen_fsm<const> = function()
	fsm_library.register('lithograph_screen', {
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
	prefab.define({
		def_id = 'lithograph_screen',
		class = lithograph_screen,
		components = {
			text_component.new,
			fsm_component.factory({ 'lithograph_screen' }),
		},
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
