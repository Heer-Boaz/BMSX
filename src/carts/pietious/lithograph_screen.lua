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

local constants = require('constants')
local font = require('font')

local lithograph_screen = {}
lithograph_screen.__index = lithograph_screen

local lithograph_mode_sprite_id = 'lithograph_mode'

function lithograph_screen:bind_visual()
	local rc = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_screen()
	end
end

function lithograph_screen:draw_screen()
	put_sprite(lithograph_mode_sprite_id, constants.room.tile_size4, constants.room.tile_origin_y + constants.room.tile_size2, 340)
	local lines = self.lines
	if #lines > 0 then
		put_glyphs(lines, 0, constants.room.tile_origin_y + (constants.room.tile_size * 6), 341, {
			font = self.text_font,
			center_block_width = display_width(),
		})
	end
end

function lithograph_screen:ctor()
	self.text_font = font.get('pietious')
	self.lines = {}
	self:bind_visual()
end

local function define_lithograph_screen_fsm()
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

local function register_lithograph_screen_definition()
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
