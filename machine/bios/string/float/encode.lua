local positive_infinity<const> = 1 / 0
local negative_infinity<const> = -1 / 0
local f32_mantissa_bits<const> = 23
local f32_exponent_bits<const> = 8
local f32_byte_count<const> = 4
local f64_mantissa_bits<const> = 52
local f64_exponent_bits<const> = 11

return function(value, byte_count)
	local mantissa_bits<const> = byte_count == f32_byte_count and f32_mantissa_bits or f64_mantissa_bits
	local exponent_bits<const> = byte_count == f32_byte_count and f32_exponent_bits or f64_exponent_bits
	local sign = 0
	if value < 0 then
		sign = 1
		value = -value
	end
	local exponent_max<const> = (2 ^ exponent_bits) - 1
	local exponent_bias<const> = (2 ^ (exponent_bits - 1)) - 1
	local mantissa_scale<const> = 2 ^ mantissa_bits
	local exponent = 0
	local mantissa = 0
	if value ~= value then
		exponent = exponent_max
		mantissa = 1
	elseif value == positive_infinity or value == negative_infinity then
		exponent = exponent_max
	elseif value ~= 0 then
		while value >= 2 do
			value = value / 2
			exponent = exponent + 1
		end
		while value < 1 do
			value = value * 2
			exponent = exponent - 1
		end
		exponent = exponent + exponent_bias
		if exponent <= 0 then
			mantissa = ((value / (2 ^ (1 - exponent - exponent_bias))) * mantissa_scale + 0.5) // 1
			exponent = 0
		elseif exponent >= exponent_max then
			mantissa = 0
			exponent = exponent_max
		else
			mantissa = ((value - 1) * mantissa_scale + 0.5) // 1
			if mantissa >= mantissa_scale then
				mantissa = 0
				exponent = exponent + 1
			end
		end
	end
	if mantissa_bits == f32_mantissa_bits then
		return sign * (2 ^ 31) + exponent * (2 ^ 23) + mantissa
	end
	return sign * (2 ^ 31) + exponent * (2 ^ 20) + (mantissa // (2 ^ 32)), mantissa % (2 ^ 32)
end
