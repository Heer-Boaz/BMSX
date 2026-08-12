local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local visualcomponent<const> = require('cartlib/component/visualcomponent')

local surfacecomponent<const> = {}
surfacecomponent.__index = surfacecomponent
setmetatable(surfacecomponent, { __index = visualcomponent })

function surfacecomponent.new(opts)
	local self<const> = setmetatable(visualcomponent.new(opts), surfacecomponent)
	self.color = opts.color or 0xffffffff
	self:set_imgid(opts.imgid)
	return self
end

function surfacecomponent:set_imgid(imgid)
	self.imgid = imgid
	if imgid then
		self._source = image.resolve(imgid)
	else
		self._source = nil
	end
end

function surfacecomponent:draw(draw)
	local source<const> = self._source
	if not source then
		return
	end
	local parent<const> = self.parent
	local x<const> = parent.x + self.offset_x + self.draw_offset_x
	local y<const> = parent.y + self.offset_y + self.draw_offset_y
	local tiles<const> = source._tiles
	for index = 1, #tiles do
		local tile<const> = tiles[index]
		tile:draw(draw, x + tile.offset_x, y + tile.offset_y, self.color, 0, gp0.draw_mode_blend_half)
	end
end

return surfacecomponent
