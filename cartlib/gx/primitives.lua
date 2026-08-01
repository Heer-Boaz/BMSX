local primitives<const> = {}

function primitives.thick_line(x0, y0, x1, y1, thickness)
	local half<const> = thickness * 0.5
	local dx<const> = x1 - x0
	local dy<const> = y1 - y0
	if dx == 0 and dy == 0 then
		return
			x0 - half, y0 - half,
			x0 + half, y0 - half,
			x0 - half, y0 + half,
			x0 + half, y0 + half
	end
	local length<const> = math.sqrt(dx * dx + dy * dy)
	local tangent_x<const> = dx / length
	local tangent_y<const> = dy / length
	local normal_x<const> = -tangent_y
	local normal_y<const> = tangent_x
	return
		x0 - tangent_x * half - normal_x * half,
		y0 - tangent_y * half - normal_y * half,
		x1 + tangent_x * half - normal_x * half,
		y1 + tangent_y * half - normal_y * half,
		x0 - tangent_x * half + normal_x * half,
		y0 - tangent_y * half + normal_y * half,
		x1 + tangent_x * half + normal_x * half,
		y1 + tangent_y * half + normal_y * half
end

return primitives
