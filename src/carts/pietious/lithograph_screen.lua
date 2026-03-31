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
	write_words(
		sys_vdp_cmd_arg0,
		assets.img[lithograph_mode_sprite_id].handle,
		constants.room.tile_size4,
		constants.room.tile_origin_y + constants.room.tile_size2,
		340,
		sys_vdp_layer_ui,
		1,
		1,
		0,
		1,
		1,
		1,
		1,
		0
	)
	mem[sys_vdp_cmd] = sys_vdp_cmd_blit
	local lines = self.lines
	if #lines > 0 then
		local font = self.text_font
		mem[sys_vdp_cmd_arg0+0*4] = 0
		mem[sys_vdp_cmd_arg0+1*4] = constants.room.tile_origin_y + (constants.room.tile_size * 6)
		mem[sys_vdp_cmd_arg0+2*4] = 341
		mem[sys_vdp_cmd_arg0+3*4] = font.advance_x
		mem[sys_vdp_cmd_arg0+4*4] = font.line_height
		mem[sys_vdp_cmd_arg0+5*4] = display_width()
		mem[sys_vdp_cmd_arg0+6*4] = table.concat(lines, '\n')
		mem[sys_vdp_cmd] = 0x20
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
