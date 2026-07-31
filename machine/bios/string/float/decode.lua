local f32_mantissa_bits<const> = 23
local f32_exponent_bits<const> = 8
local f32_byte_count<const> = 4
local f64_mantissa_bits<const> = 52
local f64_exponent_bits<const> = 11

return function(high, low, byte_count)
	local mantissa_bits<const> = byte_count == f32_byte_count and f32_mantissa_bits or f64_mantissa_bits
	local exponent_bits<const> = byte_count == f32_byte_count and f32_exponent_bits or f64_exponent_bits
	local sign = 1
	if high >= 2 ^ 31 then
		sign = -1
	end
	local exponent
	local mantissa
	if mantissa_bits == f32_mantissa_bits then
		exponent = (high // (2 ^ 23)) % (2 ^ exponent_bits)
		mantissa = high % (2 ^ 23)
	else
		exponent = (high // (2 ^ 20)) % (2 ^ exponent_bits)
		mantissa = (high % (2 ^ 20)) * (2 ^ 32) + low
	end
	local exponent_max<const> = (2 ^ exponent_bits) - 1
	local exponent_bias<const> = (2 ^ (exponent_bits - 1)) - 1
	local mantissa_scale<const> = 2 ^ mantissa_bits
	if exponent == exponent_max then
		if mantissa == 0 then
			return sign / 0
		end
		return 0 / 0
	end
	if exponent == 0 then
		return sign * (mantissa / mantissa_scale) * (2 ^ (1 - exponent_bias))
	end
	return sign * (1 + mantissa / mantissa_scale) * (2 ^ (exponent - exponent_bias))
end
