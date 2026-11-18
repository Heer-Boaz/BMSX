local string<const> = require('string/base')
local table<const> = require('table')
local byte<const> = string.byte
local char<const> = string.char
local sub<const> = string.sub
local concat<const> = table.concat
local unpack<const> = table.unpack
local decode_float<const> = require('string/float/decode')
local encode_float<const> = require('string/float/encode')

local tointeger<const> = __bmsx_tointeger
local max_size<const> = 0x7fffffff
local default_int_size<const> = 4
local default_long_size<const> = 4
local default_size_t_size<const> = 4
local lua_integer_size<const> = 4
local default_pack_align<const> = 8
local pack_little_endian<const> = true
local pack_fixed_int_size<const> = { b = 1, ['B'] = 1, h = 2, ['H'] = 2, l = default_long_size, ['L'] = default_long_size, j = lua_integer_size, ['J'] = lua_integer_size }
local pack_sized_int_token<const> = { i = true, ['I'] = true }
local pack_signed_int_token<const> = { b = true, h = true, l = true, j = true, i = true }
local pack_float_size<const> = { f = 4, d = 8, n = 4 }
local pack_control_kind<const> = { endian = true, align_set = true }
local pack_skip_align_kind<const> = { pad = true, align_next = true }
local pack_variable_size_kind<const> = { z = true, len = true }

local pack_align_padding<const> = function(offset, align)
	if align <= 1 then
		return 0
	end
	return (align - (offset % align)) % align
end

local pack_is_space<const> = function(code)
	return code == 32 or (code >= 9 and code <= 13)
end

local pack_digit<const> = function(code)
	if code >= 48 and code <= 57 then
		return code - 48
	end
	return nil
end

local pack_read_number<const> = function(format, index)
	local value = 0
	local found = false
	while index <= #format do
		local digit<const> = pack_digit(byte(format, index))
		if digit == nil then
			break
		end
		found = true
		if value > 214748364 or (value == 214748364 and digit > 7) then
			error('string.pack format count out of range.')
		end
		value = value * 10 + digit
		index = index + 1
	end
	return value, index, found
end

