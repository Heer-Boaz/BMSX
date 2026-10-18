module<entry>

local storage<const> = require('results')
local result<const>: *bios_math_manual_result = storage.result

-- Cartridge source uses // 1 for unit flooring; math.floor is not permitted.
result.absolute = math.abs(-12.5)
result.rounding[0] = 1.75 // 1
result.rounding[1] = math.ceil(1.25)
result.rounding[2] = -1.25 // 1
result.rounding[3] = math.ceil(-1.75)
result.rounding[4] = math.round(1.5)
result.rounding[5] = math.round(-1.5)
print('Math rounding', result.absolute, result.rounding[0], result.rounding[1],
	result.rounding[2], result.rounding[3], result.rounding[4], result.rounding[5])

result.fmod_value = math.fmod(-7.5, 2)
result.modulo_value = -7.5 % 2
result.integer_part, result.fraction_part = math.modf(-3.75)
print('Math fractions', result.fmod_value, result.modulo_value,
	result.integer_part, result.fraction_part)

-- A nil tail position counts but does not replace a numeric minimum/maximum.
result.minimum = math.min(8, nil, -3, 5)
result.maximum = math.max(8, nil, -3, 5)
result.text_minimum = math.min('pear', 'apple', 'plum') == 'apple' and 1 or 0
local token<const> = { marker = 7 }
result.abs_identity = math.abs(token) == token and 1 or 0
result.abs_text = math.abs('12.5') == '12.5' and 1 or 0
local missing_ok<const>, missing_value<const> = pcall(math.abs)
result.abs_missing = missing_ok and missing_value == nil and 1 or 0
result.arithmetic_nan = '12.5' // 1
print('Math selection', result.minimum, result.maximum, result.text_minimum)
print('Math supplied values', result.abs_identity, result.abs_text,
	result.abs_missing, result.arithmetic_nan ~= result.arithmetic_nan)
print('Math missing', missing_ok, missing_value)

result.large_integer = math.tointeger(math.maxinteger + 1)
result.fraction_rejected = math.tointeger(3.75) == nil and 1 or 0
result.text_rejected = math.tointeger('3') == nil and 1 or 0
result.classifications = math.type(3) == 'integer' and math.type(3.75) == 'float'
	and math.type(math.huge) == 'float' and math.type('3') == nil and 1 or 0
result.unsigned_wrap = math.ult(-1, 1) and 1 or 0
result.unsigned_fraction = math.ult(0.5, 1) and 1 or 0
result.unsigned_equal = math.ult(4294967296, 0) and 1 or 0
result.signs[0] = math.sign(-3)
result.signs[1] = math.sign(0)
result.signs[2] = math.sign(3)
print('Math classification', result.large_integer, result.fraction_rejected,
	result.text_rejected, result.classifications)
print('Math unsigned', result.unsigned_wrap, result.unsigned_fraction,
	result.unsigned_equal)
print('Math signs', result.signs[0], result.signs[1], result.signs[2])

