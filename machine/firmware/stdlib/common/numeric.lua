local q8_scale<const> = 0x00000100
local signed_q14_scale<const> = 0x00004000
local q16_scale<const> = 0x00010000
local q16_inv_scale<const> = 1.0 / q16_scale

local trunc<const> = function(value)
	if value < 0 then
		return -((-value) // 1)
	end
	return value // 1
end

local q16<const> = function(value)
	return (trunc(value * q16_scale)) & 0xffffffff
end

local encode_signed_q14<const> = function(value)
	local scaled<const> = trunc((value * signed_q14_scale) + (value < 0 and -0.5 or 0.5))
	if scaled < -0x8000 then
		return 0x8000
	end
	if scaled > 0x7fff then
		return 0x7fff
	end
	return scaled & 0xffff
end

local pack_low_high<const> = function(low, high)
	return (low & 0xffff) | ((high & 0xffff) << 16)
end

return {
	q8_scale = q8_scale,
	q16_scale = q16_scale,
	q16_inv_scale = q16_inv_scale,
	trunc = trunc,
	q16 = q16,
	encode_signed_q14 = encode_signed_q14,
	pack_low_high = pack_low_high,
}
