local color<const> = {}

function color.with_alpha(argb, a)
	local ab<const> = ((a * 255 + 0.5) // 1) & 0xff
	return ((ab << 24) | (argb & 0x00ffffff)) & 0xffffffff
end

function color.alpha(argb)
	return ((argb >> 24) & 0xff) / 255
end

function color.mix_rgb_with_alpha(from, to, mix, a)
	local inverse<const> = 255 - mix
	local ab<const> = ((a * 255 + 0.5) // 1) & 0xff
	local rb<const> = (((((from >> 16) & 0xff) * inverse) + (((to >> 16) & 0xff) * mix) + 127) // 255) & 0xff
	local gb<const> = (((((from >> 8) & 0xff) * inverse) + (((to >> 8) & 0xff) * mix) + 127) // 255) & 0xff
	local bb<const> = ((((from & 0xff) * inverse) + ((to & 0xff) * mix) + 127) // 255) & 0xff
	return ((ab << 24) | (rb << 16) | (gb << 8) | bb) & 0xffffffff
end

return color
