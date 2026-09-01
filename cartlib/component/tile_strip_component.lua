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
function tile_strip_component.factory(definition)
	local source<const> = image.resolve(definition.imgid)
	local step_x<const> = definition.step_x
	local step_y<const> = definition.step_y
	local first_tile<const> = definition.first_tile
	local id_local<const> = definition.id_local
	local enabled<const> = definition.enabled
	local offset_x<const> = definition.offset_x or 0
	local offset_y<const> = definition.offset_y or 0
	local offset_z<const> = definition.offset_z or 0
	return function(opts)
		local self<const> = setmetatable(visual_component.new(opts), tile_strip_component)
		self.id_local = id_local
		self._source = source
		self.tile_width = source.width
		self.tile_height = source.height
		self.step_x = step_x
		self.step_y = step_y
		self.first_tile = first_tile
		self.last_tile = first_tile - 1
		self.offset_x = offset_x
		self.offset_y = offset_y
		self.offset_z = offset_z
		if enabled ~= nil then
			self.enabled = enabled
		end
		self:set_draw_function(tile_strip_component.draw_visual)
		return self
	end
end

function tile_strip_component:edit_bounds()
	local first<const> = self.first_tile
	local last<const> = self.last_tile
	if last < first then
		return nil
	end
	local offset_x<const> = self.offset_x + self.draw_offset_x
	local offset_y<const> = self.offset_y + self.draw_offset_y
	local x0<const> = offset_x + first * self.step_x
	local y0<const> = offset_y + first * self.step_y
	local x1<const> = offset_x + last * self.step_x
	local y1<const> = offset_y + last * self.step_y
	local left = x0
	local top = y0
	local right = x1 + self.tile_width
	local bottom = y1 + self.tile_height
	if right < left then
		left, right = right - self.tile_width, left + self.tile_width
	end
	if bottom < top then
		top, bottom = bottom - self.tile_height, top + self.tile_height
	end
	return left, top, right, bottom
end

return tile_strip_component
