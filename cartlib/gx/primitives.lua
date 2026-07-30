local gx_gpu<const> = require('cartlib/gx/gpu')
local sqrt<const> = math.sqrt

local primitives<const> = {}

local draw_thick_line<const> = function(semitransparent, x0, y0, x1, y1, color, thickness)
	local dx<const> = x1 - x0
	local dy<const> = y1 - y0
	local half<const> = thickness * 0.5
	if dx == 0 and dy == 0 then
		if semitransparent then
			gx_gpu.fill_rect_semitrans_color(x0 - half, y0 - half, x0 + half, y0 + half, color)
		else
			gx_gpu.fill_rect_color(x0 - half, y0 - half, x0 + half, y0 + half, color)
		end
		return
	end
	local length<const> = sqrt(dx * dx + dy * dy)
	local tangent_x<const> = dx / length
	local tangent_y<const> = dy / length
	local normal_x<const> = -tangent_y
	local normal_y<const> = tangent_x
	local quad_x0<const> = x0 - tangent_x * half - normal_x * half
	local quad_y0<const> = y0 - tangent_y * half - normal_y * half
	local quad_x1<const> = x1 + tangent_x * half - normal_x * half
	local quad_y1<const> = y1 + tangent_y * half - normal_y * half
	local quad_x2<const> = x0 - tangent_x * half + normal_x * half
	local quad_y2<const> = y0 - tangent_y * half + normal_y * half
	local quad_x3<const> = x1 + tangent_x * half + normal_x * half
	local quad_y3<const> = y1 + tangent_y * half + normal_y * half
	if semitransparent then
		gx_gpu.draw_quad_semitrans_color(quad_x0, quad_y0, quad_x1, quad_y1, quad_x2, quad_y2, quad_x3, quad_y3, color)
	else
		gx_gpu.draw_quad_color(quad_x0, quad_y0, quad_x1, quad_y1, quad_x2, quad_y2, quad_x3, quad_y3, color)
	end
end

function primitives.draw_thick_line_color(x0, y0, x1, y1, color, thickness)
	draw_thick_line(false, x0, y0, x1, y1, color, thickness)
end

function primitives.draw_thick_line_semitrans_color(x0, y0, x1, y1, color, thickness)
	draw_thick_line(true, x0, y0, x1, y1, color, thickness)
end

return primitives
