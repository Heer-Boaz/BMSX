local image<const> = require('cartlib/gx/image')
local command_list<const> = require('cartlib/gx/command_list')
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
		self._tiles = image.resolve(imgid)._tiles
		self:set_draw_function(surface_component.draw_visual)
	else
		self._tiles = nil
		self:set_draw_function(nil)
	end
end

function surface_component:draw_visual(draw)
	local parent<const> = self.parent
	local x<const> = parent.x + self.offset_x + self.draw_offset_x
	local y<const> = parent.y + self.offset_y + self.draw_offset_y
	command_list.blit_offset_span(draw, self._tiles, x, y, self.color)
end

return surface_component
