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

local room_shrine = {}
room_shrine.__index = room_shrine

function room_shrine:ctor()
	self.collider.enabled = false
	self:gfx('shrine')
end

local function register_shrine_definition()
	define_prefab({
		def_id = 'shrine',
		class = shrine,
		components = { 'customvisualcomponent' },
		defaults = {
			id = 'shrine',
		},
	})
end

local function register_room_shrine_definition()
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
