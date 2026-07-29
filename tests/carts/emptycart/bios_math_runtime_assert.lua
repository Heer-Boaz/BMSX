local function assert_close(actual, expected, tolerance, label)
	assert(math.abs(actual - expected) < tolerance, label)
end

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()
	assert_close(math.sin(math.pi * 0.5), 1, 0.0001, 'sin(pi/2) mismatch')
	assert_close(math.sin(math.pi / 6), 0.5, 0.0001, 'sin(pi/6) mismatch')
	assert_close(math.cos(math.pi), -1, 0.0001, 'cos(pi) mismatch')
	assert_close(math.cos(math.pi / 3), 0.5, 0.0001, 'cos(pi/3) mismatch')
	local quarter_turn_radians<const> = (1073741824.25 * (math.pi * 2)) / 4294967296
	assert(math.tan(quarter_turn_radians) == math.huge, 'tan(pi/2) mismatch')
	assert_close(math.sqrt(9), 3, 0.0001, 'sqrt mismatch')
	assert_close(math.exp(0.6931471805599453), 2, 0.0001, 'exp(ln2) mismatch')
	assert(math.exp(1000) == math.huge and math.exp(-1000) == 0, 'exp limit mismatch')
	assert(math.log(-1) ~= math.log(-1), 'log negative did not return NaN')
	assert(math.asin(2) ~= math.asin(2), 'asin out-of-domain did not return NaN')
	assert(math.acos(2) ~= math.acos(2), 'acos out-of-domain did not return NaN')
	assert(math.min(4, 2, 9, -1, 3) == -1 and math.max(4, 2, 9, -1, 3) == 9, 'math min/max mismatch')
	assert(math.ult(0, -1) and not math.ult(-1, 0), 'math.ult mismatch')

	math.randomseed(123)
	local seeded_a<const> = math.random(10)
	math.randomseed(123)
	local seeded_b<const> = math.random(10)
	assert(seeded_a == seeded_b and seeded_a == 3, 'math.random seeded upper-bound mismatch')
	math.randomseed(123)
	local random_first<const> = math.random()
	local random_second<const> = math.random()
	math.randomseed(123)
	assert(random_first == 1218640798 / 4294967296, 'math.random first value mismatch')
	assert(random_second == 1868869221 / 4294967296, 'math.random second value mismatch')
	assert(math.random() == random_first, 'math.random seed repeat mismatch')
	assert(math.random(10) == 5 and math.random(-1, 1) == -1, 'math.random integer range mismatch')
	assert(not pcall(function() return math.random(0) end), 'math.random accepted empty upper range')
	assert(not pcall(function() return math.random(5, 3) end), 'math.random accepted reversed range')

end

function __bmsx_host_test.update(_frame)
	return true
end
