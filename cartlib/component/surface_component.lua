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
		local source<const> = image.resolve(imgid)
		self._tiles = source._tiles
		self.source_width = source.width
		self.source_height = source.height
		self:set_draw_function(surface_component.draw_visual)
	else
		self._tiles = nil
		self.source_width = 0
		self.source_height = 0
		self:set_draw_function(nil)
	end
end

function surface_component:edit_bounds()
	local left<const> = self.offset_x + self.draw_offset_x
	local top<const> = self.offset_y + self.draw_offset_y
	return left, top, left + self.source_width, top + self.source_height
end

function surface_component:draw_visual(draw)
	local parent<const> = self.parent
	local x<const> = parent.x + self.offset_x + self.draw_offset_x
	local y<const> = parent.y + self.offset_y + self.draw_offset_y
	command_list.blit_offset_span(draw, self._tiles, x, y, self.color)
end

return surface_component
