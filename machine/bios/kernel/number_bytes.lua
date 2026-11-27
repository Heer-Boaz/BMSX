module<const>

-- Source basis: aca57683b. D: machine/cpp/common/number_format.h;
-- E: machine/ts/common/number_format.ts. Bytes, not Strings: the caller
-- can hash, compare or copy the span without an allocator or interner.
local words<const> = require('kernel/word_arithmetic') -- D:91-93 E:75
local allocator<const> = require('kernel/dlmalloc') -- D:102 E:82
local sign_bit<const> = 0x80000000 -- D:24,26,44,52 E:12-14,31,38
local ascii_zero<const> = 48 -- D:109,117,123 E:88,93,98
local minus<const> = 45 -- D:99-100,111,121 E:79-80,90,97
local point_byte<const> = 46 -- D:116-121 E:93-97

struct number_workspace
	numerator: u32[5] -- D:15,60 E:7,46
	denominator: u32[5] -- D:15,60 E:7,46
	shifted: u32[5] -- D:15,60 E:7,64
	digits: u8[7] -- D:108-110 E:88-89
	text: u8[24] -- D:92,111; one caller-owned span with no termination byte
end

-- First binary32 word not less than exact 10^-45 through 10^39.
rodata exponent_powers: u32[85] = { -- D:17 E:6
	0x00000001, 0x00000008, 0x00000048, 0x000002ca, 0x00001be1, 0x000116c3, 0x000ae398, -- D:17 E:6
	0x006ce3ef, 0x02081ceb, 0x03aa2425, 0x0554ad2e, 0x0704ec3d, 0x08a6274c, 0x0a4fb11f, -- D:17 E:6
	0x0c01ceb4, 0x0da24260, 0x0f4ad2f8, 0x10fd87b6, 0x129e74d2, 0x14461207, 0x15f79688, -- D:17 E:6
	0x179abe15, 0x19416d9b, 0x1af1c901, 0x1c971da1, 0x1e3ce509, 0x1fec1e4b, 0x219392ef, -- D:17 E:6
	0x233877ab, 0x24e69595, 0x26901d7d, 0x283424dd, 0x29e12e14, 0x2b8cbccd, 0x2d2fec00, -- D:17 E:6
	0x2edbe6ff, 0x30897060, 0x322bcc78, 0x33d6bf95, 0x358637be, 0x3727c5ad, 0x38d1b718, -- D:17 E:6
	0x3a83126f, 0x3c23d70b, 0x3dcccccd, 0x3f800000, 0x41200000, 0x42c80000, 0x447a0000, -- D:17 E:6
	0x461c4000, 0x47c35000, 0x49742400, 0x4b189680, 0x4cbebc20, 0x4e6e6b28, 0x501502f9, -- D:17 E:6
	0x51ba43b8, 0x5368d4a6, 0x551184e8, 0x56b5e621, 0x58635faa, 0x5a0e1bca, 0x5bb1a2bd, -- D:17 E:6
	0x5d5e0b6c, 0x5f0ac724, 0x60ad78ec, 0x6258d727, 0x64078679, 0x65a96817, 0x6753c21c, -- D:17 E:6
	0x69045952, 0x6aa56fa6, 0x6c4ecb90, 0x6e013f3a, 0x6fa18f08, 0x7149f2ca, 0x72fc6f7d, -- D:17 E:6
	0x749dc5ae, 0x7645371a, 0x77f684e0, 0x799a130c, 0x7b4097cf, 0x7cf0bdc3, 0x7e96769a, -- D:17 E:6
	0x7f800000, -- D:17 E:6
} -- D:17 E:6

