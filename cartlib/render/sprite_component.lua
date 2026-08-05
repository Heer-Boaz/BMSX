local component_types<const> = require('cartlib/components/types')
local gp0<const> = require('cartlib/gx/gp0')
local image<const> = require('cartlib/gx/image')
local visualcomponent<const> = require('cartlib/render/visual_component')

local spritecomponent<const> = {}
spritecomponent.__index = spritecomponent
setmetatable(spritecomponent, { __index = visualcomponent })

function spritecomponent.new(opts)
	local self<const> = setmetatable(visualcomponent.new(opts, component_types.sprite), spritecomponent)
	self.flip_h = false
	self.flip_v = false
	self.color = opts.color or 0xffffffff
	self.scale_x = opts.scale_x or 1
	self.scale_y = opts.scale_y or 1
	self.draw_scale_x = opts.draw_scale_x or 1
	self.draw_scale_y = opts.draw_scale_y or 1
	self:set_imgid(opts.imgid)
	return self
end

function spritecomponent:set_imgid(imgid)
	self.imgid = imgid
	if imgid then
		self.image = image.resolve(imgid)
	else
		self.image = nil
	end
end

function spritecomponent:on_detach()
	if self._collider then
		self._collider:set_sprite(nil)
	end
	if self.parent.sprite_component == self then
		self.parent.sprite_component = nil
	end
end

function spritecomponent:draw(draw)
	local rect<const> = self.image
	if not rect then
		return
	end
	local obj<const> = self.parent
	local x<const> = obj.x + self.offset_x + self.draw_offset_x
	local y<const> = obj.y + self.offset_y + self.draw_offset_y
	local flip_flags = 0
	if self.flip_h then
		flip_flags = flip_flags | 1
	end
	if self.flip_v then
		flip_flags = flip_flags | 2
	end
	local scale_x<const> = self.scale_x * self.draw_scale_x
	local scale_y<const> = self.scale_y * self.draw_scale_y
	if scale_x == 1 and scale_y == 1 then
		image.draw(draw, rect, x, y, self.color, flip_flags, gp0.draw_mode_blend_half)
		return
	end
	image.draw_affine(draw, rect, x, y, rect.w * scale_x, 0.0, 0.0, rect.h * scale_y, flip_flags, self.color, gp0.draw_mode_blend_half)
end

return spritecomponent
