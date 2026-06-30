require('bios/string_base')
local byte<const> = string.byte
local char<const> = string.char
local sub<const> = string.sub
local concat<const> = table.concat
local unpack<const> = table.unpack
local float_bits<const> = require('bios/common/float_bits')
local f32_to_u32<const> = float_bits.f32_to_u32
local f64_to_u32s<const> = float_bits.f64_to_u32s
local u32_to_f32<const> = float_bits.u32_to_f32
local u32s_to_f64<const> = float_bits.u32s_to_f64

local max_safe_integer<const> = 9007199254740991
local default_int_size<const> = 4
local default_long_size<const> = 4
local default_size_t_size<const> = 4
local lua_integer_size<const> = 8
local lua_number_size<const> = 8
local default_pack_align<const> = 8
local pack_little_endian<const> = true
local pack_fixed_int_size<const> = { b = 1, ['B'] = 1, h = 2, ['H'] = 2, l = default_long_size, ['L'] = default_long_size, j = lua_integer_size, ['J'] = lua_integer_size }
local pack_sized_int_token<const> = { i = true, ['I'] = true }
local pack_signed_int_token<const> = { b = true, h = true, l = true, j = true, i = true }
local pack_float_size<const> = { f = 4, d = 8, n = 8 }
local pack_float_mantissa_bits<const> = { f = 23, d = 52, n = 52 }
local pack_float_exponent_bits<const> = { f = 8, d = 11, n = 11 }
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
		value = value * 10 + digit
		index = index + 1
	end
	return value, index, found
end

local pack_power256<const> = function(size)
	local value = 1
	for index = 1, size do
		value = value * 256
	end
	return value
end

local pack_range_limit<const> = function(size, signed)
	local limit<const> = pack_power256(size)
	if signed then
		return -limit / 2, limit / 2 - 1
	end
	return 0, limit - 1
end

local pack_integer_value<const> = function(value)
	local integer<const> = value // 1
	if integer ~= value then
		error('string.pack integer value must be an integer.')
	end
	if integer > max_safe_integer or integer < -max_safe_integer then
		error('string.pack integer value exceeds safe integer range.')
	end
	return integer
end

