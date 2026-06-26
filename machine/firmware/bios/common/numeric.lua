local q8_scale<const> = 0x00000100
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

local pack_low_high<const> = function(low, high)
	return (low & 0xffff) | ((high & 0xffff) << 16)
end

local round_number<const> = function(x)
	if x >= 0 then
		return (x + 0.5) // 1
	end
	return -(((-x) + 0.5) // 1)
end

return {
	q8_scale = q8_scale,
	q16_scale = q16_scale,
	q16_inv_scale = q16_inv_scale,
	trunc = trunc,
	q16 = q16,
	pack_low_high = pack_low_high,
	round_number = round_number,
}
