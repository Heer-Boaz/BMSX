local component_types<const> = require('cartlib/components/types')
local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local visualcomponent<const> = require('cartlib/render/visual_component')

local surfacecomponent<const> = {}
surfacecomponent.__index = surfacecomponent
setmetatable(surfacecomponent, { __index = visualcomponent })

function surfacecomponent.new(opts)
	local self<const> = setmetatable(visualcomponent.new(opts, component_types.surface), surfacecomponent)
	self.color = opts.color or 0xffffffff
	self:set_imgid(opts.imgid)
	return self
end

function surfacecomponent:set_imgid(imgid)
	self.imgid = imgid
	if imgid then
		self.image = image.resolve(imgid)
	else
		self.image = nil
	end
end

function surfacecomponent:draw(draw)
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

return surfacecomponent
