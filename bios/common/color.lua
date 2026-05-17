local color<const> = {}

function color.rgba8888(r, g, b, a)
	local rb<const> = ((r * 255 + 0.5) // 1) & 0xff
	local gb<const> = ((g * 255 + 0.5) // 1) & 0xff
	local bb<const> = ((b * 255 + 0.5) // 1) & 0xff
	local ab<const> = ((a * 255 + 0.5) // 1) & 0xff
	return ((ab << 24) | (rb << 16) | (gb << 8) | bb) & 0xffffffff
end

function color.with_alpha(argb, a)
	local ab<const> = ((a * 255 + 0.5) // 1) & 0xff
	return ((ab << 24) | (argb & 0x00ffffff)) & 0xffffffff
end

function color.alpha(argb)
	return ((argb >> 24) & 0xff) / 255
end

return color
