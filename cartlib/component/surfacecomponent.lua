local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local visual_component<const> = require('cartlib/component/visualcomponent')

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
		self.image = image.resolve(imgid)
	else
		self.image = nil
	end
end

function surface_component:draw(draw)
	local source<const> = self.image
	if not source then
		return
	end
	local parent<const> = self.parent
	local x<const> = parent.x + self.offset_x + self.draw_offset_x
	local y<const> = parent.y + self.offset_y + self.draw_offset_y
	local tiles<const> = source.tiles
	for index = 1, #tiles do
		local tile<const> = tiles[index]
		image.draw(draw, tile, x + tile.x, y + tile.y, self.color, 0, gp0.draw_mode_blend_half)
	end
end

return surface_component
