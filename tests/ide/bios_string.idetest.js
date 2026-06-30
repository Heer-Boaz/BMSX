// Headless IDE test: selected string library functions execute as BIOS Lua.

const lengths = t.evaluateLua(`
return string.len('abc'), string.len('áβ'), ('áβ'):len(), #'áβ', type(string.byte), type(string.char)
`);
t.assert(lengths[0] === 3, `string.len ascii mismatch: ${lengths[0]}`);
t.assert(lengths[1] === 2, `string.len utf8 codepoint mismatch: ${lengths[1]}`);
t.assert(lengths[2] === 2, `string method len mismatch: ${lengths[2]}`);
t.assert(lengths[3] === 2, `string length operator mismatch: ${lengths[3]}`);
t.assert(lengths[4] === 'function', `string.byte should be a BIOS string function, got ${lengths[4]}`);
t.assert(lengths[5] === 'function', `string.char should be a BIOS string function, got ${lengths[5]}`);

const cases = t.evaluateLua(`
return string.upper('Az-09áβ'), string.lower('Az-09áβ'), ('aBc'):upper(), ('AbC'):lower()
`);
t.assert(cases[0] === 'AZ-09áβ', `string.upper ASCII mapping mismatch: ${cases[0]}`);
t.assert(cases[1] === 'az-09áβ', `string.lower ASCII mapping mismatch: ${cases[1]}`);
t.assert(cases[2] === 'ABC', `string method upper mismatch: ${cases[2]}`);
t.assert(cases[3] === 'abc', `string method lower mismatch: ${cases[3]}`);

const slices = t.evaluateLua(`
return string.sub('aβc', 2, 2), string.sub('abcd', -2), string.sub('abcd', 2, 0), ('aβc'):sub(2, 3), string.sub('abcd', 1, 0)
`);
t.assert(slices[0] === 'β', `string.sub utf8 slice mismatch: ${slices[0]}`);
t.assert(slices[1] === 'cd', `string.sub negative start mismatch: ${slices[1]}`);
t.assert(slices[2] === '', `string.sub zero end mismatch: ${slices[2]}`);
t.assert(slices[3] === 'βc', `string method sub mismatch: ${slices[3]}`);
t.assert(slices[4] === '', `string.sub zero end at start mismatch: ${slices[4]}`);

const reversed = t.evaluateLua(`
return string.reverse('aβc'), ('stressed'):reverse(), string.reverse(''), string.reverse('x')
`);
t.assert(reversed[0] === 'cβa', `string.reverse utf8 reverse mismatch: ${reversed[0]}`);
t.assert(reversed[1] === 'desserts', `string method reverse mismatch: ${reversed[1]}`);
t.assert(reversed[2] === '', `string.reverse empty mismatch: ${reversed[2]}`);
t.assert(reversed[3] === 'x', `string.reverse single-character mismatch: ${reversed[3]}`);

const repeated = t.evaluateLua(`
return string.rep('ab', 3), string.rep('x', 3, '-'), string.rep('x', 2.9), string.rep('x', 0), string.rep('', 3, ','), string.rep('z')
`);
t.assert(repeated[0] === 'ababab', `string.rep repeated value mismatch: ${repeated[0]}`);
t.assert(repeated[1] === 'x-x-x', `string.rep separator mismatch: ${repeated[1]}`);
t.assert(repeated[2] === 'xx', `string.rep fractional count mismatch: ${repeated[2]}`);
t.assert(repeated[3] === '', `string.rep zero count mismatch: ${repeated[3]}`);
t.assert(repeated[4] === ',,', `string.rep empty value separator mismatch: ${repeated[4]}`);
t.assert(repeated[5] === 'z', `string.rep default count mismatch: ${repeated[5]}`);


