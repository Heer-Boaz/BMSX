local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local visual_component<const> = require('cartlib/component/visual_component')

local sprite_component<const> = {}
sprite_component.__index = sprite_component
setmetatable(sprite_component, { __index = visual_component })

function sprite_component.new(opts)
	local self<const> = setmetatable(visual_component.new(opts), sprite_component)
	self.flip_h = false
	self.flip_v = false
	self.color = opts.color or 0xffffffff
	self.scale_x = opts.scale_x or 1
	self.scale_y = opts.scale_y or 1
	self.draw_scale_x = opts.draw_scale_x or 1
	self.draw_scale_y = opts.draw_scale_y or 1
	self.imgid = nil
	self._source = nil
	self.source_width = 0
	self.source_height = 0
	self:set_imgid(opts.imgid)
	return self
end

function sprite_component:set_imgid(imgid)
	if self.imgid == imgid then
		return false
	end
	self.imgid = imgid
	if imgid then
		local source<const> = image.resolve(imgid)
		self._source = source
		self.source_width = source.width
		self.source_height = source.height
		self:set_draw_function(sprite_component.draw_visual)
	else
		self._source = nil
		self.source_width = 0
		self.source_height = 0
		self:set_draw_function(nil)
	end
	return true
end

function sprite_component:on_detach()
	if self._collider then
		self._collider:set_sprite(nil)
	end
	if self.parent.sprite_component == self then
		self.parent.sprite_component = nil
	end
end

function sprite_component:draw_visual(draw)
	local source<const> = self._source
	local obj<const> = self.parent
	local x<const> = obj.x + self.offset_x + self.draw_offset_x
	local y<const> = obj.y + self.offset_y + self.draw_offset_y
	local scale_x<const> = self.scale_x * self.draw_scale_x
	local scale_y<const> = self.scale_y * self.draw_scale_y
	local color<const> = self.color
	local unit_scale<const> = scale_x == 1 and scale_y == 1
	if unit_scale
	and not self.flip_h and not self.flip_v
	and (color & 0x00ffffff) == 0x00ffffff then
		source:blit(draw, x, y)
		return
	end
	local flip_flags<const> = (self.flip_h and 1 or 0) | (self.flip_v and 2 or 0)
	if unit_scale then
		source:draw(draw, x, y, color, flip_flags, gp0.draw_mode_blend_half)
		return
	end
	source:draw_affine(
		draw,
		x, y,
		self.source_width * scale_x, 0.0,
		0.0, self.source_height * scale_y,
		flip_flags,
		color,
		gp0.draw_mode_blend_half)
end

return sprite_component