-- Reciprocals distinguish zero signs even when printed text does not.
local negative_zero<const> = -1 / math.huge
result.abs_negative_zero = 1 / math.abs(negative_zero) == -math.huge and 1 or 0
result.floor_negative_zero = 1 / (negative_zero // 1) == -math.huge and 1 or 0
result.ceil_negative_zero = 1 / math.ceil(negative_zero) == -math.huge and 1 or 0
result.round_positive_zero = 1 / math.round(negative_zero) == math.huge and 1 or 0
local zero_integer<const>, zero_fraction<const> = math.modf(negative_zero)
result.modf_integer_negative_zero = 1 / zero_integer == -math.huge and 1 or 0
result.modf_fraction_positive_zero = 1 / zero_fraction == math.huge and 1 or 0
result.fmod_positive_zero = 1 / math.fmod(negative_zero, 2) == math.huge and 1 or 0
print('Math modf zero reciprocals', 1 / zero_integer, 1 / zero_fraction)
print('Math zero signs', result.abs_negative_zero, result.floor_negative_zero,
	result.ceil_negative_zero, result.round_positive_zero,
	result.modf_integer_negative_zero, result.modf_fraction_positive_zero,
	result.fmod_positive_zero)

local min_ok<const>, min_error<const> = pcall(math.min, nil, 2)
local max_ok<const>, max_error<const> = pcall(math.max)
result.min_error = not min_ok and min_error == 'min expects at least one argument.'
	and 1 or 0
result.max_error = not max_ok and max_error == 'max expects at least one argument.'
	and 1 or 0
print('Math min error', min_ok, min_error)
print('Math max error', max_ok, max_error)

-- Angles are ordinary radians; the BIOS owns the turn/lookup conversion.
result.trig[0] = math.sin(0)
result.trig[1] = math.cos(0)
result.trig[2] = math.tan(0)
result.trig[3] = math.sin(math.rad(30))
result.trig[4] = math.cos(math.rad(60))
result.trig[5] = math.tan(math.rad(45))
result.angles[0] = math.rad(180)
result.angles[1] = math.deg(math.pi)
result.angles[2] = math.atan(1)
result.angles[3] = math.atan(1, -1)
result.angles[4] = math.asin(1)
result.angles[5] = math.acos(1)
print('Math trigonometry', result.trig[0], result.trig[1], result.trig[2],
	result.trig[3], result.trig[4], result.trig[5])
print('Math angles', result.angles[0], result.angles[1], result.angles[2],
	result.angles[3], result.angles[4], result.angles[5])

result.square_root = math.sqrt(9)
result.root_negative_zero = 1 / math.sqrt(negative_zero) == -math.huge and 1 or 0
result.root_nan = math.sqrt(-1)
result.exponentials[0] = math.exp(0)
result.exponentials[1] = math.exp(1)
result.exponentials[2] = math.exp(-1)
result.exp_edges[0] = math.exp(710)
result.exp_edges[1] = math.exp(-746)
result.logarithms[0] = math.log(1)
result.logarithms[1] = math.log(8, 2)
result.logarithms[2] = math.log(100, 10)
result.logarithms[3] = math.log(0)
result.log_nan = math.log(-1)
print('Math root', result.square_root, result.root_negative_zero,
	result.root_nan ~= result.root_nan)
print('Math exponentials', result.exponentials[0], result.exponentials[1],
	result.exponentials[2], result.exp_edges[0], result.exp_edges[1])
print('Math logarithms', result.logarithms[0], result.logarithms[1],
	result.logarithms[2], result.logarithms[3], result.log_nan ~= result.log_nan)

-- Reached word conversion is not an argument-type exception or string parse.
result.trig_nonnumeric[0] = math.sin('text')
result.trig_nonnumeric[1] = math.cos('text')
result.trig_nonnumeric[2] = math.tan('text')
result.atan_false = math.atan(1, false)
print('Math nonnumeric angles', result.trig_nonnumeric[0], result.trig_nonnumeric[1],
	result.trig_nonnumeric[2], result.atan_false)

-- Explicit seeds make this sequence independent of the clock default.
result.random_seed_count = select('#', math.randomseed(1))
result.random_unit = math.random()
result.random_single = math.random(6)
result.random_interval = math.random(-2, 2)
result.random_truncated = math.random(8.9, 8.1)
print('Math random modes', result.random_seed_count, result.random_unit,
	result.random_single, result.random_interval, result.random_truncated)
result.random_seed_nil = math.randomseed(1) == nil and 1 or 0
result.random_repeated = math.random()
print('Math random replay', result.random_seed_nil, result.random_repeated,
	result.random_repeated == result.random_unit)

-- Failed bounds consume the next draw before the protected error is returned.
local bound_ok<const>, bound_error<const> = pcall(math.random, 0)
result.random_error = not bound_ok
	and bound_error == 'random upper bound must be positive.' and 1 or 0
result.random_after_error = math.random()
print('Math random error', bound_ok, bound_error, result.random_after_error)
local interval_ok<const>, interval_error<const> = pcall(math.random, 5, 3)
result.random_two_error = not interval_ok
	and interval_error ==
		'random upper bound must be greater than or equal to lower bound.'
	and 1 or 0
result.random_two_after_error = math.random()
print('Math random interval error', interval_ok, interval_error,
	result.random_two_after_error)

-- False is a supplied seed/bound; only nil selects the missing-bound branch.
math.randomseed(false)
result.random_false_seed = math.random()
result.random_false_value = math.random(false)
result.random_nil_upper = math.random(nil, false)
print('Math random false', result.random_false_seed,
	result.random_false_value ~= result.random_false_value, result.random_nil_upper)

result.integer_bounds[0] = math.mininteger
result.integer_bounds[1] = math.maxinteger
result.pi = math.pi
result.huge = math.huge
print('Math constants', result.integer_bounds[0], result.integer_bounds[1],
	result.pi, result.huge)
result.completed = 1

while true do
	halt_until_irq
end
