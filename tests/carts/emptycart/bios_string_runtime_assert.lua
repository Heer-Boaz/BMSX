__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()
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
end

function __bmsx_host_test.update(_frame)
	return true
end
