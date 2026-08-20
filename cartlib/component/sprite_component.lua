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

function sprite_component.factory(definition)
	local imgid<const> = definition.imgid
	local source<const> = imgid and image.resolve(imgid)
	local id_local<const> = definition.id_local
	local enabled<const> = definition.enabled
	local offset_x<const> = definition.offset_x or 0
	local offset_y<const> = definition.offset_y or 0
	local offset_z<const> = definition.offset_z or 0
	local color<const> = definition.color or 0xffffffff
	local scale_x<const> = definition.scale_x or 1
	local scale_y<const> = definition.scale_y or 1
	return function(opts)
		local self<const> = sprite_component.new(opts)
		self.id_local = id_local
		self.offset_x = offset_x
		self.offset_y = offset_y
		self.offset_z = offset_z
		self.color = color
		self.scale_x = scale_x
		self.scale_y = scale_y
		if enabled ~= nil then
			self.enabled = enabled
		end
		self:_set_resolved_imgid(imgid, source)
		return self
	end
end

-- Resolved images stay inside the visual owner. Animation admission resolves
-- its immutable frame set once and uses this internal binding path; ordinary
-- cart code continues to publish only imgids through set_imgid().
function sprite_component:_set_resolved_imgid(imgid, source)
	self.imgid = imgid
	if source then
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

function sprite_component:set_imgid(imgid)
	if self.imgid == imgid then
		return false
	end
	local source
	if imgid then
		source = image.resolve(imgid)
	end
	return self:_set_resolved_imgid(imgid, source)
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
