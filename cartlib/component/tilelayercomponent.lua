local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local visual_component<const> = require('cartlib/component/visualcomponent')

local tile_layer_component<const> = {}
tile_layer_component.__index = tile_layer_component
setmetatable(tile_layer_component, { __index = visual_component })

function tile_layer_component.new(opts)
	local self<const> = setmetatable(visual_component.new(opts), tile_layer_component)
	self.sources = opts.sources
	self.tile_count = opts.tile_count or 0
	self.columns = opts.columns or 1
	self.tile_size = opts.tile_size or 0
	return self
end

function tile_layer_component:draw(draw)
	local parent<const> = self.parent
	image.draw_tiles(
		draw,
		self.sources,
		self.tile_count,
		self.columns,
		self.tile_size,
		parent.x + self.offset_x + self.draw_offset_x,
		parent.y + self.offset_y + self.draw_offset_y,
		gp0.draw_mode_blend_half)
end

return tile_layer_component