local multiply_five<const> = function(address, count) -- D:18-29 E:8-16
	local value<const>: *u32 = address -- D:21 E:12
	for j = 0, count - 1 do -- D:19 E:9
		local carry = 0 -- D:20 E:10
		for i = 0, 4 do -- D:21 E:11
			local prior<const> = value[i] -- D:22 E:12
			local next_value = (prior << 2) + prior -- D:23 E:12
			local high<const> = (prior >> 30) + ((next_value ~ sign_bit) < (prior ~ sign_bit) and 1 or 0) -- D:24 E:12-13
			local before_carry<const> = next_value -- D:25 E:12
			next_value = next_value + carry -- D:25 E:12
			carry = high + ((next_value ~ sign_bit) < (before_carry ~ sign_bit) and 1 or 0) -- D:26 E:13
			value[i] = next_value -- D:26 E:13
		end
	end
end

local shift_left<const> = function(address, count) -- D:30-38 E:17-25
	local value<const>: *u32 = address -- D:34 E:21
	local whole<const>, bits<const> = count >> 5, count & 31 -- D:31 E:18
	for i = 4, 0, -1 do -- D:32 E:19
		local source<const> = i - whole -- D:33 E:20
		local next_value = source >= 0 and (value[source] << bits) or 0 -- D:34 E:21
		if bits ~= 0 and source > 0 then next_value = next_value | (value[source - 1] >> (32 - bits)) end -- D:35 E:22
		value[i] = next_value -- D:36 E:23
	end
end

local shift_right_one<const> = function(address) -- D:39-42 E:26-29
	local value<const>: *u32 = address -- D:40 E:27
	for i = 0, 3 do value[i] = (value[i] >> 1) | (value[i + 1] << 31) end -- D:40 E:27
	value[4] = value[4] >> 1 -- D:41 E:28
end

local compare<const> = function(left_address, right_address) -- D:43-46 E:30-33
	local left<const>: *u32 = left_address -- D:44 E:31
	local right<const>: *u32 = right_address -- D:44 E:31
	for i = 4, 0, -1 do -- D:44 E:31
		local a<const>, b<const> = left[i], right[i] -- D:44 E:31
		if a ~= b then return (a ~ sign_bit) < (b ~ sign_bit) and -1 or 1 end -- D:44 E:31
	end
	return 0 -- D:45 E:32
end

local subtract<const> = function(left_address, right_address) -- D:47-54 E:34-40
	local left<const>: *u32 = left_address -- D:50 E:37
	local right<const>: *u32 = right_address -- D:50 E:37
	local borrow = 0 -- D:48 E:35
	for i = 0, 4 do -- D:49 E:36
		local a<const>, b<const> = left[i], right[i] -- D:50 E:37
		left[i] = a - b - borrow -- D:51 E:37-38
		borrow = ((a ~ sign_bit) < (b ~ sign_bit) or (borrow ~= 0 and a == b)) and 1 or 0 -- D:52 E:38
	end
end

