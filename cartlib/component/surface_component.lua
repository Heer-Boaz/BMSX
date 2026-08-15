local image<const> = require('cartlib/gx/image')
local gp0<const> = require('cartlib/gx/gp0')
local visual_component<const> = require('cartlib/component/visual_component')

local surface_component<const> = {}
surface_component.__index = surface_component
setmetatable(surface_component, { __index = visual_component })

function surface_component.new(opts)
	local self<const> = setmetatable(visual_component.new(opts), surface_component)
	self.color = opts.color or 0xffffffff
	self:set_imgid(opts.imgid)
	return self
end

function surface_component:set_imgid(imgid)
	self.imgid = imgid
	if imgid then
		self._source = image.resolve(imgid)
		self:set_draw_function(surface_component.draw_visual)
	else
		self._source = nil
		self:set_draw_function(nil)
	end
end

function surface_component:draw_visual(draw)
	local source<const> = self._source
	local parent<const> = self.parent
	local x<const> = parent.x + self.offset_x + self.draw_offset_x
	local y<const> = parent.y + self.offset_y + self.draw_offset_y
	local tiles<const> = source._tiles
	local color<const> = self.color
	if (color & 0x00ffffff) == 0x00ffffff then
		for index = 1, #tiles do
			local tile<const> = tiles[index]
			tile:blit(draw, x + tile.offset_x, y + tile.offset_y)
		end
	else
		for index = 1, #tiles do
			local tile<const> = tiles[index]
			tile:draw(
				draw,
				x + tile.offset_x,
				y + tile.offset_y,
				color,
				0,
				gp0.draw_mode_blend_half)
		end
	end
end

return surface_component
