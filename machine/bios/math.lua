local trig<const> = require('math/trig')
local tointeger<const> = __bmsx_tointeger
local types<const> = require('kernel/value_type')
local time_ms<const>: *word = 0x08010228

local pi<const> = 3.141592653589793238462643383279502884
local half_pi<const> = pi * 0.5
local deg_per_rad<const> = 180.0 / pi
local rad_per_deg<const> = pi / 180.0
local maxinteger<const> = 0x7fffffff
local mininteger<const> = 0x80000000
local huge<const> = 1.0 / 0.0
local nan<const> = 0.0 / 0.0
local ln2<const> = 0.69314718055994530942
local inv_ln2<const> = 1.44269504088896340736
local ln10<const> = 2.30258509299404568402
local sqrt_half<const> = 0.70710678118654752440
local sqrt_two<const> = 1.41421356237309504880
local exp_overflow_limit<const> = 88.72283935546875
local exp_underflow_limit<const> = -103.972076416015625
local two_pow_16<const> = 65536.0

data rng_state: word = 0x12345678

local floor<const> = function(value)
	local rounded<const> = value // 1
	return tointeger(rounded) or rounded
end

local ceil<const> = function(value)
	local integer<const> = tointeger(value)
	if integer ~= nil then return integer end
	local rounded<const> = -((-value) // 1)
	return tointeger(rounded) or rounded
end

local trunc<const> = function(value)
	if value < 0 then return ceil(value) end
	return floor(value)
end

local abs<const> = function(value)
	local tag<const> = blua32.tag(value)
	if tag ~= types.integer_tag and tag ~= types.float_tag then error('number expected.') end
	if value < 0 then return -value end
	if value == 0 and tag == types.float_tag then return 0.0 end
	return value
end

local round<const> = function(value)
	local integer<const> = tointeger(value)
	if integer ~= nil then return integer end
	local rounded = trunc(value)
	local fraction<const> = value - rounded
	if fraction >= 0.5 then rounded = rounded + 1
	elseif fraction <= -0.5 then rounded = rounded - 1 end
	return tointeger(rounded) or rounded
end

local fmod<const> = function(left, right)
	if blua32.tag(left) == types.integer_tag and blua32.tag(right) == types.integer_tag then
		local remainder = left % right
		if remainder ~= 0 and (left < 0) ~= (right < 0) then
			remainder = remainder - right
		end
		return remainder
	end
	local negative<const> = left < 0 or (left == 0 and 1.0 / left < 0)
	left = left + 0.0
	right = right + 0.0
	local remainder<const> = abs(left) % abs(right)
	if negative then return -remainder end
	return remainder
end

local modf<const> = function(value)
	local integer<const> = trunc(value)
	if value == integer then return integer, 0.0 end
	return integer, value - integer
end

local min<const> = function(first, ...)
	if first == nil then
		error('min expects at least one argument.')
	end
	local result = first
	for index = 1, select('#', ...) do
		local value<const> = select(index, ...)
		if value < result then
			result = value
		end
	end
	return result
end

local max<const> = function(first, ...)
	if first == nil then
		error('max expects at least one argument.')
	end
	local result = first
	for index = 1, select('#', ...) do
		local value<const> = select(index, ...)
		if value > result then
			result = value
		end
	end
	return result
end

local deg<const> = function(value)
	return value * deg_per_rad
end

local rad<const> = function(value)
	return value * rad_per_deg
end

local sqrt<const> = function(value)
	if value < 0 then
		return nan
	end
	if value == 0 or value == huge then
		return value * 1.0
	end
	local normalized = value + 0.0
	local scale = 1.0
	while normalized >= 4.0 do
		normalized = normalized * 0.25
		scale = scale * 2.0
	end
	while normalized < 1.0 do
		normalized = normalized * 4.0
		scale = scale * 0.5
	end
	local estimate = normalized
	for _ = 1, 8 do
		estimate = (estimate + (normalized / estimate)) * 0.5
	end
	return estimate * scale
end

local atan_unit<const> = function(value)
	local magnitude<const> = abs(value)
	return (pi * 0.25 * value) + (0.273 * value * (1.0 - magnitude))
end

local atan_one_arg<const> = function(value)
	if value > 1 then
		return half_pi - atan_unit(1 / value)
	end
	if value < -1 then
		return -half_pi - atan_unit(1 / value)
	end
	return atan_unit(value)
end

local atan<const> = function(y, x)
	y = y * 1.0
	if x == nil then
		return atan_one_arg(y)
	end
	x = x * 1.0
	if y ~= y or x ~= x then
		return nan
	end
	if x > 0 then
		return atan_one_arg(y / x)
	end
	if x < 0 then
		if y >= 0 then
			return atan_one_arg(y / x) + pi
		end
		return atan_one_arg(y / x) - pi
	end
	if y > 0 then
		return half_pi
	end
	if y < 0 then
		return -half_pi
	end
	return 0.0
end

local asin<const> = function(value)
	return atan(value, sqrt(1.0 - (value * value)))
end

local acos<const> = function(value)
	return half_pi - asin(value)
end

local exp_series<const> = function(value)
	local term = 1.0
	local sum = 1.0
	for divisor = 1, 16 do
		term = (term * value) / divisor
		sum = sum + term
	end
	return sum
end

local exp_positive<const> = function(value)
	local power = floor((value * inv_ln2) + 0.5)
	local reduced<const> = value - (power * ln2)
	local result = exp_series(reduced)
	while power >= 16 do
		result = result * two_pow_16
		power = power - 16
	end
	while power > 0 do
		result = result * 2.0
		power = power - 1
	end
	return result
end

local exp<const> = function(value)
	if value ~= value then
		return nan
	end
	if value > exp_overflow_limit then
		return huge
	end
	if value < exp_underflow_limit then
		return 0.0
	end
	if value < 0 then
		return 1.0 / exp_positive(-value)
	end
	return exp_positive(value)
end

local log_e<const> = function(value)
	if value < 0 then
		return nan
	end
	if value == 0 then
		return -huge
	end
	if value == huge then
		return huge
	end
	local exponent = 0
	local mantissa = value
	while mantissa >= sqrt_two do
		mantissa = mantissa * 0.5
		exponent = exponent + 1
	end
	while mantissa < sqrt_half do
		mantissa = mantissa * 2.0
		exponent = exponent - 1
	end
	local z<const> = (mantissa - 1.0) / (mantissa + 1.0)
	local z2<const> = z * z
	local term = z
	local sum = term
	for denominator = 3, 31, 2 do
		term = term * z2
		sum = sum + (term / denominator)
	end
	return (2.0 * sum) + (exponent * ln2)
end

local log<const> = function(value, base)
	local natural<const> = log_e(value)
	if base == nil then
		return natural
	end
	if base == 10 then
		return natural / ln10
	end
	if base == 2 then
		return natural / ln2
	end
	return natural / log_e(base)
end

local ult<const> = function(left, right)
	-- XOR rotates the signed ordering into unsigned ordering. The bit operation
	-- admits only Integers and exactly representable integral Floats.
	return (left ~ 0x80000000) < (right ~ 0x80000000)
end

local sign<const> = function(value)
	local tag<const> = blua32.tag(value)
	if tag ~= types.integer_tag and tag ~= types.float_tag then error('number expected.') end
	if value > 0 then
		return 1
	end
	if value < 0 then
		return -1
	end
	return 0
end

-- High word of an unsigned 32-by-32 product. Every partial product and
-- carry fits one word; no Float conversion or wide guest integer is involved.
local multiply_high<const> = function(left, right)
	local left_low<const> = left & 0xffff
	local left_high<const> = left >> 16
	local right_low<const> = right & 0xffff
	local right_high<const> = right >> 16
	local middle<const> = left_high * right_low + ((left_low * right_low) >> 16)
	local upper_middle<const> = left_low * right_high + (middle & 0xffff)
	return left_high * right_high + (middle >> 16) + (upper_middle >> 16)
end

local next_random_word<const> = function()
	local state<const> = *rng_state * 1664525 + 1013904223
	*rng_state = state
	return state
end

local random_number<const> = function(lower, upper)
	if lower == nil then
		return (next_random_word() >> 8) * 0.000000059604644775390625
	end
	local lower_int = 1
	local upper_int
	if upper == nil then
		upper_int = tointeger(lower)
		if upper_int == nil then error('random bound must be an Integer.') end
		if upper_int < 1 then error('random upper bound must be positive.') end
	else
		lower_int = tointeger(lower)
		upper_int = tointeger(upper)
		if lower_int == nil or upper_int == nil then error('random bound must be an Integer.') end
		if upper_int < lower_int then
			error('random upper bound must be greater than or equal to lower bound.')
		end
	end
	local width<const> = upper_int - lower_int + 1
	local state<const> = next_random_word()
	-- A wrapped zero width denotes the complete signed Integer interval.
	if width == 0 then return lower_int + state end
	return lower_int + multiply_high(state, width)
end

local randomseed<const> = function(seed)
	if seed == nil then
		*rng_state = *time_ms
	else
		local integer<const> = tointeger(seed)
		if integer == nil then error('random seed must be an Integer.') end
		*rng_state = integer
	end
	return nil
end

return {
	abs = abs,
	acos = acos,
	asin = asin,
	atan = atan,
	ceil = ceil,
	cos = trig.cos,
	deg = deg,
	exp = exp,
	floor = floor,
	fmod = fmod,
	huge = huge,
	log = log,
	max = max,
	maxinteger = maxinteger,
	min = min,
	mininteger = mininteger,
	modf = modf,
	pi = pi,
	rad = rad,
	random = random_number,
	randomseed = randomseed,
	round = round,
	sign = sign,
	sin = trig.sin,
	sqrt = sqrt,
	tan = trig.tan,
	tointeger = tointeger,
	type = function(value)
		local tag<const> = blua32.tag(value)
		if tag == types.integer_tag then return 'integer' end
		if tag == types.float_tag then return 'float' end
		return nil
	end,
	ult = ult,
}