local digits<const> = function(workspace, magnitude, decimal_exponent) -- D:55-89 E:41-74
	local encoded<const> = magnitude >> 23 -- D:56 E:42
	local mantissa<const> = (magnitude & 0x7fffff) | (encoded == 0 and 0 or 0x800000) -- D:57 E:43
	local exponent<const> = encoded == 0 and -149 or encoded - 150 -- D:58 E:44
	local scale<const> = 6 - decimal_exponent -- D:59 E:45
	local numerator<const> = workspace + offsetof(number_workspace.numerator) -- D:60 E:7,46
	local denominator<const> = workspace + offsetof(number_workspace.denominator) -- D:60 E:7,46
	local shifted<const> = workspace + offsetof(number_workspace.shifted) -- D:60,79 E:7,64
	local n<const>: *u32 = numerator -- D:60 E:46
	local d<const>: *u32 = denominator -- D:60 E:46
	local s<const>: *u32 = shifted -- D:60,79 E:64
	n[0], d[0] = mantissa, 1 -- D:60 E:46
	for i = 1, 4 do n[i], d[i] = 0, 0 end -- D:60 E:46; remaining limbs of both aggregates
	if scale >= 0 then -- D:61 E:47
		multiply_five(numerator, scale) -- D:62 E:48
		local shift<const> = -(exponent + scale) -- D:63 E:49
		local index<const>, bit<const> = shift >> 5, shift & 31 -- D:63 E:49
		local quotient = n[index] >> bit -- D:64 E:50
		if bit ~= 0 then quotient = quotient | (n[index + 1] << (32 - bit)) end -- D:65 E:51
		if shift ~= 0 then -- D:66 E:52
			local half_index<const>, half_bit<const> = (shift - 1) >> 5, (shift - 1) & 31 -- D:67 E:53
			local half<const> = ((n[half_index] >> half_bit) & 1) ~= 0 -- D:68 E:54
			local sticky = half_bit ~= 0 and (n[half_index] & (0xffffffff >> (32 - half_bit))) ~= 0 -- D:69 E:55
			for i = 0, half_index - 1 do sticky = sticky or n[i] ~= 0 end -- D:70 E:56
			if half and (sticky or (quotient & 1) ~= 0) then quotient = quotient + 1 end -- D:71 E:57
		end
		return quotient -- D:73 E:59
	end
	local power<const> = -scale -- D:75 E:61
	multiply_five(denominator, power) -- D:76 E:62
	if exponent >= power then shift_left(numerator, exponent - power) -- D:77 E:63
	else shift_left(denominator, power - exponent) end -- D:78 E:63
	for i = 0, 4 do s[i] = d[i] end -- D:79 E:64
	shift_left(shifted, 23) -- D:79 E:64
	local quotient = 0 -- D:80 E:65
	for bit = 23, 0, -1 do -- D:81 E:66
		if compare(numerator, shifted) >= 0 then -- D:82 E:67
			subtract(numerator, shifted) -- D:82 E:67
			quotient = quotient | (1 << bit) -- D:82 E:67
		end
		shift_right_one(shifted) -- D:83 E:68
	end
	shift_left(numerator, 1) -- D:85 E:70
	local half<const> = compare(numerator, denominator) -- D:86 E:71
	if half > 0 or (half == 0 and (quotient & 1) ~= 0) then quotient = quotient + 1 end -- D:87 E:72
	return quotient -- D:88 E:73
end

local format_integer<const> = function(value, workspace) -- D:91-94 E:75
	local start<const> = workspace + offsetof(number_workspace.text) -- D:91-93 E:75
	local output<const>: *u8 = start -- D:91-93 E:75
	local negative<const> = value < 0 -- D:91-93 E:75
	local current, cursor = negative and -value or value, 11 -- D:91-93 E:75
	repeat -- D:92 E:75; std::to_chars/decimal spelling into the caller's storage
		local quotient<const> = words.internal.divide_word(current, 10) -- D:92 E:75; unsigned magnitude also holds abs(-2^31)
		cursor = cursor - 1 -- D:92 E:75
		output[cursor] = ascii_zero + (current - 10 * quotient) -- D:92 E:75
		current = quotient -- D:92 E:75
	until current == 0 -- D:92 E:75
	if negative then cursor = cursor - 1; output[cursor] = minus end -- D:92 E:75
	return start + cursor, 11 - cursor -- D:93 E:75
end

