local positive_infinity<const> = 1 / 0
local negative_infinity<const> = -1 / 0

local f32_mantissa_bits<const> = 23
local f32_exponent_bits<const> = 8
local f64_mantissa_bits<const> = 52
local f64_exponent_bits<const> = 11

local encode_float<const> = function(value, mantissa_bits, exponent_bits)
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
		return sign * (2 ^ 31) + exponent * (2 ^ 23) + mantissa, 0
	end
	return sign * (2 ^ 31) + exponent * (2 ^ 20) + (mantissa // (2 ^ 32)), mantissa % (2 ^ 32)
end

local decode_float<const> = function(high, low, mantissa_bits, exponent_bits)
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

local f32_to_u32<const> = function(value)
	local bits<const> = encode_float(value, f32_mantissa_bits, f32_exponent_bits)
	return bits
end

local f64_to_u32s<const> = function(value)
	return encode_float(value, f64_mantissa_bits, f64_exponent_bits)
end

local u32_to_f32<const> = function(bits)
	return decode_float(bits, 0, f32_mantissa_bits, f32_exponent_bits)
end

local u32s_to_f64<const> = function(high, low)
	return decode_float(high, low, f64_mantissa_bits, f64_exponent_bits)
end

return {
	f32_to_u32 = f32_to_u32,
	f64_to_u32s = f64_to_u32s,
	u32_to_f32 = u32_to_f32,
	u32s_to_f64 = u32s_to_f64,
}
