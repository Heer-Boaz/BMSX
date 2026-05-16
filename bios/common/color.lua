local color<const> = {}

function color.rgba8888(rgba)
	local r<const> = ((rgba.r * 255) // 1) & 0xff
	local g<const> = ((rgba.g * 255) // 1) & 0xff
	local b<const> = ((rgba.b * 255) // 1) & 0xff
	local a<const> = ((rgba.a * 255) // 1) & 0xff
	return ((a << 24) | (r << 16) | (g << 8) | b) & 0xffffffff
end

return color
