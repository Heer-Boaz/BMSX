local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local primitives<const> = require('cartlib/gx/primitives')
local gp0<const> = require('cartlib/gx/gp0')

local slash_component<const> = {}
slash_component.__index = slash_component
setmetatable(slash_component, { __index = custom_visual_component })

function slash_component.new(owner)
	local self<const> = custom_visual_component.new(owner, owner, 'slash')
	setmetatable(self, slash_component)
	self.monster = owner.monster
	self.slash_active = false
	self.slash_x0, self.slash_y0, self.slash_x1, self.slash_y1 = 0, 0, 0, 0
	self.slash_thickness = 0
	self.slash_color = 0xffffffff
	self:set_draw_function(slash_component.draw_visual)
	return self
end

function slash_component:draw_visual(draw)
	if not self.slash_active then return end
	draw:mode(gp0.draw_mode_blend_half)
	local x0<const>, y0<const>, x1<const>, y1<const>, x2<const>, y2<const>, x3<const>, y3<const> =
		primitives.thick_line(self.slash_x0, self.slash_y0, self.slash_x1, self.slash_y1, self.slash_thickness)
	-- Slash geometry is authored in the struck image's local coordinates. The
	-- actual retained visual supplies placement, including any Scene hierarchy
	-- and the current squash/depth sample; no copied actor coordinates exist.
	local pose<const> = self.monster:resolve_pose()
	local xx<const>, xy<const>, yx<const>, yy<const> = pose.wxx, pose.wxy, pose.wyx, pose.wyy
	local ox<const>, oy<const> = pose.wox, pose.woy
	draw:semitransparent_quad(
		ox + xx*x0 + yx*y0, oy + xy*x0 + yy*y0,
		ox + xx*x1 + yx*y1, oy + xy*x1 + yy*y1,
		ox + xx*x2 + yx*y2, oy + xy*x2 + yy*y2,
		ox + xx*x3 + yx*y3, oy + xy*x3 + yy*y3, self.slash_color)
end

return slash_component
