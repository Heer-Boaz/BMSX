local constants = require('constants')

local shrine = {}
shrine.__index = shrine

local glyph_color = { r = 1, g = 1, b = 1, a = 1 }

function shrine:bind_visual()
	local renderer = self:get_component('customvisualcomponent')
	renderer.producer = function(_ctx)
		self:render()
	end
end

function shrine:ctor()
	self:bind_visual()
end

function shrine:render()
	if get_space() ~= 'shrine' then
		return
	end
	local director_service = service('d')
	if director_service.overlay_mode ~= 'shrine' then
		return
	end
	put_sprite('shrine_inside', 0, constants.room.tile_origin_y, 340)
	local lines = director_service.overlay_text_lines
	for i = 1, #lines do
		put_glyphs(lines[i], constants.shrine.text_x, constants.shrine.text_y + ((i - 1) * constants.room.tile_size), 341, {
			color = glyph_color,
			layer = 'overlay',
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
