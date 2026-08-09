__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()
	local value1<const>, value2<const>, value3<const>, value4<const> = assert(0, 'kept', nil, 7)
	assert(select('#', assert(0, 'kept', nil, 7)) == 4, 'assert success result count mismatch')
	assert(value1 == 0 and value2 == 'kept' and value3 == nil and value4 == 7, 'assert success values mismatch')
	local assert_ok<const>, assert_message<const> = pcall(function() assert(false, 'bios assert failed') end)
	assert(not assert_ok and assert_message == 'bios assert failed', 'assert failure mismatch')

	local shared<const> = {}
	assert(rawequal(shared, shared), 'rawequal rejected identical table')
	assert(not rawequal({}, {}), 'rawequal accepted distinct tables')
	assert(rawequal(12, 12) and rawequal('x', 'x') and not rawequal(nil, false), 'rawequal primitive mismatch')

	assert(tostring(nil) == 'nil' and tostring(true) == 'true' and tostring(false) == 'false', 'tostring primitive mismatch')
	assert(tostring(12.5) == '12.5' and tostring('abc') == 'abc', 'tostring scalar mismatch')
	assert(tostring({}) == 'table' and tostring(function() end) == 'function', 'tostring object mismatch')

	assert(tonumber(12.5) == 12.5, 'tonumber numeric mismatch')
	assert(tonumber('  -12.5e1  ') == -125 and tonumber('.25') == 0.25, 'tonumber decimal mismatch')
	assert(tonumber('ff', 16) == 255 and tonumber('-101', 2) == -5, 'tonumber explicit base mismatch')
	assert(tonumber('0x10') == 16 and tonumber('-0Xf') == -15, 'tonumber hex prefix mismatch')
	assert(tonumber('12x') == nil and tonumber('') == nil and tonumber(true) == nil, 'tonumber rejection mismatch')
	assert(not pcall(function() return tonumber(12, 10) end), 'tonumber accepted numeric explicit-base input')
	assert(not pcall(function() return tonumber('10', 2.5) end), 'tonumber accepted fractional base')
	assert(not pcall(function() return tonumber('10', 37) end), 'tonumber accepted out-of-range base')

	print('bios', nil, 7)
	print('é')

	local sequence<const> = { 'first', 'second', nil, 'ignored' }
	local seen<const> = {}
	for index, value in ipairs(sequence) do
		seen[#seen + 1] = index .. ':' .. value
	end
	assert(seen[1] == '1:first' and seen[2] == '2:second' and seen[3] == nil, 'ipairs mismatch')

	local keyed<const> = { [1] = 11, [true] = 22, [false] = 33 }
	local count = 0
	local sum = 0
	for _key, value in pairs(keyed) do
		count = count + 1
		sum = sum + value
	end
	assert(count == 3 and sum == 66, 'pairs traversal mismatch')
	assert(not pcall(function()
		for key in pairs(7) do return key end
	end), 'pairs accepted non-table input')

	local next_ok<const>, next_key<const>, next_value<const> = pcall(next, { 41 }, nil)
	assert(type(next) == 'function' and next_ok and next_key == 1 and next_value == 41, 'next mismatch')
	assert(rawequal(next, pairs({ 41 })), 'pairs did not return BIOS next')

	local target<const> = {}
	local meta<const> = { tag = 'meta' }
	assert(rawequal(setmetatable(target, meta), target), 'setmetatable return mismatch')
	assert(rawequal(getmetatable(target), meta), 'getmetatable mismatch')
	rawset(target, 'x', 42)
	assert(rawget(target, 'x') == 42, 'rawget/rawset mismatch')
	assert(type(type) == 'function' and type(rawget) == 'function' and type(rawset) == 'function', 'raw primitive type mismatch')
	assert(type(setmetatable) == 'function' and type(getmetatable) == 'function', 'metatable primitive type mismatch')
	assert(type(select) == 'function' and type(error) == 'function', 'base primitive type mismatch')
	assert(select('#', 1, nil, 3) == 3, 'select count mismatch')
	local selected1<const>, selected2<const> = select(2, 'drop', 'keep', 'tail')
	assert(selected1 == 'keep' and selected2 == 'tail', 'select values mismatch')
	local xpcall_ok<const>, xpcall_value<const> = xpcall(function() error('xerr') end, function(message) return 'handled:' .. message end)
	assert(not xpcall_ok and xpcall_value == 'handled:xerr', 'xpcall mismatch')
	local error_ok<const>, error_value<const> = pcall(error, 'vm-error')
	assert(not error_ok and error_value == 'vm-error', 'error/pcall mismatch')

	local chunk<const>, load_error<const> = load([[
return function(target, frame)
	target["visual"]["color"] = frame["visual"]["color"]
	target[-1] = -8
	target[&"field"] = &"value"
	target[0x10] = 1.25e1
	target["escaped"] = "line\nquote:\" slash:\\ dec:\065"
end
	]], 'bios_base_runtime_assert.load', 't')
	assert(chunk ~= nil and load_error == nil, 'load rejected supported text')
	local apply<const> = chunk()
	local loaded_target<const> = { visual = {} }
	apply(loaded_target, { visual = { color = 0xff010203 } })
	assert(loaded_target.visual.color == 0xff010203, 'load parameter path mismatch')
	assert(loaded_target[-1] == -8, 'load negative literal/index mismatch')
	assert(loaded_target.field == 'value', 'load string-id literal mismatch')
	assert(loaded_target[0x10] == 12.5, 'load numeric literal mismatch')
	assert(loaded_target.escaped == 'line\nquote:" slash:\\ dec:A', 'load string escape mismatch')
	local rejected<const>, load_message<const> = load('return 1', 'bios_base_runtime_assert.reject', 't')
	assert(rejected == nil and type(load_message) == 'string', 'load syntax failure contract mismatch')
	local malformed_number<const> = load(
		'return function(target) target[1e] = 1 end',
		'bios_base_runtime_assert.number',
		't'
	)
	assert(malformed_number == nil, 'load accepted a malformed numeric literal')
	local invalid_escape<const> = load(
		'return function(target) target["x"] = "\\q" end',
		'bios_base_runtime_assert.escape',
		't'
	)
	assert(invalid_escape == nil, 'load accepted an invalid escape sequence')
	local binary_chunk<const>, binary_error<const> = load('return function() end', nil, 'b')
	assert(binary_chunk == nil and type(binary_error) == 'string', 'load mode contract mismatch')
end

function __bmsx_host_test.update(_frame)
	return true
end
