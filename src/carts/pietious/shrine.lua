-- shrine.lua
-- shrine overlay renderer — displays text on the shrine screen.
--
-- SELF-MANAGING SUBSCRIBER PATTERN:
-- Subscribes to two director broadcasts in bind():
--   'shrine' (from 'd') — sets self.lines from event.lines payload.
--   'room'   (from 'd') — clears self.lines (self-clear on mode change).
-- No separate 'shrine.open' or 'shrine.clear' events exist.  The shrine
-- manages its own state entirely through broadcast subscriptions.
--
-- This is the canonical example of how subsystems should consume mode
-- broadcasts: subscribe in bind(), read payload data from the event, and
-- self-clear when the mode returns to 'room'.

local constants<const> = require('constants')
local font_module<const> = require('font')

local shrine<const> = {}
shrine.__index = shrine

function shrine:bind_visual()
	local renderer<const> = self:get_component('customvisualcomponent')
	renderer.producer = function(_ctx)
		self:render()
	end
end

function shrine:bind()
	self.events:on({
		event = 'shrine',
		emitter = 'd',
		subscriber = self,
		handler = function(event)
			self.lines = event.lines
		end,
	})
	self.events:on({
		event = 'room',
		emitter = 'd',
		subscriber = self,
		handler = function()
			self.lines = {}
		end,
	})
end

function shrine:ctor()
	self.text_font = font_module.get('pietious')
	self.lines = {}
	self:bind_visual()
end

function shrine:render()
	memwrite(
		vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 13),
		sys_vdp_cmd_blit,
		 13,
		0,
		assets.img['shrine_inside'].handle,
		0,
		constants.room.tile_origin_y,
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
	for i = 1, #lines do
		local text_font<const> = self.text_font
		memwrite(
			vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 17),
			sys_vdp_cmd_glyph_run,
			17,
			0,
			lines[i],
			constants.shrine.text_x,
			constants.shrine.text_y + ((i - 1) * constants.room.tile_size),
			341,
			text_font.id,
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

local room_shrine<const> = {}
room_shrine.__index = room_shrine

function room_shrine:ctor()
	self.collider:set_enabled(false)
	self:gfx('shrine')
end

local register_shrine_definition<const> = function()
	define_prefab({
		def_id = 'shrine',
		class = shrine,
		components = { 'customvisualcomponent' },
		defaults = {
			id = 'shrine',
		},
	})
end

local register_room_shrine_definition<const> = function()
	define_prefab({
		def_id = 'room_shrine',
		class = room_shrine,
		type = 'sprite',
		defaults = {
		},
	})
end

return {
	shrine = shrine,
	room_shrine = room_shrine,
	register_shrine_definition = register_shrine_definition,
	register_room_shrine_definition = register_room_shrine_definition,
}
