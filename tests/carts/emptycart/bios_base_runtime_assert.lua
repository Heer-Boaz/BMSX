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

	local load_touch_count = 0
	local load_call_value = 0
	local load_for_header_count = 0
	local load_environment<const> = {
		scale = function(value, factor) return value * factor end,
		touch = function(value)
			load_touch_count = load_touch_count + 1
			return value
		end,
		record = function(value)
			load_call_value = value
		end,
		for_value = function(value)
			load_for_header_count = load_for_header_count + 1
			return value
		end,
	}
	local chunk<const>, load_error<const> = load([=[
return function(target, frame)
	;
	target["visual"]["color"] = frame["visual"]["color"]
	target[-1] = -8
	target["zero"] = 0
	target["one"] = 1
	target["minus_one"] = -1
	target["wide_integer"] = 0x80000
	target[&"field"] = &"value"
	target[0x10] = 1.25e1
	target["leading_fraction"] = .5
	target["sum"] = frame["left"] + frame["right"] * 2
	target["grouped"] = (frame["left"] + frame["right"]) * 2
	target["difference"] = frame["right"] - frame["left"] - 2
	target["division"] = frame["right"] / 2
	target["floor_division"] = frame["right"] // 6
	target["modulus"] = frame["right"] % 6
	target["negated"] = -frame["left"]
	target[frame["output_key"]] = frame["values"][frame["index"] + 1]
	target["value_count"] = #frame["values"]
	local scaled = scale(frame["left"] + 1, 3)
	scaled = scaled + 2
	target["called"] = scaled
	target["less"] = frame["left"] < scaled
	target["equal"] = scaled == 26
	target["not_equal"] = scaled ~= 26
	target["greater"] = scaled > frame["right"]
	target["greater_equal"] = scaled >= frame["right"]
	target["not_less"] = not target["less"]
	target["and_value"] = frame["left"] and touch(frame["right"])
	target["and_short"] = frame["missing"] and touch(100)
	target["or_value"] = frame["missing"] or frame["right"]
	target["or_short"] = frame["left"] or touch(200)
	local branch_value = 0
	if frame["left"] < 0 then
		branch_value = 1
	elseif frame["left"] == 7 and frame["right"] == 20 then
		local scoped_value = frame["right"] + 2
		target["scoped_value"] = scoped_value
		branch_value = 2
	else
		branch_value = 3
	end
	target["branch_value"] = branch_value
	if frame["missing"] and touch(300) then
		target["else_value"] = 1
	else
		target["else_value"] = 2
	end
	if frame["left"] or touch(400) then
		target["or_branch"] = true
	end
	local shadowed = 5
	if frame["left"] then
		local shadowed = frame["right"]
		target["inner_shadow"] = shadowed
	end
	target["outer_shadow"] = shadowed
	local preserved_logical = true
	local left_logical = false
	preserved_logical = left_logical or preserved_logical
	target["preserved_logical"] = preserved_logical
	local preserved_logical_short = false
	local left_logical_short = true
	preserved_logical_short = left_logical_short or preserved_logical_short
	target["preserved_logical_short"] = preserved_logical_short
	local preserved_arithmetic = 7
	preserved_arithmetic = scale(1, 1) + preserved_arithmetic
	target["preserved_arithmetic"] = preserved_arithmetic
	local preserved_comparison = 7
	preserved_comparison = preserved_comparison < 8
	target["preserved_comparison"] = preserved_comparison
	local preserved_path = frame["path_source"]
	preserved_path = preserved_path["children"][preserved_path["key"]]
	target["preserved_path"] = preserved_path
	local while_index = 0
	local while_sum = 0
	while while_index < frame["loop_count"] do
		while_index = while_index + 1
		if while_index == frame["loop_break"] then
			break
		end
		while_sum = while_sum + while_index
	end
	target["while_index"] = while_index
	target["while_sum"] = while_sum
	local outer_index = 0
	local nested_sum = 0
	while outer_index < 3 do
		outer_index = outer_index + 1
		local inner_index = 0
		while true do
			inner_index = inner_index + 1
			if inner_index == outer_index then
				break
			end
		end
		nested_sum = nested_sum + inner_index
	end
	target["nested_sum"] = nested_sum
	while frame["missing"] and touch(500) do
		target["unreachable_loop"] = true
	end
	local for_sum = 0
	for index = for_value(1), for_value(frame["for_limit"]), for_value(1) do
		for_sum = for_sum + index
	end
	target["for_sum"] = for_sum
	local reverse_sum = 0
	for index = 5, 1, -2 do
		reverse_sum = reverse_sum + index
	end
	target["reverse_for_sum"] = reverse_sum
	local dynamic_reverse_sum = 0
	for index = 5, 1, frame["reverse_step"] do
		dynamic_reverse_sum = dynamic_reverse_sum + index
	end
	target["dynamic_reverse_for_sum"] = dynamic_reverse_sum
	local broken_for_sum = 0
	for index = 1, 8, 2 do
		if index == 7 then
			break
		end
		broken_for_sum = broken_for_sum + index
	end
	target["broken_for_sum"] = broken_for_sum
	record(frame["right"])
	published = scaled
	target["escaped"] = "line\nquote:\" slash:\\ dec:\065 hex:\x42 skip:\z
		done";;
	return scaled
end;
	]=], 'bios_base_runtime_assert.load', 't', load_environment)
	assert(chunk ~= nil and load_error == nil, 'load rejected supported text')
	local apply<const> = chunk()
	local loaded_target<const> = { visual = {} }
	local loaded_result<const> = apply(loaded_target, {
		visual = { color = 0xff010203 },
		left = 7,
		right = 20,
		output_key = 'dynamic',
		values = { 4, 9, 16 },
		index = 1,
		loop_count = 8,
		loop_break = 5,
		for_limit = 4,
		reverse_step = -2,
		path_source = {
			children = { selected = 42 },
			key = 'selected',
		},
	})
	assert(loaded_target.visual.color == 0xff010203, 'load parameter path mismatch')
	assert(loaded_target[-1] == -8, 'load negative literal/index mismatch')
	assert(loaded_target.zero == 0 and loaded_target.one == 1, 'load small integer literal mismatch')
	assert(loaded_target.minus_one == -1, 'load negative-one literal mismatch')
	assert(loaded_target.wide_integer == 0x80000, 'load wide integer literal mismatch')
	assert(loaded_target.field == 'value', 'load string-id literal mismatch')
	assert(loaded_target[0x10] == 12.5, 'load numeric literal mismatch')
	assert(loaded_target.leading_fraction == 0.5, 'load leading fraction mismatch')
	assert(loaded_target.sum == 47, 'load arithmetic precedence mismatch')
	assert(loaded_target.grouped == 54, 'load grouped arithmetic mismatch')
	assert(loaded_target.difference == 11, 'load subtraction associativity mismatch')
	assert(loaded_target.division == 10, 'load division mismatch')
	assert(loaded_target.floor_division == 3, 'load floor division mismatch')
	assert(loaded_target.modulus == 2, 'load modulus mismatch')
	assert(loaded_target.negated == -7, 'load dynamic unary mismatch')
	assert(loaded_target.dynamic == 9, 'load dynamic table index mismatch')
	assert(loaded_target.value_count == 3, 'load length mismatch')
	assert(loaded_target.called == 26, 'load local assignment mismatch')
	assert(loaded_result == 26, 'load explicit return mismatch')
	assert(loaded_target.less and loaded_target.equal, 'load comparison mismatch')
	assert(not loaded_target.not_equal, 'load not-equal comparison mismatch')
	assert(loaded_target.greater and loaded_target.greater_equal, 'load reversed comparison mismatch')
	assert(not loaded_target.not_less, 'load unary not mismatch')
	assert(loaded_target.and_value == 20 and loaded_target.and_short == nil, 'load and value mismatch')
	assert(loaded_target.or_value == 20 and loaded_target.or_short == 7, 'load or value mismatch')
	assert(load_touch_count == 1, 'load logical expression did not short circuit')
	assert(loaded_target.branch_value == 2 and loaded_target.scoped_value == 22, 'load conditional branch mismatch')
	assert(loaded_target.else_value == 2 and loaded_target.or_branch, 'load conditional short circuit mismatch')
	assert(loaded_target.inner_shadow == 20 and loaded_target.outer_shadow == 5, 'load block scope mismatch')
	assert(loaded_target.preserved_logical, 'load logical assignment clobbered its source local')
	assert(loaded_target.preserved_logical_short, 'load logical short circuit lost its assigned value')
	assert(loaded_target.preserved_arithmetic == 8, 'load arithmetic assignment clobbered its source local')
	assert(loaded_target.preserved_comparison, 'load comparison assignment clobbered its source local')
	assert(loaded_target.preserved_path == 42, 'load path assignment clobbered its source local')
	assert(loaded_target.while_index == 5 and loaded_target.while_sum == 10, 'load while/break mismatch')
	assert(loaded_target.nested_sum == 6, 'load nested break mismatch')
	assert(loaded_target.unreachable_loop == nil, 'load while condition mismatch')
	assert(loaded_target.for_sum == 10 and load_for_header_count == 3, 'load numeric for mismatch')
	assert(loaded_target.reverse_for_sum == 9, 'load descending numeric for mismatch')
	assert(loaded_target.dynamic_reverse_for_sum == 9, 'load dynamic numeric for mismatch')
	assert(loaded_target.broken_for_sum == 9, 'load numeric for break mismatch')
	assert(load_call_value == 20, 'load call statement mismatch')
	assert(load_environment.published == 26, 'load environment assignment mismatch')
	assert(loaded_target.escaped == 'line\nquote:" slash:\\ dec:A hex:B skip:done', 'load string escape mismatch')
	local value_chunk<const>, value_error<const> = load(
		'return 1',
		'bios_base_runtime_assert.value',
		't'
	)
	assert(value_chunk ~= nil and value_error == nil and value_chunk() == 1, 'load chunk result mismatch')
	local capture_chunk<const>, capture_error<const> = load([=[
		local scale<const> = scale
		local total = 0
		return function(value)
			total = total + scale
			return value * total
		end
	]=], 'bios_base_runtime_assert.capture', 't', { scale = 3 })
	assert(capture_chunk ~= nil and capture_error == nil, 'load capture compilation failed')
	local captured<const> = capture_chunk()
	assert(captured(2) == 6 and captured(2) == 12, 'load lexical capture mismatch')
	local nested_chunk<const>, nested_error<const> = load([=[
		local value = 1
		local increment<const> = 2
		return function()
			return function()
				value = value + increment
				return value
			end
		end
	]=], 'bios_base_runtime_assert.nested_capture', 't')
	assert(nested_chunk ~= nil and nested_error == nil, 'load nested capture compilation failed')
	local nested_factory<const> = nested_chunk()
	local nested<const> = nested_factory()
	assert(nested() == 3 and nested() == 5, 'load transitive capture mismatch')
	local const_capture_chunk<const> = load([=[
		local first<const> = first
		local second<const> = second
		return function(value)
			return first[value] == second
		end
	]=], 'bios_base_runtime_assert.const_capture', 't', {
		first = { [3] = 'matched' },
		second = 'matched',
	})
	local const_capture<const> = const_capture_chunk()
	assert(const_capture(3), 'load immutable capture mismatch')
	local loop_condition_chunk<const> = load([=[
		local limit<const> = limit
		return function()
			local value = 0
			while value < limit do
				value = value + 1
			end
			return value
		end
	]=], 'bios_base_runtime_assert.loop_condition_capture', 't', { limit = 3 })
	assert(loop_condition_chunk()() == 3, 'load loop-condition capture mismatch')
	local local_function_chunk<const> = load([=[
		local offset<const> = offset
		local transform<const> = function(value)
			return value + offset
		end
		return function(value)
			return transform(value)
		end
	]=], 'bios_base_runtime_assert.local_function', 't', { offset = 4 })
	assert(local_function_chunk()(6) == 10, 'load local function capture mismatch')
	local const_assignment<const> = load(
		'local value<const> = 1 value = 2 return value',
		'bios_base_runtime_assert.const',
		't'
	)
	assert(const_assignment == nil, 'load accepted assignment to const local')
	local missing_const_initializer<const> = load(
		'local value<const> return value',
		'bios_base_runtime_assert.const_initializer',
		't'
	)
	assert(missing_const_initializer == nil, 'load accepted const local without initializer')
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
	local invalid_break<const> = load(
		'return function() break end',
		'bios_base_runtime_assert.break',
		't'
	)
	assert(invalid_break == nil, 'load accepted break outside loop')
	local binary_chunk<const>, binary_error<const> = load('return function() end', nil, 'b')
	assert(binary_chunk == nil and type(binary_error) == 'string', 'load mode contract mismatch')
end

function __bmsx_host_test.update(_frame)
	return true
end
