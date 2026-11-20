-- Public BIOS libraries on one physical boot. Each block owns its own data.
bss copy_source: u8[257]
rodata text_bytes: u8[8] = { 0x41, 0x7a, 0xc3, 0xa9, 0xf0, 0x9f, 0x9a, 0x80 }
local time_ms<const>: *word = 0x08010228

return {
	kind = 'integration',
	tests = {
		builtins = function(t)
			-- Base values, tables and protected result tuples.
			do
				local tuple<const> = table.pack(assert(0, 'kept', nil, 7))
				assert(tuple.n == 4 and tuple[1] == 0 and tuple[2] == 'kept' and tuple[3] == nil and tuple[4] == 7)
				local ok<const>, message<const> = pcall(assert, false, 'assert failure')
				assert(not ok and message == 'assert failure')
				local failure<const> = {}
				local caught<const>, value<const> = pcall(error, failure)
				assert(not caught and rawequal(value, failure))
				local handled<const> = table.pack(xpcall(function() error(failure) end, function(value)
					assert(value == failure)
					return 'handled', 'not returned'
				end))
				assert(handled.n == 2 and not handled[1] and handled[2] == 'handled')
				local nil_ok<const>, nil_error<const> = pcall(error, nil)
				assert(not nil_ok and nil_error == nil)

				assert(tonumber('  -12.5e1  ') == -125 and tonumber('.25') == 0.25)
				assert(tonumber('0x10') == 16 and tonumber('-101', 2) == -5 and tonumber('z', 36) == 35)
				assert(tonumber('12x') == nil and tonumber('') == nil and tonumber(true) == nil)
				assert(not pcall(tonumber, '10', 2.5) and not pcall(tonumber, '10', 37) and not pcall(tonumber, 12, 10))
				assert(tostring(false) == 'false' and tostring(12.5) == '12.5' and tostring({}) == 'table')
				assert(type(nil) == 'nil' and type(function() end) == 'function')
				local object<const>, metatable<const> = {}, { __index = { missing = 4 } }
				assert(rawequal(setmetatable(object, metatable), object) and getmetatable(object) == metatable)
				rawset(object, 'existing', 42)
				assert(rawget(object, 'existing') == 42 and rawget(object, 'missing') == nil and object.missing == 4)
				assert(not rawequal({}, {}) and rawequal(object, object))
				setglobal('bios_builtin_probe', object)
				assert(getglobal('bios_builtin_probe') == object)
				setglobal('bios_builtin_probe', nil)
				assert(select('#', 1, nil, 3) == 3 and select(2, 'drop', 'keep', 'tail') == 'keep')

				local keyed<const> = { [1] = 11, [true] = 22, [false] = 33 }
				local count, sum = 0, 0
				assert(rawequal(next, pairs(keyed)))
				for _key, item in pairs(keyed) do
					count += 1
					sum += item
				end
				assert(count == 3 and sum == 66, 'pairs must traverse a false key')
				local last = 0
				for index, item in ipairs({ 10, 20, nil, 40 }) do
					assert(item == index * 10)
					last = index
				end
				assert(last == 2, 'ipairs stops at the first nil')
				local total = 0
				for key, item, missing in function(_, previous)
					if previous == 0 then return false, 10 end
					if previous == false then return 2, 20 end
					assert(previous == 2, 'the iterator receives the previous result, not the mutated loop variable')
					return nil, 999
				end, nil, 0 do
					assert(missing == nil)
					total += item
					key = 99
				end
				assert(total == 30)
			end

			-- The resident loader compiles before executing and retains its bindings.
			do
				local env<const> = { total = 0, step = 3 }
				local run<const> = assert(load('total = total + step return total, nil, step', 'builtin.environment', 't', env))
				assert(env.total == 0 and run() == 3)
				env.step = 5
				local result<const> = table.pack(run())
				assert(result.n == 3 and result[1] == 8 and result[2] == nil and result[3] == 5)
				local child<const> = assert(load('return function(value) return value + step end', 'builtin.child', 't', env))()
				env.step = 7
				assert(child(2) == 9, 'an escaping closure reads its retained environment')

				local binding<const> = { available = true, is_type = false, is_const = false, value = 10 }
				local shadow<const> = { count = 1000 }
				local increment<const> = assert(load('count = count + 2 return count', 'builtin.external', 't', shadow, {
					names = { count = binding },
					read = function(location) return location.value end,
					write = function(location, value) location.value = value end,
				}))
				assert(increment() == 12 and increment() == 14 and binding.value == 14 and shadow.count == 1000)

				local invalid<const>, diagnostic<const> = load('return @', 'builtin.invalid')
				assert(invalid == nil and type(diagnostic) == 'string')
				local binary<const>, rejected<const> = load('return true', 'builtin.binary', 'b')
				assert(binary == nil and type(rejected) == 'string')
				local f<const> = lua_compiler.syntax_factory
				local compiled<const> = lua_compiler.compile_syntax(f.chunk(f.block({
					f.return_statement({ f.number_literal(42) }),
				})), 'builtin.syntax')
				assert(compiled() == 42)
			end

			-- Tagged numeric results and representative numerical boundaries.
			do
				assert(math.abs(-12.5) == 12.5 and math.floor(-1.25) == -2 and math.ceil(-1.25) == -1)
				assert(math.round(1.5) == 2 and math.round(-1.5) == -2)
				local integral<const>, fraction<const> = math.modf(-3.75)
				assert(integral == -3 and fraction == -0.75 and math.fmod(-3.5, 2) == -1.5)
				assert(math.min(4, -1, 9) == -1 and math.max(4, -1, 9) == 9 and math.ult(0, -1))
				assert(math.tointeger(12.5) == nil and math.type(1) == 'integer' and math.type(1.25) == 'float')
				assert(math.abs(math.sin(math.pi / 6) - 0.5) < 0.0001 and math.abs(math.cos(math.pi) + 1) < 0.0001)
				assert(math.sqrt(9) == 3 and math.abs(math.exp(0.69314718) - 2) < 0.0001)
				assert(math.exp(1000) == math.huge and math.exp(-1000) == 0)
				local domain_error<const> = math.log(-1)
				assert(domain_error ~= domain_error)
				assert(select('#', math.randomseed(1)) == 1)
				local first<const> = math.random()
				assert(first == 3967065 / 16777216, 'unbounded random uses the top 24 bits')
				assert(not pcall(math.random, 0) and not pcall(math.random, 5, 3))
				assert(math.random(6) == 3 and math.random(-2, 2) == 0, 'rejected bounds must not advance the generator')
				math.randomseed(1)
				assert(math.random() == first)
			end

			-- Bytes, Unicode projection, formatting and pattern results are distinct.
			do
				local text<const> = string.from_bytes(text_bytes, #text_bytes)
				assert(text == utf8.char(65, 122, 233, 0x1f680) and string.len(text) == 8 and utf8.count(text) == 4)
				assert(text:upper() == 'AZé🚀' and text:lower() == 'azé🚀')
				assert(string.sub('éa', -1) == 'a' and string.sub('abcd', 2, 0) == '')
				assert(string.reverse('abc') == 'cba' and string.rep('x', 3, '-') == 'x-x-x')
				assert(string.byte(text, 3) == 0xc3 and string.byte(text, 4) == 0xa9 and string.byte(text, 9) == nil)
				for i = 0, 256 do copy_source[i] = 65 end
				local copied<const> = string.from_bytes(copy_source, 257)
				copy_source[0] = 90
				assert(copied == string.rep('A', 257), 'mapped copy owns its content across staging boundaries')

				assert(string.format('%-6s:%+04d', 'hp', 7) == 'hp    :+007')
				assert(string.format('%#08x|%u|%.0d', 42, -1, 0) == '0x00002a|4294967295|')
				assert(string.format('%*.*f', 8, 2, 1.25) == '    1.25')
				assert(string.format('%.3f|%g|%e', -2.5, 1234.0, 12.5) == '-2.500|1234|1.250000e+01')
				assert(string.format('%q', 'a\nb"c') == '"a\\nb\\"c"')
				assert(not pcall(string.format, '%') and not pcall(string.format, '%d', {}))
				local nul<const>, letter<const> = string.format('%c', 0), string.format('%c', 65)
				assert(#nul == 1 and string.byte(nul, 1) == 0 and string.byte(nul, 2) == nil)
				assert(letter == 'A' and string.format('%c', 65.75) == 'A' and string.format('%3c', 65) == '  A')
				assert(#string.char(0) == 1 and #string.char((math.modf(0))) == 1)
				assert(select('#', (math.modf(0))) == 1 and select('#', math.modf(0)) == 2)

				local find<const> = string.find
				local literal_first<const>, literal_last<const> = find('a.b', '.', 1, true)
				local pattern_first<const>, pattern_last<const> = ('a.b'):find('.', 1, false)
				assert(literal_first == 2 and literal_last == 2 and pattern_first == 1 and pattern_last == 1)
				local first<const>, last<const> = find('aéz', 'é', 1, true)
				assert(first == 2 and last == 3, 'pattern positions use bytes')
				local parts<const> = {}
				for part in string.gmatch('a.b.c', '[^%.]+') do parts[#parts + 1] = part end
				assert(table.concat(parts, '-') == 'a-b-c')
				local replaced<const>, count<const> = string.gsub('item42 item7', '(%a+)(%d+)', '%2:%1')
				assert(replaced == '42:item 7:item' and count == 2)
				assert(string.match('pre(a(b)c)post', '%b()') == '(a(b)c)')
				assert(string.match('ha ha', '^%f[%a](%a+) %1$') == 'ha')
			end

			-- ABI records: verify encoding bytes as well as independent decode positions.
			do
				local header<const> = '< !4 B H > h < f d c3'
				local format<const> = header .. ' s1 z'
				local payload<const> = string.char(65, 0, 66)
				local record<const> = string.pack(format, 1, 4660, -300, 1.25, -2.5, 'POSITION', payload, 'ready')
				assert(string.packsize(header) == 23)
				assert(record == string.char(1, 0, 52, 18, 254, 212, 0, 0, 0, 0, 160, 63,
					0, 0, 0, 0, 0, 0, 4, 192, 80, 79, 83, 3, 65, 0, 66, 114, 101, 97, 100, 121, 0))
				local version<const>, flags<const>, delta<const>, sample<const>, calibration<const>, tag<const>, next_header<const> =
					string.unpack(header, record)
				assert(version == 1 and flags == 4660 and delta == -300 and sample == 1.25 and calibration == -2.5 and tag == 'POS')
				local bytes<const>, status<const>, next_record<const> = string.unpack('s1 z', record, next_header)
				assert(next_header == 24 and next_record == 34 and bytes == payload and status == 'ready')
				assert(string.unpack('c4', string.pack('c4', 'OK')) == 'OK' .. string.char(0, 0))
				assert(not pcall(string.pack, 'B', 256) and not pcall(string.pack, 'z', payload) and not pcall(string.packsize, format))
			end

			-- Sequence mutation, holes and comparator failure identity.
			do
				local packed<const> = table.pack('a', nil, 3, nil)
				assert(packed.n == 4 and select('#', table.unpack(packed, 1, packed.n)) == 4)
				assert(table.concat(packed, '-', 1, packed.n) == 'a--3-')
				assert(select('#', table.unpack(packed, 3, 2)) == 0 and select('#', table.remove({})) == 1)
				local values<const> = { 4, 1, 3, 2 }
				assert(select('#', table.insert(values, 3, 42)) == 0 and table.remove(values, 3) == 42)
				local failure<const> = {}
				local ok<const>, seen<const> = pcall(table.sort, values, function() error(failure) end)
				assert(not ok and seen == failure and #values == 4)
				table.sort(values)
				assert(table.concat(values, ',') == '1,2,3,4')
				table.sort(values, function(a, b) return a > b end)
				assert(table.concat(values, ',') == '4,3,2,1')
			end

			-- Civil time conversions and format boundaries.
			do
				local noon<const> = { year = 1970, month = 1, day = 1, note = 'kept' }
				assert(os.time(noon) == 43200 and noon.hour == 12 and noon.wday == 5 and noon.isdst == false and noon.note == 'kept')
				local leap<const> = { year = 2024, month = 2, day = 28, hour = 25, min = 2, sec = 3 }
				assert(os.time(leap) == 1709168523 and leap.day == 29 and leap.hour == 1 and leap.yday == 60)
				local before<const> = os.date('*t', -1)
				assert(before.year == 1969 and before.day == 31 and before.sec == 59 and before.yday == 365)
				assert(os.date(nil, 0) == 'Thu Jan 01 00:00:00 1970')
				assert(os.date('!%F %T %z %Z', -1) == '1969-12-31 23:59:59 +0000 BMSX')
				assert(os.date('%F %G-W%V-%u', 1546214400) == '2018-12-31 2019-W01-1')
				assert(os.date('%Y %G-W%V %U %W', 1609506123) == '2021 2020-W53 00 00')
				assert(os.difftime(125, 20) == 105 and not pcall(os.difftime, 1.5, 1))
				assert(not pcall(os.time, { year = 1970.5, month = 1, day = 1 }) and not pcall(os.date, '%Q', 0))
			end

			-- Coroutine transfers preserve tuple holes, state and thrown objects.
			do
				local caller<const> = coroutine.running()
				local producer<const> = coroutine.create(function(a, b)
					local thread<const>, is_main<const> = coroutine.running()
					assert(not is_main and coroutine.isyieldable() and coroutine.status(thread) == 'running')
					assert(coroutine.status(caller) == 'normal')
					local x<const>, gap<const>, z<const> = coroutine.yield(a + b, nil, 'ready')
					assert(gap == nil)
					return x + z, nil, b
				end)
				assert(coroutine.status(producer) == 'suspended')
				local yielded<const> = table.pack(coroutine.resume(producer, 10, 3))
				assert(yielded.n == 4 and yielded[1] and yielded[2] == 13 and yielded[3] == nil and yielded[4] == 'ready')
				local returned<const> = table.pack(coroutine.resume(producer, 17, nil, 23))
				assert(returned.n == 4 and returned[1] and returned[2] == 40 and returned[3] == nil and returned[4] == 3)
				assert(coroutine.status(producer) == 'dead' and not coroutine.resume(producer))
				local failure<const> = {}
				local failed<const> = coroutine.create(function() error(failure) end)
				local resumed<const>, raised<const> = coroutine.resume(failed)
				local closed<const>, retained<const> = coroutine.close(failed)
				assert(not resumed and raised == failure and not closed and retained == failure and coroutine.close(failed))
				local read
				local abandoned<const> = coroutine.create(function()
					local value = 19
					read = function() return value end
					coroutine.yield()
					value = 20
				end)
				assert(coroutine.resume(abandoned) and coroutine.close(abandoned) and read() == 19)
				local wrapped<const> = coroutine.wrap(function() return coroutine.yield(12) end)
				assert(wrapped() == 12 and wrapped(34) == 34)
			end

			-- Advance the actual console clock on the same boot.
			local before_ms<const>, before_clock<const> = *time_ms, os.clock()
			t:wait_ticks(7)
			local after_ms<const> = *time_ms
			local delta<const> = after_ms - before_ms
			assert(delta >= 7, 'machine time did not advance')
			assert(math.abs(os.clock() - before_clock - delta / 1000) < 0.000001, 'os.clock delta mismatch')
			local seconds<const> = os.time()
			assert(seconds * 1000 <= after_ms and after_ms < (seconds + 1) * 1000, 'os.time machine-time mismatch')
		end,
	},
}
