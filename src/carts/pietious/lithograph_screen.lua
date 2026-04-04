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

local constants<const> = require('constants')
local font<const> = require('font')

local lithograph_screen<const> = {}
lithograph_screen.__index = lithograph_screen

local lithograph_mode_sprite_id<const> = 'lithograph_mode'

function lithograph_screen:bind_visual()
	local rc<const> = self:get_component('customvisualcomponent')
	rc.producer = function(_ctx)
		self:draw_screen()
	end
end

function lithograph_screen:draw_screen()
	memwrite(
		vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 13),
		sys_vdp_cmd_blit,
		 13,
		0,
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
	local lines<const> = self.lines
	if #lines > 0 then
		local font<const> = self.text_font
		memwrite(
			vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 17),
			sys_vdp_cmd_glyph_run,
			17,
			0,
			table.concat(lines, '\n'),
			0,
			constants.room.tile_origin_y + (constants.room.tile_size * 6),
			341,
			font.id,
			0,
			0x7fffffff,
			sys_vdp_layer_ui,
			1,
			1,
			1,
			1,
			0,
			0,
			0,
			0,
			0
		)
	end
end

function lithograph_screen:ctor()
	self.text_font = font.get('pietious')
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
