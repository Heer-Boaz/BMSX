return {
	kind = 'unit',
	tests = {
		base = function()
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
				scaler = {
					factor = 4,
					scale = function(self, value) return self.factor * value end,
				},
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
				target["method_called"] = scaler:scale(frame["left"])
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
			assert(loaded_target.method_called == 28, 'load method call mismatch')
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
		end,
		math = function()
			local function assert_close(actual, expected, tolerance, label)
				assert(math.abs(actual - expected) < tolerance, label)
			end

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
		end,
		string = function()
			assert(string.len('abc') == 3, 'string.len ASCII mismatch')
			assert(string.len('áβ') == 2 and ('áβ'):len() == 2 and #'áβ' == 2, 'string.len UTF-8 mismatch')
			assert(type(string.byte) == 'function' and type(string.char) == 'function', 'string byte/char type mismatch')
			assert(string.upper('Az-09áβ') == 'AZ-09áβ' and ('aBc'):upper() == 'ABC', 'string.upper mismatch')
			assert(string.lower('Az-09áβ') == 'az-09áβ' and ('AbC'):lower() == 'abc', 'string.lower mismatch')

			assert(string.sub('aβc', 2, 2) == 'β', 'string.sub UTF-8 mismatch')
			assert(string.sub('abcd', -2) == 'cd', 'string.sub negative start mismatch')
			assert(string.sub('abcd', 2, 0) == '' and string.sub('abcd', 1, 0) == '', 'string.sub zero end mismatch')
			assert(('aβc'):sub(2, 3) == 'βc', 'string method sub mismatch')
			assert(string.reverse('aβc') == 'cβa', 'string.reverse UTF-8 mismatch')
			assert(('stressed'):reverse() == 'desserts' and string.reverse('') == '' and string.reverse('x') == 'x', 'string.reverse mismatch')

			assert(string.rep('ab', 3) == 'ababab', 'string.rep mismatch')
			assert(string.rep('x', 3, '-') == 'x-x-x', 'string.rep separator mismatch')
			assert(string.rep('x', 2.9) == 'xx' and string.rep('x', 0) == '', 'string.rep count mismatch')
			assert(string.rep('', 3, ',') == ',,' and string.rep('z') == 'z', 'string.rep empty/default mismatch')

			assert(string.format('enemy_%03d_%02d', 7, 4) == 'enemy_007_04', 'string.format zero padding mismatch')
			assert(string.format('%08Xh', 0x1af) == '000001AFh', 'string.format hex mismatch')
			assert(string.format('%-6s:%+04d', 'hp', 7) == 'hp    :+007', 'string.format padding/sign mismatch')
			assert(string.format('%.1f MB', 1.25) == '1.3 MB', 'string.format fixed precision mismatch')
			assert(string.format('%.3f|%g|%e|%G', -2.5, 1234.0, 12.5, 0.00125) == '-2.500|1234|1.250000e+01|0.00125', 'string.format float forms mismatch')
			assert(string.format('%q', 'a\nb"c') == '"a\\nb\\"c"', 'string.format quote mismatch')
			assert(string.format('%*.*f', 8, 2, 3.5) == '    3.50', 'string.format star width mismatch')
			assert(string.format('%#x|%#o|%.0f|%#.0f', 26, 9, 1.2, 1.2) == '0x1a|011|1|1.', 'string.format alternate forms mismatch')

			local integer_blob<const> = string.pack('<bBhHi4I2', -2, 250, -300, 60000, -123456, 513)
			assert(#integer_blob == 14, 'string.pack integer length mismatch')
			assert(string.byte(integer_blob, 1) == 254 and string.byte(integer_blob, 2) == 250, 'string.pack byte mismatch')
			assert(string.byte(integer_blob, 3) == 212 and string.byte(integer_blob, 4) == 254, 'string.pack half mismatch')
			local a<const>, b<const>, c<const>, d<const>, e<const>, f<const>, integer_next<const> = string.unpack('<bBhHi4I2', integer_blob)
			assert(a == -2 and b == 250 and c == -300 and d == 60000 and e == -123456 and f == 513, 'string.unpack integer mismatch')
			assert(integer_next == 15 and string.packsize('<bHI4') == 8, 'string.unpack integer layout mismatch')

			local string_blob<const> = string.pack('<c4zs2', 'ab', 'hi', 'xyz')
			assert(#string_blob == 13 and string.byte(string_blob, 3) == 0 and string.byte(string_blob, 7) == 0, 'string.pack string layout mismatch')
			local fixed<const>, zed<const>, sized<const>, string_next<const> = string.unpack('<c4zs2', string_blob)
			assert(#fixed == 4 and string.sub(fixed, 1, 2) == 'ab' and string.byte(fixed, 3) == 0 and string.byte(fixed, 4) == 0, 'string.unpack fixed string mismatch')
			assert(zed == 'hi' and sized == 'xyz' and string_next == 14, 'string.unpack variable strings mismatch')

			local float_blob<const> = string.pack('<fd', 1.5, -2.25)
			local f32<const>, f64<const>, float_next<const> = string.unpack('<fd', float_blob)
			assert(math.abs(f32 - 1.5) < 0.000001 and f64 == -2.25 and float_next == 17, 'string.unpack floats mismatch')
			assert(not pcall(function() return string.packsize('z') end), 'string.packsize accepted variable format')

			local find_start<const>, find_end<const> = string.find('hello β world', 'β', 1, true)
			assert(find_start == 7 and find_end == 7, 'plain string.find mismatch')
			assert(('alpha_09'):match('^[A-Za-z_][A-Za-z0-9_]*$') == 'alpha_09', 'identifier pattern positive mismatch')
			assert(('9alpha'):match('^[A-Za-z_][A-Za-z0-9_]*$') == nil, 'identifier pattern negative mismatch')
			local machine_id<const>, state_path<const> = string.match('combat:/root/intro', '^(.-):/(.+)$')
			assert(machine_id == 'combat' and state_path == 'root/intro', 'path capture mismatch')

			local parts<const> = {}
			for part in string.gmatch('a.b.c', '[^%.]+') do
				parts[#parts + 1] = part
			end
			assert(parts[1] == 'a' and parts[2] == 'b' and parts[3] == 'c' and parts[4] == nil, 'string.gmatch parts mismatch')
			local lines<const> = {}
			for line in ('one\ntwo\r\nthree'):gmatch('[^\r\n]+') do
				lines[#lines + 1] = line
			end
			assert(lines[1] == 'one' and lines[2] == 'two' and lines[3] == 'three' and lines[4] == nil, 'string.gmatch lines mismatch')

			local patched<const>, patch_count<const> = string.gsub('a$b$c', '%$', '.')
			assert(patched == 'a.b.c' and patch_count == 2, 'string.gsub escaped percent mismatch')
			assert(string.gsub('   x', '^%s+', '') == 'x' and string.gsub('x   ', '%s+$', '') == 'x', 'string.gsub trim mismatch')
			assert(string.gsub('item42', '(%a+)(%d+)', '%2:%1') == '42:item', 'string.gsub capture replacement mismatch')
			assert(string.match('pre(a(b)c)post', '%b()') == '(a(b)c)', 'balanced pattern mismatch')
			local frontier_first<const>, frontier_second<const> = string.match('one two', '(%f[%a]%a+)%s+(%f[%a]%a+)')
			assert(frontier_first == 'one' and frontier_second == 'two', 'frontier pattern mismatch')
			assert(string.match('ha ha', '^(%a+) %1$') == 'ha', 'capture backreference mismatch')
			local position<const>, positioned_word<const> = string.match('abc123', '()%d+(%d%d)$')
			assert(position == 4 and positioned_word == '23', 'position capture mismatch')
		end,
		table = function()
			local packed<const> = table.pack('a', nil, 3)
			assert(packed.n == 3 and packed[1] == 'a' and packed[2] == nil and packed[3] == 3, 'table.pack mismatch')

			local values<const> = { 'a', 'c' }
			table.insert(values, 2, 'b')
			table.insert(values, 'd')
			local removed_middle<const> = table.remove(values, 2)
			local removed_tail<const> = table.remove(values)
			assert(values[1] == 'a' and values[2] == 'c', 'table.insert/remove content mismatch')
			assert(removed_middle == 'b' and removed_tail == 'd', 'table.remove result mismatch')
			assert(select('#', table.remove({})) == 1, 'empty table.remove result count mismatch')

			local concat_values<const> = { 'a', nil, 3, 'd' }
			assert(table.concat(concat_values, '-', 1, 4) == 'a--3-d', 'table.concat range mismatch')
			assert(table.concat({ 'a', 'b', 'c', 'd' }, '/', -2) == 'c/d', 'table.concat negative start mismatch')
			assert(table.concat(concat_values, ',', 3, 2) == '', 'table.concat empty range mismatch')

			local unpack_values<const> = { 'a', nil, 'c', 'd' }
			assert(select('#', table.unpack(unpack_values, 1, 4)) == 4, 'table.unpack result count mismatch')
			assert(select(2, table.unpack(unpack_values, 1, 4)) == nil, 'table.unpack nil slot mismatch')
			local tail1<const>, tail2<const> = table.unpack({ 'a', 'b', 'c', 'd' }, -2)
			assert(tail1 == 'c' and tail2 == 'd', 'table.unpack negative start mismatch')
			assert(select('#', table.unpack(unpack_values, 3, 2)) == 0, 'table.unpack empty range mismatch')

			local sorted<const> = { 4, 1, 3, 2 }
			assert(table.sort(sorted) == nil, 'table.sort return value mismatch')
			assert(sorted[1] == 1 and sorted[2] == 2 and sorted[3] == 3 and sorted[4] == 4, 'table.sort default order mismatch')

			local words<const> = { 'bb', 'dddd', 'a', 'ccc' }
			table.sort(words, function(left, right) return #left > #right end)
			assert(words[1] == 'dddd' and words[2] == 'ccc' and words[3] == 'bb' and words[4] == 'a', 'table.sort comparator order mismatch')

			local ordered<const> = { 1, 2, 3, 4, 5, 6 }
			local comparisons = 0
			table.sort(ordered, function(left, right)
				comparisons = comparisons + 1
				return left < right
			end)
			assert(comparisons == 5, 'table.sort ordered-list comparison count mismatch')
		end,
		calendar = function()
			assert(os.difftime(125, 20) == 105, 'os.difftime mismatch')

			local normalized = { year = 1970, month = 13, day = 1, hour = 0 }
			assert(os.time({ year = 1970, month = 1, day = 1 }) == 43200, 'os.time default noon mismatch')
			assert(os.time({ year = 1970, month = 1, day = 1, hour = 0 }) == 0, 'os.time epoch mismatch')
			assert(os.time({ year = 1969, month = 12, day = 31, hour = 23, min = 59, sec = 59 }) == -1, 'os.time pre-epoch mismatch')
			assert(os.time(normalized) == 31536000, 'os.time normalization result mismatch')
			assert(normalized.year == 1971 and normalized.month == 1 and normalized.day == 1, 'os.time normalized date mismatch')
			assert(normalized.hour == 0 and normalized.min == 0 and normalized.sec == 0, 'os.time normalized clock mismatch')
			assert(normalized.wday == 6 and normalized.yday == 1 and normalized.isdst == false, 'os.time normalized calendar mismatch')
			assert(not pcall(function() return os.difftime(1.5, 1) end), 'os.difftime accepted fractional time')
			assert(not pcall(function() return os.time({ year = 1970.5, month = 1, day = 1 }) end), 'os.time accepted fractional field')

			local epoch_table<const> = os.date('*t', 0)
			assert(os.date('%Y-%m-%d %H:%M:%S', 0) == '1970-01-01 00:00:00', 'os.date epoch mismatch')
			assert(os.date('%c', 0) == 'Thu Jan 01 00:00:00 1970', 'os.date %c mismatch')
			assert(os.date('!%F %T %z %Z', -1) == '1969-12-31 23:59:59 +0000 BMSX', 'os.date pre-epoch mismatch')
			assert(os.date('%G-W%V-%u', 0) == '1970-W01-4', 'os.date ISO week mismatch')
			assert(epoch_table.year == 1970 and epoch_table.month == 1 and epoch_table.day == 1, 'os.date table date mismatch')
			assert(epoch_table.hour == 0 and epoch_table.min == 0 and epoch_table.sec == 0, 'os.date table clock mismatch')
			assert(epoch_table.wday == 5 and epoch_table.yday == 1 and epoch_table.isdst == false, 'os.date table calendar mismatch')
			assert(not pcall(function() return os.date('%Q', 0) end), 'os.date accepted unsupported specifier')
		end,
	},
}
