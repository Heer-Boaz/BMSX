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

local fsmlibrary<const> = require('cartlib/fsm/library')
local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/prefab')
local customvisualcomponent<const> = require('cartlib/render/custom_visual_component')
local textcomponent<const> = require('cartlib/text/component')
require('constants')
local font_module<const> = require('cartlib/font')

local lithograph_screen<const> = {}
lithograph_screen.__index = lithograph_screen
lithograph_screen.background = image.load('lithograph_mode')

local draw_lithograph_visual<const> = function(parent, draw)
	image.draw(draw, parent.background, room_tile_size4, room_tile_origin_y + room_tile_size2, 0xffffffff, 0, gp0.draw_mode_blend_half)
end

function lithograph_screen:ctor()
	local text<const> = self:get_component('textcomponent')
	text:set_font(font_module.get('pietious'))
	text.color = 0xffffffff
	text.offset_y = room_tile_origin_y + (room_tile_size * 6)
	text.offset_z = 1
	text.center_block_width = screen_width
	self.text_component = text
	self:get_component('customvisualcomponent').producer = draw_lithograph_visual
end

local define_lithograph_screen_fsm<const> = function()
	fsmlibrary.register('lithograph_screen', {
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
		fsms = { 'lithograph_screen' },
		components = { customvisualcomponent.new, textcomponent.new },
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
