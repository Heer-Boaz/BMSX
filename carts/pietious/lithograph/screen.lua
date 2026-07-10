-- lithograph_screen.lua
-- lithograph screen overlay — displays collected lithograph text.
--
-- SELF-MANAGING SUBSCRIBER PATTERN:
-- Uses an FSM with root `on` handlers (not bind()) for event subscriptions:
--   'lithograph' (from 'd') — sets self.lines from event.lines payload.
--   'room'       (from 'd') — clears self.lines (self-clear on mode change).
-- Same pattern as shrine.lua, just expressed via FSM `on` block instead
-- of bind().  Both approaches are equivalent — FSM `on` is preferred when
-- the object already has an FSM.

require('constants')
local font_module<const> = require('cartlib/font')

local draw_glyph_line_color<const> = function(font, line, x, y, color)
	local cursor_x = x
	font_module.for_each_glyph(font, line, function(glyph)
		gx_blit_img_color(glyph.imgid, cursor_x, y, color)
		cursor_x = cursor_x + glyph.advance
	end)
end

local lithograph_screen<const> = {}
lithograph_screen.__index = lithograph_screen

local lithograph_mode_sprite_id<const> = 'lithograph_mode'

function lithograph_screen:bind_visual()
	local rc<const> = self:get_component('customvisualcomponent')
	rc.producer = function()
		self:draw_screen()
	end
end

function lithograph_screen:draw_screen()
	gx_blit_img_color(lithograph_mode_sprite_id, room_tile_size4, room_tile_origin_y + room_tile_size2, 0xffffffff)
	local lines<const> = self.lines
	if #lines > 0 then
		local text_font<const> = self.text_font
		local base_y<const> = room_tile_origin_y + (room_tile_size * 6)
		for i = 1, #lines do
			local line<const> = lines[i]
			if string.len(line) > 0 then
				draw_glyph_line_color(text_font, line, (screen_width - font_module.measure_line_width(text_font, line)) // 2, base_y + ((i - 1) * text_font.line_height), 0xffffffff)
			end
		end
	end
end

function lithograph_screen:ctor()
	self.text_font = font_module.get('pietious')
	self.lines = {}
	self:bind_visual()
end

local define_lithograph_screen_fsm<const> = function()
	define_fsm('lithograph_screen', {
		initial = 'active',
		on = {
			['lithograph'] = {
				emitter = 'd',
				go = function(self, _state, event)
					self.lines = event.lines
				end,
			},
			['room'] = {
				emitter = 'd',
				go = function(self)
					self.lines = {}
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
		components = { 'customvisualcomponent' },
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
