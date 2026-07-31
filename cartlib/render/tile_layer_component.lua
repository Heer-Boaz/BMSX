local component_types<const> = require('cartlib/components/types')
local gx_image<const> = require('cartlib/gx/image')
local visualcomponent<const> = require('cartlib/render/visual_component')

local tilelayercomponent<const> = {}
tilelayercomponent.__index = tilelayercomponent
setmetatable(tilelayercomponent, { __index = visualcomponent })

function tilelayercomponent.new(opts)
	local self<const> = setmetatable(visualcomponent.new(opts, component_types.tile_layer), tilelayercomponent)
	self.sources = opts.sources
	self.tile_count = opts.tile_count or 0
	self.columns = opts.columns or 1
	self.tile_size = opts.tile_size or 0
	return self
end

function tilelayercomponent:draw()
	local parent<const> = self.parent
	gx_image.tile_run_sources(
		self.sources,
		self.tile_count,
		self.columns,
		self.tile_size,
		parent.x + self.offset_x + self.draw_offset_x,
		parent.y + self.offset_y + self.draw_offset_y)
end

return tilelayercomponent
