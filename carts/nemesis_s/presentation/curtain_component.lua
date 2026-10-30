local visual_2d<const> = require('cartlib/component/visual_2d_component')
local affine_batch<const> = require('cartlib/gx/affine_batch')

local curtain_component<const> = {}
curtain_component.__index = curtain_component
setmetatable(curtain_component, { __index = visual_2d })

local draw_blinds<const> = function(self, draw)
	self:resolve_pose()
	local width<const> = self.width
	local xx<const>, xy<const>, yx<const>, yy<const> = self.wxx, self.wxy, self.wyx, self.wyy
	local ox<const>, oy<const> = self.wox, self.woy
	if self.count == 8 then
		affine_batch.rect(draw, 0, 0, width, self.height, xx, xy, yx, yy, ox, oy, 0xff000000)
		return
	end
	for row = 0, self.height - 1, 8 do
		affine_batch.rect(draw, 0, row, width, row + self.count, xx, xy, yx, yy, ox, oy, 0xff000000)
	end
end

local draw_window<const> = function(self, draw)
	self:resolve_pose()
	local xx<const>, xy<const>, yx<const>, yy<const> = self.wxx, self.wxy, self.wyx, self.wyy
	local ox<const>, oy<const> = self.wox, self.woy
	affine_batch.rect(draw, 0, 0, self.width, self.opening_end, xx, xy, yx, yy, ox, oy, 0xff000000)
	affine_batch.rect(draw, 0, self.opening_start, self.width, self.opening_bottom, xx, xy, yx, yy, ox, oy, 0xff000000)
end

function curtain_component:set_mode(mode)
	if mode == 0 then self:set_draw_function(nil)
	elseif mode == 1 then self:set_draw_function(draw_blinds)
	else self:set_draw_function(draw_window) end
end

function curtain_component.new(context)
	local self<const>, input<const> = visual_2d.new(context, 'curtain')
	setmetatable(self, curtain_component)
	self.width, self.height = input.width, input.height
	self.count = input.count or 0
	self.opening_start, self.opening_end, self.opening_bottom = input.opening_start, input.opening_end, input.opening_bottom
	self:set_mode(input.mode or 0)
	return self
end

return curtain_component