local format_float<const> = function(bits, workspace) -- D:95-126 E:76-99
	local magnitude<const> = bits & 0x7fffffff -- D:97 E:77; payload is already binary32
	local start<const> = workspace + offsetof(number_workspace.text) -- D:111 E:90
	local out<const>: *u8 = start -- D:111 E:90
	if magnitude > 0x7f800000 then -- D:98 E:78
		out[0], out[1], out[2] = 110, 97, 110 -- D:98 E:78; nan, independent of sign
		return start, 3 -- D:98 E:78
	end
	local cursor = 0 -- D:111 E:90
	if bits < 0 then out[0] = minus; cursor = 1 end -- D:99-100,111 E:79-80,90
	if magnitude == 0x7f800000 then -- D:99 E:79
		out[cursor], out[cursor + 1], out[cursor + 2] = 105, 110, 102 -- D:99 E:79
		return start, cursor + 3 -- D:99 E:79
	end
	if magnitude == 0 then -- D:100 E:80
		out[cursor], out[cursor + 1], out[cursor + 2] = ascii_zero, point_byte, ascii_zero -- D:100 E:80
		return start, cursor + 3 -- D:100 E:80
	end
	local encoded<const> = magnitude >> 23 -- D:101 E:81
	local binary<const> = encoded == 0 and allocator.internal.highest_bit(magnitude) - 149 or encoded - 127 -- D:102 E:82
	local decimal = (binary * 78913) // (1 << 18) -- D:103 E:83; signed shift via floor division
	local powers<const>: *u32 = &exponent_powers[0] -- D:104-105 E:84-85
	if magnitude >= powers[decimal + 46] then decimal = decimal + 1 -- D:104 E:84
	elseif magnitude < powers[decimal + 45] then decimal = decimal - 1 end -- D:105 E:85
	local significand = digits(workspace, magnitude, decimal) -- D:106 E:86
	if significand == 10000000 then significand = 1000000; decimal = decimal + 1 end -- D:107 E:87
	local text<const>: *u8 = workspace + offsetof(number_workspace.digits) -- D:108 E:88
	for i = 6, 0, -1 do -- D:109 E:88
		local quotient<const> = significand // 10 -- D:109 E:88
		text[i] = ascii_zero + significand - quotient * 10 -- D:109 E:88
		significand = quotient -- D:109 E:88
	end
	local last = 7 -- D:110 E:89
	while last > 1 and text[last - 1] == ascii_zero do last = last - 1 end -- D:110 E:89
	if decimal >= -4 and decimal < 7 then -- D:112 E:91
		local point<const> = decimal + 1 -- D:113 E:92
		if point > 0 then -- D:114 E:93
			for i = 0, point - 1 do out[cursor + i] = text[i] end -- D:115 E:93
			cursor = cursor + point -- D:115 E:93
			out[cursor] = point_byte -- D:116-117 E:93
			cursor = cursor + 1 -- D:116 E:93
			if last > point then -- D:116 E:93
				for i = point, last - 1 do out[cursor + i - point] = text[i] end -- D:116 E:93
				cursor = cursor + last - point -- D:116 E:93
			else -- D:117 E:93
				out[cursor] = ascii_zero -- D:117 E:93
				cursor = cursor + 1 -- D:117 E:93
			end
		else -- D:118 E:94
			out[cursor], out[cursor + 1] = ascii_zero, point_byte -- D:118 E:95
			cursor = cursor + 2 -- D:118 E:95
			for i = 0, -point - 1 do out[cursor + i] = ascii_zero end -- D:118 E:95
			cursor = cursor - point -- D:118 E:95
			for i = 0, last - 1 do out[cursor + i] = text[i] end -- D:118 E:95
			cursor = cursor + last -- D:118 E:95
		end
	else -- D:119 E:96-98
		out[cursor] = text[0] -- D:120 E:97
		cursor = cursor + 1 -- D:120 E:97
		if last > 1 then -- D:120 E:97
			out[cursor] = point_byte -- D:120 E:97
			for i = 1, last - 1 do out[cursor + i] = text[i] end -- D:120 E:97
			cursor = cursor + last -- D:120 E:97
		end
		out[cursor], out[cursor + 1] = 101, decimal < 0 and minus or 43 -- D:121 E:97; e-
		local exponent<const> = decimal < 0 and -decimal or decimal -- D:122 E:96
		local tens<const> = exponent // 10 -- D:123 E:98
		out[cursor + 2], out[cursor + 3] = ascii_zero + tens, ascii_zero + exponent - tens * 10 -- D:123 E:98
		cursor = cursor + 4 -- D:121-125 E:97-98
	end
	return start, cursor -- D:125 E:93-98
end

return {
	internal = {
		multiply_five = multiply_five, shift_left = shift_left, shift_right_one = shift_right_one,
		compare = compare, subtract = subtract, digits = digits,
	},
	format_integer = format_integer, format_float = format_float,
}