const formatted = t.evaluateLua(`
return string.format('enemy_%03d_%02d', 7, 4),
	string.format('%08Xh', 0x1af),
	string.format('%-6s:%+04d', 'hp', 7),
	string.format('%.1f MB', 1.25),
	string.format('%.3f|%g|%e|%G', -2.5, 1234.0, 12.5, 0.00125),
	string.format('%q', 'a\\nb"c'),
	string.format('%*.*f', 8, 2, 3.5),
	string.format('%#x|%#o|%.0f|%#.0f', 26, 9, 1.2, 1.2)
`);
t.assert(formatted[0] === 'enemy_007_04', `string.format zero-padded ids mismatch: ${formatted[0]}`);
t.assert(formatted[1] === '000001AFh', `string.format uppercase hex mismatch: ${formatted[1]}`);
t.assert(formatted[2] === 'hp    :+007', `string.format padding/sign mismatch: ${formatted[2]}`);
t.assert(formatted[3] === '1.3 MB', `string.format fixed precision mismatch: ${formatted[3]}`);
t.assert(formatted[4] === '-2.500|1234|1.250000e+01|0.00125', `string.format float forms mismatch: ${formatted[4]}`);
t.assert(formatted[5] === '"a\\nb\\"c"', `string.format quote mismatch: ${formatted[5]}`);
t.assert(formatted[6] === '    3.50', `string.format star width/precision mismatch: ${formatted[6]}`);
t.assert(formatted[7] === '0x1a|011|1|1.', `string.format alternate forms mismatch: ${formatted[7]}`);

const packed = t.evaluateLua(`
local packed<const> = string.pack('<bBhHi4I2', -2, 250, -300, 60000, -123456, 513)
local a<const>, b<const>, c<const>, d<const>, e<const>, f<const>, next_index<const> = string.unpack('<bBhHi4I2', packed)
local strings<const> = string.pack('<c4zs2', 'ab', 'hi', 'xyz')
local fixed<const>, zed<const>, sized<const>, string_next<const> = string.unpack('<c4zs2', strings)
local float_blob<const> = string.pack('<fd', 1.5, -2.25)
local f32<const>, f64<const>, float_next<const> = string.unpack('<fd', float_blob)
local variable_size_ok<const> = pcall(function() return string.packsize('z') end)
return #packed,
	string.byte(packed, 1), string.byte(packed, 2), string.byte(packed, 3), string.byte(packed, 4),
	a, b, c, d, e, f, next_index,
	string.packsize('<bHI4'), #strings, string.byte(strings, 3), string.byte(strings, 7),
	fixed, zed, sized, string_next,
	f32, f64, float_next, variable_size_ok
`);
t.assert(packed[0] === 14, `string.pack integer blob length mismatch: ${packed[0]}`);
t.assert(packed[1] === 254, `string.pack signed byte mismatch: ${packed[1]}`);
t.assert(packed[2] === 250, `string.pack unsigned byte mismatch: ${packed[2]}`);
t.assert(packed[3] === 212, `string.pack signed half low byte mismatch: ${packed[3]}`);
t.assert(packed[4] === 254, `string.pack signed half high byte mismatch: ${packed[4]}`);
t.assert(packed[5] === -2, `string.unpack signed byte mismatch: ${packed[5]}`);
t.assert(packed[6] === 250, `string.unpack unsigned byte mismatch: ${packed[6]}`);
t.assert(packed[7] === -300, `string.unpack signed half mismatch: ${packed[7]}`);
t.assert(packed[8] === 60000, `string.unpack unsigned half mismatch: ${packed[8]}`);
t.assert(packed[9] === -123456, `string.unpack signed int mismatch: ${packed[9]}`);
t.assert(packed[10] === 513, `string.unpack explicit unsigned size mismatch: ${packed[10]}`);
t.assert(packed[11] === 15, `string.unpack next index mismatch: ${packed[11]}`);
t.assert(packed[12] === 8, `string.packsize aligned integer mismatch: ${packed[12]}`);
t.assert(packed[13] === 13, `string.pack string blob length mismatch: ${packed[13]}`);
t.assert(packed[14] === 0, `string.pack fixed string padding mismatch: ${packed[14]}`);
t.assert(packed[15] === 0, `string.pack zero terminator mismatch: ${packed[15]}`);
t.assert(packed[16] === 'ab\u0000\u0000', `string.unpack fixed string mismatch: ${packed[16]}`);
t.assert(packed[17] === 'hi', `string.unpack zero string mismatch: ${packed[17]}`);
t.assert(packed[18] === 'xyz', `string.unpack sized string mismatch: ${packed[18]}`);
t.assert(packed[19] === 14, `string.unpack string next index mismatch: ${packed[19]}`);
t.assert(Math.abs(packed[20] - 1.5) < 0.000001, `string.unpack float32 mismatch: ${packed[20]}`);
t.assert(packed[21] === -2.25, `string.unpack float64 mismatch: ${packed[21]}`);
t.assert(packed[22] === 17, `string.unpack float next index mismatch: ${packed[22]}`);
t.assert(packed[23] === false, 'string.packsize should reject variable-length formats');

