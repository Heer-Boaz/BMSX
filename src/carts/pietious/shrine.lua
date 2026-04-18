-- shrine.lua
-- shrine overlay renderer — displays text on the shrine screen.

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

local define_shrine_fsm<const> = function()
	define_fsm('shrine', {
		initial = 'active',
		on = {
			['shrine'] = {
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

local register_shrine_definition<const> = function()
	define_prefab({
		def_id = 'shrine',
		class = shrine,
		fsms = { 'shrine' },
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
	define_shrine_fsm = define_shrine_fsm,
	register_shrine_definition = register_shrine_definition,
	register_room_shrine_definition = register_room_shrine_definition,
}
