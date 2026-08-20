local image<const> = require('cartlib/gx/image')
local visual_component<const> = require('cartlib/component/visual_component')

local tile_strip_component<const> = {}
tile_strip_component.__index = tile_strip_component
setmetatable(tile_strip_component, { __index = visual_component })

function tile_strip_component:draw_visual(draw)
	local owner<const> = self.parent
	local origin_x<const> = owner.x + self.offset_x + self.draw_offset_x
	local origin_y<const> = owner.y + self.offset_y + self.draw_offset_y
	local step_x<const> = self.step_x
	local step_y<const> = self.step_y
	local source<const> = self._source
	local first_tile<const> = self.first_tile
	local x = origin_x + first_tile * step_x
	local y = origin_y + first_tile * step_y
	for _ = first_tile, self.last_tile do
		source:blit(draw, x, y)
		x = x + step_x
		y = y + step_y
	end
end

-- A tile strip is one straight, inclusive range in tile-index space. The
-- visual owns both endpoints; gameplay changes the range without duplicating
-- derived world coordinates or rebuilding draw commands.
function tile_strip_component.factory(imgid, step_x, step_y, first_tile)
	local source<const> = image.resolve(imgid)
	return function(opts)
		local self<const> = setmetatable(visual_component.new(opts), tile_strip_component)
		self._source = source
		self.step_x = step_x
		self.step_y = step_y
		self.first_tile = first_tile
		self.last_tile = first_tile - 1
		self:set_draw_function(tile_strip_component.draw_visual)
		return self
	end
end

return tile_strip_component
