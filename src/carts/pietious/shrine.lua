local constants = require('constants')
local font = require('font')

local shrine = {}
shrine.__index = shrine

function shrine:bind_visual()
	local renderer = self:get_component('customvisualcomponent')
	renderer.producer = function(_ctx)
		self:render()
	end
end

function shrine:ctor()
	self.text_font = font.get('pietious')
	self.lines = {}
	self:bind_visual()
end

function shrine:render()
	put_sprite('shrine_inside', 0, constants.room.tile_origin_y, 340)
	local lines = self.lines
	for i = 1, #lines do
		put_glyphs(lines[i], constants.shrine.text_x, constants.shrine.text_y + ((i - 1) * constants.room.tile_size), 341, {
			font = self.text_font,
		})
	end
end

local function define_shrine_fsm()
	define_fsm('shrine.fsm', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_shrine_definition()
	define_prefab({
		def_id = 'shrine.def',
		class = shrine,
		fsms = { 'shrine.fsm' },
		components = { 'customvisualcomponent' },
		defaults = {
			id = 'shrine',
			space_id = 'shrine',
			tick_enabled = false,
		},
	})
end

return {
	shrine = shrine,
	define_shrine_fsm = define_shrine_fsm,
	register_shrine_definition = register_shrine_definition,
}
