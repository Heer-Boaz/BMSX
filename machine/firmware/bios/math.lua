local numeric<const> = require('bios/common/numeric')
local sincos_turn32<const> = require('bios/util/sincos_turn32')

local pi<const> = 3.141592653589793238462643383279502884
local half_pi<const> = pi * 0.5
local two_pi<const> = pi * 2.0
local deg_per_rad<const> = 180.0 / pi
local rad_per_deg<const> = pi / 180.0
local turn32_per_rad<const> = 4294967296.0 / two_pi
local q16_inv_scale<const> = numeric.q16_inv_scale
local maxinteger<const> = 9007199254740991
local mininteger<const> = -9007199254740991
local huge<const> = 1.0 / 0.0
local nan<const> = 0.0 / 0.0
local ln2<const> = 0.69314718055994530942
local inv_ln2<const> = 1.44269504088896340736
local ln10<const> = 2.30258509299404568402
local sqrt_half<const> = 0.70710678118654752440
local sqrt_two<const> = 1.41421356237309504880
local exp_overflow_limit<const> = 709.782712893384
local exp_underflow_limit<const> = -745.133219101941
local two_pow_16<const> = 65536.0
local u32_mod<const> = 4294967296.0

data rng_state: word = 0x12345678

local trunc<const> = numeric.trunc
local abs<const> = function(value)
	if value < 0 then
		return -value
	end
	return value
end

local floor<const> = function(value)
	return value // 1
end

local ceil<const> = function(value)
	return -((-value) // 1)
end

local fmod<const> = function(left, right)
	return left - (trunc(left / right) * right)
end

local modf<const> = function(value)
	local integer<const> = trunc(value)
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

local sin<const> = function(radians)
	local sin_q16<const> = sincos_turn32((trunc(radians * turn32_per_rad)) & 0xffffffff)
	return sin_q16 * q16_inv_scale
end

local cos<const> = function(radians)
	local cos_q16<const> = sincos_turn32((trunc(radians * turn32_per_rad) + 0x40000000) & 0xffffffff)
	return cos_q16 * q16_inv_scale
end

local tan<const> = function(radians)
	local sin_q16<const>, cos_q16<const> = sincos_turn32((trunc(radians * turn32_per_rad)) & 0xffffffff)
	if cos_q16 == 0 then
		if sin_q16 < 0 then
			return -huge
		end
		return huge
	end
	return sin_q16 / cos_q16
end

local sqrt<const> = function(value)
	if value < 0 then
		return nan
	end
	if value == 0 or value == huge then
		return value
	end
	local normalized = value
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
	if x == nil then
		return atan_one_arg(y)
	end
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
	return 0
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

local tointeger<const> = function(value)
	if type(value) ~= 'number' or value ~= value or value == huge or value == -huge then
		return nil
	end
	local integer<const> = trunc(value)
	if integer == value then
		return integer
	end
	return nil
end

local type_name<const> = function(value)
	if type(value) ~= 'number' then
		return nil
	end
	if tointeger(value) ~= nil then
		return 'integer'
	end
	return 'float'
end

local ult<const> = function(left, right)
	return (left % u32_mod) < (right % u32_mod)
end

local sign<const> = function(value)
	if value > 0 then
		return 1
	end
	if value < 0 then
		return -1
	end
	return 0
end

local next_random_unit<const> = function()
	*rng_state = ((*rng_state * 1664525) + 1013904223) % u32_mod
	return *rng_state / u32_mod
end

local random_number<const> = function(lower, upper)
	local value<const> = next_random_unit()
	if lower == nil then
		return value
	end
	if upper == nil then
		local upper_int<const> = trunc(lower)
		if upper_int < 1 then
			error('random upper bound must be positive.')
		end
		return trunc(value * upper_int) + 1
	end
	local lower_int<const> = trunc(lower)
	local upper_int<const> = trunc(upper)
	if upper_int < lower_int then
		error('random upper bound must be greater than or equal to lower bound.')
	end
	return lower_int + trunc(value * ((upper_int - lower_int) + 1))
end

local randomseed<const> = function(seed)
	if seed == nil then
		*rng_state = trunc(os.clock() * 1000) % u32_mod
		return
	end
	*rng_state = trunc(seed) % u32_mod
end

return {
	abs = abs,
	acos = acos,
	asin = asin,
	atan = atan,
	ceil = ceil,
	cos = cos,
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
	sign = sign,
	sin = sin,
	sqrt = sqrt,
	tan = tan,
	tointeger = tointeger,
	type = type_name,
	ult = ult,
}