const patterns = t.evaluateLua(`
local f1<const>, f2<const> = string.find('hello β world', 'β', 1, true)
local id_ok<const> = ('alpha_09'):match('^[A-Za-z_][A-Za-z0-9_]*$')
local id_bad<const> = ('9alpha'):match('^[A-Za-z_][A-Za-z0-9_]*$')
local machine_id<const>, state_path<const> = string.match('combat:/root/intro', '^(.-):/(.+)$')
local parts<const> = {}
for part in string.gmatch('a.b.c', '[^%.]+') do
	parts[#parts + 1] = part
end
local lines<const> = {}
for line in ('one\\ntwo\\r\\nthree'):gmatch('[^\\r\\n]+') do
	lines[#lines + 1] = line
end
local patched<const>, patch_count<const> = string.gsub('a$b$c', '%$', '.')
local trim_left<const> = string.gsub('   x', '^%s+', '')
local trim_right<const> = string.gsub('x   ', '%s+$', '')
local replaced_capture<const> = string.gsub('item42', '(%a+)(%d+)', '%2:%1')
local balanced<const> = string.match('pre(a(b)c)post', '%b()')
local frontier_first<const>, frontier_second<const> = string.match('one two', '(%f[%a]%a+)%s+(%f[%a]%a+)')
local repeated_word<const> = string.match('ha ha', '^(%a+) %1$')
local position<const>, positioned_word<const> = string.match('abc123', '()%d+(%d%d)$')
return f1, f2, id_ok, id_bad, machine_id, state_path,
	parts[1], parts[2], parts[3], parts[4],
	lines[1], lines[2], lines[3], lines[4],
	patched, patch_count, trim_left, trim_right, replaced_capture,
	balanced, frontier_first, frontier_second, repeated_word, position, positioned_word
`);
t.assert(patterns[0] === 7, `plain string.find start mismatch: ${patterns[0]}`);
t.assert(patterns[1] === 7, `plain string.find finish mismatch: ${patterns[1]}`);
t.assert(patterns[2] === 'alpha_09', `identifier pattern positive mismatch: ${patterns[2]}`);
t.assert(patterns[3] === null, `identifier pattern negative mismatch: ${patterns[3]}`);
t.assert(patterns[4] === 'combat', `machine-id capture mismatch: ${patterns[4]}`);
t.assert(patterns[5] === 'root/intro', `state-path capture mismatch: ${patterns[5]}`);
t.assert(patterns[6] === 'a', `path part 1 mismatch: ${patterns[6]}`);
t.assert(patterns[7] === 'b', `path part 2 mismatch: ${patterns[7]}`);
t.assert(patterns[8] === 'c', `path part 3 mismatch: ${patterns[8]}`);
t.assert(patterns[9] === null, `path part overflow mismatch: ${patterns[9]}`);
t.assert(patterns[10] === 'one', `line 1 mismatch: ${patterns[10]}`);
t.assert(patterns[11] === 'two', `line 2 mismatch: ${patterns[11]}`);
t.assert(patterns[12] === 'three', `line 3 mismatch: ${patterns[12]}`);
t.assert(patterns[13] === null, `line overflow mismatch: ${patterns[13]}`);
t.assert(patterns[14] === 'a.b.c', `gsub escaped percent mismatch: ${patterns[14]}`);
t.assert(patterns[15] === 2, `gsub escaped percent count mismatch: ${patterns[15]}`);
t.assert(patterns[16] === 'x', `left trim pattern mismatch: ${patterns[16]}`);
t.assert(patterns[17] === 'x', `right trim pattern mismatch: ${patterns[17]}`);
t.assert(patterns[18] === '42:item', `capture replacement mismatch: ${patterns[18]}`);
t.assert(patterns[19] === '(a(b)c)', `balanced pattern mismatch: ${patterns[19]}`);
t.assert(patterns[20] === 'one', `frontier first word mismatch: ${patterns[20]}`);
t.assert(patterns[21] === 'two', `frontier second word mismatch: ${patterns[21]}`);
t.assert(patterns[22] === 'ha', `capture backreference mismatch: ${patterns[22]}`);
t.assert(patterns[23] === 4, `position capture mismatch: ${patterns[23]}`);
t.assert(patterns[24] === '23', `positioned word capture mismatch: ${patterns[24]}`);