-- Write one word plus its explicitly selected high-byte extension. The
-- endian loop chooses positions, never a wide divisor or floating arithmetic.
local pack_write_word<const> = function(out, word, size, little_endian, extension)
	local index = little_endian and 0 or size - 1
	local step<const> = little_endian and 1 or -1
	for _ = 1, size do
		local digit = extension
		if index < 4 then digit = (word >> (index * 8)) & 0xff end
		out[#out + 1] = char(digit)
		index = index + step
	end
end

local pack_write_int<const> = function(out, raw_value, size, signed, little_endian)
	local value<const> = tointeger(raw_value)
	if value == nil then error('string.pack integer value must be an integer.') end
	if size < 4 then
		local limit<const> = 1 << (size * 8 - (signed and 1 or 0))
		if (signed and (value < -limit or value >= limit)) or (not signed and (value < 0 or value >= limit)) then
			error('string.pack integer value out of range.')
		end
	end
	pack_write_word(out, value, size, little_endian, signed and value < 0 and 255 or 0)
end

-- Codepoints are base-256 digits, not necessarily octets. Up to eight such
-- digits need three words. Half-word carries stay within one signed Integer;
-- no overflow is discarded until a consumer explicitly selects a raw word.
local pack_read_words<const> = function(source, offset, size, little_endian)
	local low = 0
	local high = 0
	local top = 0
	local index = little_endian and size or 1
	local step<const> = little_endian and -1 or 1
	for _ = 1, size do
		local digit<const> = byte(source, offset + index)
		local low_half<const> = (low & 0xffff) * 256 + digit
		local low_upper<const> = (low >> 16) * 256 + (low_half >> 16)
		low = (low_upper << 16) | (low_half & 0xffff)
		local high_half<const> = (high & 0xffff) * 256 + (low_upper >> 16)
		local high_upper<const> = (high >> 16) * 256 + (high_half >> 16)
		high = (high_upper << 16) | (high_half & 0xffff)
		top = (top << 8) + (high_upper >> 16)
		index = index + step
	end
	return low, high, top
end

local pack_read_int<const> = function(source, offset, size, signed, little_endian)
	local low<const>, high<const>, top<const> = pack_read_words(source, offset, size, little_endian)
	if not signed then
		if high == 0 and top == 0 then return low end
	elseif size < 4 then
		if high == 0 and top == 0 then
			local width<const> = 1 << (size * 8)
			if low < 0 or low >= (width >> 1) then
				if (low ~ 0x80000000) <= ((max_size + width) ~ 0x80000000) then return low - width end
			else return low end
		end
	else
		if low >= 0 and high == 0 and top == 0 then return low end
		local width_high = 0
		local width_top = 1
		if size < 8 then width_high = 1 << ((size - 4) * 8); width_top = 0 end
		if low < 0 and high == width_high - 1 and top == 0 then return low end
		if low >= 0 and high == width_high and top == width_top then return low end
	end
	error('string.unpack integer exceeds safe integer range.')
end

local pack_write_float_bits<const> = function(out, value, byte_count, little_endian)
	if byte_count == 4 then
		pack_write_word(out, encode_float(value, byte_count), byte_count, little_endian, 0)
		return
	end
	local high<const>, low<const> = encode_float(value, byte_count)
	if little_endian then
		pack_write_word(out, low, 4, true, 0)
		pack_write_word(out, high, 4, true, 0)
	else
		pack_write_word(out, high, 4, false, 0)
		pack_write_word(out, low, 4, false, 0)
	end
end

-- A floating field supplies raw words, so carries beyond each word are
-- discarded here rather than computing the wide integer decoder's range data.
local pack_read_word<const> = function(source, offset, little_endian)
	local word = 0
	local index = little_endian and 4 or 1
	local step<const> = little_endian and -1 or 1
	for _ = 1, 4 do
		word = (word << 8) + byte(source, offset + index)
		index = index + step
	end
	return word
end

local pack_read_float_bits<const> = function(source, offset, byte_count, little_endian)
	if byte_count == 4 then
		local bits<const> = pack_read_word(source, offset, little_endian)
		return decode_float(bits, 0, byte_count)
	end
	local high
	local low
	if little_endian then
		low = pack_read_word(source, offset, true)
		high = pack_read_word(source, offset + 4, true)
	else
		high = pack_read_word(source, offset, false)
		low = pack_read_word(source, offset + 4, false)
	end
	return decode_float(high, low, byte_count)
end

local pack_token<const> = function(format, index, little_endian, max_align)
	while index <= #format and pack_is_space(byte(format, index)) do
		index = index + 1
	end
	if index > #format then
		return nil, index, little_endian, max_align
	end
	local token<const> = sub(format, index, index)
	if token == '<' then
		return 'endian', index + 1, true, max_align
	end
	if token == '>' then
		return 'endian', index + 1, false, max_align
	end
	if token == '=' then
		return 'endian', index + 1, pack_little_endian, max_align
	end
	if token == '!' then
		local value<const>, next_index<const>, found<const> = pack_read_number(format, index + 1)
		if not found or value <= 0 then
			error('string.pack alignment must be a positive integer.')
		end
		return 'align_set', next_index, little_endian, value
	end
	if token == 'x' then
		return 'pad', index + 1, little_endian, max_align, 1
	end
	if token == 'X' then
		return 'align_next', index + 1, little_endian, max_align
	end
	local fixed_int_size<const> = pack_fixed_int_size[token]
	if fixed_int_size ~= nil then
		return 'int', index + 1, little_endian, max_align, fixed_int_size, pack_signed_int_token[token] or false, max_align < fixed_int_size and max_align or fixed_int_size
	end
	if token == 'T' then
		return 'int', index + 1, little_endian, max_align, default_size_t_size, false, default_size_t_size
	end
	if pack_sized_int_token[token] then
		local size<const>, next_index<const>, found<const> = pack_read_number(format, index + 1)
		local actual_size<const> = found and size or default_int_size
		if actual_size < 1 or actual_size > 8 then
			error('string.pack invalid integer size.')
		end
		local align<const> = max_align < actual_size and max_align or actual_size
		return 'int', next_index, little_endian, max_align, actual_size, pack_signed_int_token[token] or false, align
	end
	local float_size<const> = pack_float_size[token]
	if float_size ~= nil then
		return 'float', index + 1, little_endian, max_align, float_size, max_align < float_size and max_align or float_size
	end
	if token == 'c' then
		local size<const>, next_index<const>, found<const> = pack_read_number(format, index + 1)
		if not found then
			error('string.pack expected a size for c format.')
		end
		return 'fixed', next_index, little_endian, max_align, size
	end
	if token == 'z' then
		return 'z', index + 1, little_endian, max_align
	end
	if token == 's' then
		local size<const>, next_index<const>, found<const> = pack_read_number(format, index + 1)
		local actual_size<const> = found and size or default_size_t_size
		if actual_size < 1 or actual_size > 8 then
			error('string.pack invalid length size.')
		end
		local align<const> = max_align < actual_size and max_align or actual_size
		return 'len', next_index, little_endian, max_align, actual_size, align
	end
	error('string.pack unsupported format option.')
end

local pack_next_align<const> = function(format, index, little_endian, max_align)
	while true do
		local kind<const>, next_index<const>, next_little<const>, next_max_align<const>, a<const>, b<const>, c<const> = pack_token(format, index, little_endian, max_align)
		if kind == nil then
			return 1
		end
		if pack_control_kind[kind] then
			index = next_index
			little_endian = next_little
			max_align = next_max_align
		elseif not pack_skip_align_kind[kind] then
			return c or b or a or 1
		else
			index = next_index
		end
	end
end

local pack_emit_padding<const> = function(out, offset, align)
	local padding<const> = pack_align_padding(offset, align)
	for index = 1, padding do
		out[#out + 1] = char(0)
	end
	return offset + padding
end


local pack<const> = function(format, ...)
	local out<const> = {}
	local index = 1
	local offset = 0
	local little_endian = pack_little_endian
	local max_align = default_pack_align
	local arg_index = 1
	while true do
		local kind<const>, next_index<const>, next_little<const>, next_max_align<const>, a<const>, b<const>, c<const> = pack_token(format, index, little_endian, max_align)
		if kind == nil then
			break
		end
		index = next_index
		little_endian = next_little
		max_align = next_max_align
		if kind == 'pad' then
			out[#out + 1] = char(0)
			offset = offset + 1
		elseif kind == 'align_next' then
			offset = pack_emit_padding(out, offset, pack_next_align(format, index, little_endian, max_align))
		elseif kind == 'int' then
			offset = pack_emit_padding(out, offset, c)
			pack_write_int(out, (select(arg_index, ...)), a, b, little_endian)
			arg_index = arg_index + 1
			offset = offset + a
		elseif kind == 'float' then
			offset = pack_emit_padding(out, offset, b)
			pack_write_float_bits(out, (select(arg_index, ...)), a, little_endian)
			arg_index = arg_index + 1
			offset = offset + a
		elseif kind == 'fixed' then
			local value<const> = select(arg_index, ...)
			arg_index = arg_index + 1
			for char_index = 1, a do
				out[#out + 1] = char_index <= #value and sub(value, char_index, char_index) or char(0)
			end
			offset = offset + a
		elseif kind == 'z' then
			local value<const> = select(arg_index, ...)
			arg_index = arg_index + 1
			for char_index = 1, #value do
				if byte(value, char_index) == 0 then
					error('string.pack z strings must not contain zero bytes.')
				end
				out[#out + 1] = sub(value, char_index, char_index)
			end
			out[#out + 1] = char(0)
			offset = offset + #value + 1
		elseif kind == 'len' then
			offset = pack_emit_padding(out, offset, b)
			local value<const> = select(arg_index, ...)
			arg_index = arg_index + 1
			pack_write_int(out, #value, a, false, little_endian)
			for char_index = 1, #value do
				out[#out + 1] = sub(value, char_index, char_index)
			end
			offset = offset + a + #value
		end
	end
	return concat(out)
end


local packsize<const> = function(format)
	local index = 1
	local offset = 0
	local little_endian = pack_little_endian
	local max_align = default_pack_align
	while true do
		local kind<const>, next_index<const>, next_little<const>, next_max_align<const>, a<const>, b<const>, c<const> = pack_token(format, index, little_endian, max_align)
		if kind == nil then
			return offset
		end
		index = next_index
		little_endian = next_little
		max_align = next_max_align
		local advance = 0
		if kind == 'pad' then
			advance = 1
		elseif kind == 'align_next' then
			advance = pack_align_padding(offset, pack_next_align(format, index, little_endian, max_align))
		elseif kind == 'int' then
			advance = pack_align_padding(offset, c) + a
		elseif kind == 'float' then
			advance = pack_align_padding(offset, b) + a
		elseif kind == 'fixed' then
			advance = a
		elseif pack_variable_size_kind[kind] then
			error('string.packsize format is variable-length.')
		end
		if advance > max_size - offset then error('string.packsize size out of range.') end
		offset = offset + advance
	end
end


local unpack_string<const> = function(format, source, start_arg)
	local index = 1
	local position<const> = start_arg == nil and 1 or tointeger(start_arg // 1)
	if position == nil or position < 1 or position - 1 > #source then
		error('string.unpack start index out of range.')
	end
	local offset = position - 1
	local little_endian = pack_little_endian
	local max_align = default_pack_align
	local out<const> = {}
	while true do
		local kind<const>, next_index<const>, next_little<const>, next_max_align<const>, a<const>, b<const>, c<const> = pack_token(format, index, little_endian, max_align)
		if kind == nil then
			out[#out + 1] = offset + 1
			return unpack(out, 1, #out)
		end
		index = next_index
		little_endian = next_little
		max_align = next_max_align
		if kind == 'pad' then
			if 1 > #source - offset then
				error('string.unpack string is too short.')
			end
			offset = offset + 1
		elseif kind == 'align_next' then
			local padding<const> = pack_align_padding(offset, pack_next_align(format, index, little_endian, max_align))
			if padding > #source - offset then
				error('string.unpack string is too short.')
			end
			offset = offset + padding
		elseif kind == 'int' then
			local padding<const> = pack_align_padding(offset, c)
			if a > #source - offset - padding then
				error('string.unpack string is too short.')
			end
			offset = offset + padding
			out[#out + 1] = pack_read_int(source, offset, a, b, little_endian)
			offset = offset + a
		elseif kind == 'float' then
			local padding<const> = pack_align_padding(offset, b)
			if a > #source - offset - padding then
				error('string.unpack string is too short.')
			end
			offset = offset + padding
			out[#out + 1] = pack_read_float_bits(source, offset, a, little_endian)
			offset = offset + a
		elseif kind == 'fixed' then
			if a > #source - offset then
				error('string.unpack string is too short.')
			end
			out[#out + 1] = sub(source, offset + 1, offset + a)
			offset = offset + a
		elseif kind == 'z' then
			local finish = offset
			while finish < #source and byte(source, finish + 1) ~= 0 do
				finish = finish + 1
			end
			if finish >= #source then
				error('string.unpack zero-terminated string not found.')
			end
			out[#out + 1] = sub(source, offset + 1, finish)
			offset = finish + 1
		elseif kind == 'len' then
			local padding<const> = pack_align_padding(offset, b)
			if a > #source - offset - padding then
				error('string.unpack string is too short.')
			end
			offset = offset + padding
			local length<const> = pack_read_int(source, offset, a, false, little_endian)
			offset = offset + a
			if length < 0 or length > #source - offset then
				error('string.unpack string is too short.')
			end
			out[#out + 1] = sub(source, offset + 1, offset + length)
			offset = offset + length
		end
	end
end

return {
	pack = pack,
	packsize = packsize,
	unpack = unpack_string,
}