local pack_write_uint<const> = function(out, value, size, little_endian)
	if little_endian then
		for index = 1, size do
			out[#out + 1] = char(value % 256)
			value = value // 256
		end
	else
		local divisor = pack_power256(size - 1)
		for index = 1, size do
			out[#out + 1] = char((value // divisor) % 256)
			divisor = divisor // 256
		end
	end
end

local pack_write_int<const> = function(out, raw_value, size, signed, little_endian)
	local value<const> = pack_integer_value(raw_value)
	local min_value<const>, max_value<const> = pack_range_limit(size, signed)
	if value < min_value or value > max_value or value > max_safe_integer then
		error('string.pack integer value out of range.')
	end
	local encoded = value
	if encoded < 0 then
		encoded = encoded + pack_power256(size)
	end
	pack_write_uint(out, encoded, size, little_endian)
end

local pack_read_uint<const> = function(source, offset, size, little_endian)
	local value = 0
	local multiplier = 1
	if little_endian then
		for index = 0, size - 1 do
			value = value + byte(source, offset + index + 1) * multiplier
			multiplier = multiplier * 256
		end
	else
		for index = size - 1, 0, -1 do
			value = value + byte(source, offset + index + 1) * multiplier
			multiplier = multiplier * 256
		end
	end
	if value > max_safe_integer then
		error('string.unpack integer exceeds safe integer range.')
	end
	return value
end

local pack_read_int<const> = function(source, offset, size, signed, little_endian)
	local value = pack_read_uint(source, offset, size, little_endian)
	if signed then
		local sign_limit<const> = pack_power256(size) / 2
		if value >= sign_limit then
			value = value - pack_power256(size)
		end
	end
	return value
end

local pack_write_float_bits<const> = function(out, value, mantissa_bits, little_endian)
	if mantissa_bits == 23 then
		pack_write_uint(out, f32_to_u32(value), 4, little_endian)
		return
	end
	local high<const>, low<const> = f64_to_u32s(value)
	if little_endian then
		pack_write_uint(out, low, 4, true)
		pack_write_uint(out, high, 4, true)
	else
		pack_write_uint(out, high, 4, false)
		pack_write_uint(out, low, 4, false)
	end
end

local pack_read_float_bits<const> = function(source, offset, mantissa_bits, little_endian)
	if mantissa_bits == 23 then
		local bits<const> = pack_read_uint(source, offset, 4, little_endian)
		return u32_to_f32(bits)
	end
	local high
	local low
	if little_endian then
		low = pack_read_uint(source, offset, 4, true)
		high = pack_read_uint(source, offset + 4, 4, true)
	else
		high = pack_read_uint(source, offset, 4, false)
		low = pack_read_uint(source, offset + 4, 4, false)
	end
	return u32s_to_f64(high, low)
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
		return 'float', index + 1, little_endian, max_align, float_size, pack_float_mantissa_bits[token], pack_float_exponent_bits[token], max_align < float_size and max_align or float_size
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
		local kind<const>, next_index<const>, next_little<const>, next_max_align<const>, a<const>, b<const>, c<const>, d<const> = pack_token(format, index, little_endian, max_align)
		if kind == nil then
			return 1
		end
		if pack_control_kind[kind] then
			index = next_index
			little_endian = next_little
			max_align = next_max_align
		elseif not pack_skip_align_kind[kind] then
			return d or c or b or a or 1
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
		local kind<const>, next_index<const>, next_little<const>, next_max_align<const>, a<const>, b<const>, c<const>, d<const> = pack_token(format, index, little_endian, max_align)
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
			offset = pack_emit_padding(out, offset, d)
			pack_write_float_bits(out, (select(arg_index, ...)), b, little_endian)
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
		local kind<const>, next_index<const>, next_little<const>, next_max_align<const>, a<const>, _b<const>, c<const>, d<const> = pack_token(format, index, little_endian, max_align)
		if kind == nil then
			return offset
		end
		index = next_index
		little_endian = next_little
		max_align = next_max_align
		if kind == 'pad' then
			offset = offset + 1
		elseif kind == 'align_next' then
			offset = offset + pack_align_padding(offset, pack_next_align(format, index, little_endian, max_align))
		elseif kind == 'int' then
			offset = offset + pack_align_padding(offset, c) + a
		elseif kind == 'float' then
			offset = offset + pack_align_padding(offset, d) + a
		elseif kind == 'fixed' then
			offset = offset + a
		elseif pack_variable_size_kind[kind] then
			error('string.packsize format is variable-length.')
		end
	end
end


local unpack_string<const> = function(format, source, start_arg)
	local index = 1
	local offset = (start_arg == nil and 1 or start_arg // 1) - 1
	if offset < 0 or offset > #source then
		error('string.unpack start index out of range.')
	end
	local little_endian = pack_little_endian
	local max_align = default_pack_align
	local out<const> = {}
	while true do
		local kind<const>, next_index<const>, next_little<const>, next_max_align<const>, a<const>, b<const>, c<const>, d<const> = pack_token(format, index, little_endian, max_align)
		if kind == nil then
			out[#out + 1] = offset + 1
			return unpack(out, 1, #out)
		end
		index = next_index
		little_endian = next_little
		max_align = next_max_align
		if kind == 'pad' then
			if offset + 1 > #source then
				error('string.unpack string is too short.')
			end
			offset = offset + 1
		elseif kind == 'align_next' then
			local padding<const> = pack_align_padding(offset, pack_next_align(format, index, little_endian, max_align))
			if offset + padding > #source then
				error('string.unpack string is too short.')
			end
			offset = offset + padding
		elseif kind == 'int' then
			local padding<const> = pack_align_padding(offset, c)
			if offset + padding + a > #source then
				error('string.unpack string is too short.')
			end
			offset = offset + padding
			out[#out + 1] = pack_read_int(source, offset, a, b, little_endian)
			offset = offset + a
		elseif kind == 'float' then
			local padding<const> = pack_align_padding(offset, d)
			if offset + padding + a > #source then
				error('string.unpack string is too short.')
			end
			offset = offset + padding
			out[#out + 1] = pack_read_float_bits(source, offset, b, little_endian)
			offset = offset + a
		elseif kind == 'fixed' then
			if offset + a > #source then
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
			if offset + padding + a > #source then
				error('string.unpack string is too short.')
			end
			offset = offset + padding
			local length<const> = pack_read_int(source, offset, a, false, little_endian)
			offset = offset + a
			if offset + length > #source then
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
