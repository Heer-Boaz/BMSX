local image<const> = require('cartlib/gx/image')
local command_list<const> = require('cartlib/gx/command_list')
local visual_2d_component<const> = require('cartlib/component/visual_2d_component')
local affine_batch<const> = require('cartlib/gx/affine_batch')

local surface_component<const> = {}
surface_component.__index = surface_component
setmetatable(surface_component, { __index = visual_2d_component })

function surface_component.new(owner, configuration, id_local)
	local self<const>, input<const> = visual_2d_component.new(owner, configuration, id_local or 'surface')
	setmetatable(self, surface_component)
	self.color = input.color or 0xffffffff
	self:set_imgid(input.imgid)
	return self
end

function surface_component:set_imgid(imgid)
	self.imgid = imgid
	if imgid then
		local source<const> = image.resolve(imgid)
		self._source = source
		self._tiles = source._tiles
		if source._tiles ~= nil then
			self:set_draw_function(surface_component.draw_visual)
		else
			self:set_draw_function(surface_component.draw_image_visual)
		end
	else
		self._source = nil
		self._tiles = nil
		self:set_draw_function(nil)
	end
end

function surface_component:draw_image_visual(draw)
	self:resolve_pose()
	local source<const> = self._source
	if self._translation_only then
		source:draw(draw, self.wox, self.woy, self.color, 0, 0)
	else
		source:draw_affine(draw, self.wox, self.woy,
			self.wxx*source.width, self.wxy*source.width,
			self.wyx*source.height, self.wyy*source.height, 0, self.color, 0)
	end
end

function surface_component:draw_visual(draw)
	self:resolve_pose()
	if self._translation_only then
		command_list.blit_offset_span(draw, self._tiles, self.wox, self.woy, self.color)
	else
		affine_batch.offset_span(draw, self._tiles,
			self.wxx, self.wxy, self.wyx, self.wyy, self.wox, self.woy, self.color)
	end
end

return surface_component
