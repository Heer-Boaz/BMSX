-- Pietsona's transition combines an optional opaque fill and an independently
-- programmed blend pass over the same retained transformed rectangle.
local visual_2d_component<const> = require('cartlib/component/visual_2d_component')
local affine_batch<const> = require('cartlib/gx/affine_batch')

local overlay_component<const> = {}
overlay_component.__index = overlay_component
setmetatable(overlay_component, { __index = visual_2d_component })

function overlay_component.new(owner)
	local self<const>, input<const> = visual_2d_component.new(owner, owner, 'overlay')
	setmetatable(self, overlay_component)
	self.visible = true
	self.width = input.width
	self.height = input.height
	self.color = input.color
	self.blend_color = input.blend_color
	self.blend_mode = input.blend_mode
	self:set_draw_function(overlay_component.draw_visual)
	return self
end

function overlay_component:draw_visual(draw)
	self:resolve_pose()
	local xx<const>, xy<const>, yx<const>, yy<const> = self.wxx, self.wxy, self.wyx, self.wyy
	local x<const>, y<const> = self.wox, self.woy
	if self.color ~= 0 then
		affine_batch.rect(draw, 0, 0, self.width, self.height, xx, xy, yx, yy, x, y, self.color)
	end
	if self.blend_color ~= 0 then
		draw:mode(self.blend_mode)
		affine_batch.semitransparent_rect(draw, 0, 0, self.width, self.height, xx, xy, yx, yy, x, y, self.blend_color)
	end
end

return overlay_component
