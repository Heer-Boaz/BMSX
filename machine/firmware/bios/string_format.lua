require('bios/string_base')
local byte<const> = string.byte
local char<const> = string.char
local sub<const> = string.sub
local rep<const> = string.rep
local concat<const> = table.concat
local numeric<const> = require('bios/common/numeric')
local trunc<const> = numeric.trunc

local ascii_percent<const> = 37
local ascii_zero<const> = 48
local ascii_nine<const> = 57
local ascii_upper_a<const> = 65
local ascii_upper_z<const> = 90
local ascii_lower_a<const> = 97
local ascii_lower_z<const> = 122
local ascii_case_delta<const> = ascii_lower_a - ascii_upper_a
local u32_mod<const> = 0x100000000

local is_digit<const> = function(code)
	return code >= ascii_zero and code <= ascii_nine
end

local digit_value<const> = function(code)
	return code - ascii_zero
end

local pow10<const> = function(exponent)
	local value = 1
	while exponent > 0 do
		value = value * 10
		exponent = exponent - 1
	end
	return value
end

local abs_number<const> = function(value)
	if value < 0 then
		return -value
	end
	return value
end

local upper_ascii<const> = function(value)
	local out<const> = {}
	for index = 1, #value do
		local code = byte(value, index)
		if code >= ascii_lower_a and code <= ascii_lower_z then
			code = code - ascii_case_delta
		end
		out[#out + 1] = char(code)
	end
	return concat(out)
end

local read_integer<const> = function(format, index)
	local value = 0
	local found = false
	while index <= #format do
		local code<const> = byte(format, index)
		if not is_digit(code) then
			break
		end
		found = true
		value = value * 10 + digit_value(code)
		index = index + 1
	end
	return value, index, found
end

local pad_left<const> = function(value, width, code)
	local length<const> = #value
	if length >= width then
		return value
	end
	return rep(char(code), width - length) .. value
end

local apply_padding<const> = function(content, sign, prefix, width, left_align, zero_pad)
	local total<const> = #sign + #prefix + #content
	if width ~= nil and total < width then
		local padding<const> = width - total
		if left_align then
			return sign .. prefix .. content .. rep(' ', padding)
		end
		if zero_pad then
			return sign .. prefix .. rep('0', padding) .. content
		end
		return rep(' ', padding) .. sign .. prefix .. content
	end
	return sign .. prefix .. content
end

local sign_prefix<const> = function(value, plus, space)
	if value < 0 then
		return '-'
	end
	if plus then
		return '+'
	end
	if space then
		return ' '
	end
	return ''
end

local uint32<const> = function(value)
	local unsigned<const> = trunc(value) & 0xffffffff
	if unsigned < 0 then
		return unsigned + u32_mod
	end
	return unsigned
end

local base_digit<const> = function(value, uppercase)
	if value < 10 then
		return char(ascii_zero + value)
	end
	if uppercase then
		return char(ascii_upper_a + value - 10)
	end
	return char(ascii_lower_a + value - 10)
end

local unsigned_to_base<const> = function(value, base, uppercase)
	if value == 0 then
		return '0'
	end
	local out = ''
	while value > 0 do
		local digit<const> = value % base
		out = base_digit(digit, uppercase) .. out
		value = value // base
	end
	return out
end

local finite_text<const> = function(value, uppercase)
	if value ~= value then
		return uppercase and 'NAN' or 'nan'
	end
	local infinity<const> = 1 / 0
	if value == infinity or value == -infinity then
		return uppercase and 'INF' or 'inf'
	end
	return nil
end

local fixed_digits<const> = function(value, precision, alternate)
	local scale<const> = pow10(precision)
	local rounded<const> = trunc(value * scale + 0.5)
	local whole<const> = rounded // scale
	local fraction<const> = rounded % scale
	local text = tostring(whole)
	if precision > 0 then
		text = text .. '.' .. pad_left(tostring(fraction), precision, ascii_zero)
	elseif alternate then
		text = text .. '.'
	end
	return text
end

local exponent10<const> = function(value)
	local exponent = 0
	while value >= 10 do
		value = value / 10
		exponent = exponent + 1
	end
	while value > 0 and value < 1 do
		value = value * 10
		exponent = exponent - 1
	end
	return exponent, value
end

local exponent_suffix<const> = function(exponent, uppercase)
	local letter<const> = uppercase and 'E' or 'e'
	local sign = '+'
	if exponent < 0 then
		sign = '-'
		exponent = -exponent
	end
	return letter .. sign .. pad_left(tostring(exponent), 2, ascii_zero)
end

local scientific_digits<const> = function(value, precision, alternate, uppercase)
	if value == 0 then
		return fixed_digits(0, precision, alternate) .. exponent_suffix(0, uppercase)
	end
	local exponent, mantissa<const> = exponent10(value)
	local scale<const> = pow10(precision)
	local rounded = trunc(mantissa * scale + 0.5)
	if rounded >= 10 * scale then
		rounded = rounded // 10
		exponent = exponent + 1
	end
	local whole<const> = rounded // scale
	local fraction<const> = rounded % scale
	local text = tostring(whole)
	if precision > 0 then
		text = text .. '.' .. pad_left(tostring(fraction), precision, ascii_zero)
	elseif alternate then
		text = text .. '.'
	end
	return text .. exponent_suffix(exponent, uppercase)
end

local strip_fraction_zeros<const> = function(value)
	local exponent_index
	for index = 1, #value do
		local code<const> = byte(value, index)
		if code == 101 or code == 69 then
			exponent_index = index
			break
		end
	end
	local suffix = ''
	if exponent_index ~= nil then
		suffix = sub(value, exponent_index)
		value = sub(value, 1, exponent_index - 1)
	end
	while #value > 0 and byte(value, #value) == ascii_zero do
		value = sub(value, 1, #value - 1)
	end
	if #value > 0 and byte(value, #value) == 46 then
		value = sub(value, 1, #value - 1)
	end
	return value .. suffix
end

local general_digits<const> = function(value, precision, alternate, uppercase)
	local significant = precision
	if significant == nil then
		significant = 6
	elseif significant == 0 then
		significant = 1
	end
	local exponent = 0
	if value ~= 0 then
		exponent = exponent10(value)
	end
	local text
	if exponent < -4 or exponent >= significant then
		text = scientific_digits(value, significant - 1, alternate, uppercase)
	else
		text = fixed_digits(value, significant - exponent - 1, alternate)
	end
	if not alternate then
		text = strip_fraction_zeros(text)
	end
	if uppercase then
		return upper_ascii(text)
	end
	return text
end

local quoted<const> = function(value)
	local raw<const> = tostring(value)
	local out = '"'
	for index = 1, #raw do
		local code<const> = byte(raw, index)
		if code == 10 then
			out = out .. '\\n'
		elseif code == 13 then
			out = out .. '\\r'
		elseif code == 9 then
			out = out .. '\\t'
		elseif code == 92 then
			out = out .. '\\\\'
		elseif code == 34 then
			out = out .. '\\"'
		elseif code < 32 or code == 127 then
			out = out .. '\\' .. pad_left(tostring(code), 3, ascii_zero)
		else
			out = out .. char(code)
		end
	end
	return out .. '"'
end

local format<const> = function(format, ...)
	local argument_index = 1
	local output = ''
	local index = 1
	local length<const> = #format
	while index <= length do
		local code<const> = byte(format, index)
		if code ~= ascii_percent then
			output = output .. char(code)
			index = index + 1
		else
			if index == length then
				error('string.format incomplete format specifier.')
			end
			if byte(format, index + 1) == ascii_percent then
				output = output .. '%'
				index = index + 2
			else
				local cursor = index + 1
				local left_align = false
				local plus = false
				local space = false
				local zero_pad = false
				local alternate = false
				while cursor <= length do
					local flag<const> = byte(format, cursor)
					if flag == 45 then
						left_align = true
					elseif flag == 43 then
						plus = true
					elseif flag == 32 then
						space = true
					elseif flag == ascii_zero then
						zero_pad = true
					elseif flag == 35 then
						alternate = true
					else
						break
					end
					cursor = cursor + 1
				end

				local width
				if cursor <= length and byte(format, cursor) == 42 then
					local width_value<const> = select(argument_index, ...)
					argument_index = argument_index + 1
					local width_arg<const> = trunc(width_value)
					if width_arg < 0 then
						left_align = true
						width = -width_arg
					else
						width = width_arg
					end
					cursor = cursor + 1
				else
					local parsed_width<const>, next_cursor<const>, found_width<const> = read_integer(format, cursor)
					if found_width then
						width = parsed_width
						cursor = next_cursor
					end
				end

				local precision
				if cursor <= length and byte(format, cursor) == 46 then
					cursor = cursor + 1
					if cursor > length then
						error('string.format incomplete format specifier.')
					end
					if byte(format, cursor) == 42 then
						local precision_value<const> = select(argument_index, ...)
						argument_index = argument_index + 1
						local precision_arg<const> = trunc(precision_value)
						if precision_arg >= 0 then
							precision = precision_arg
						end
						cursor = cursor + 1
					else
						local parsed_precision<const>, next_cursor<const>, found_precision<const> = read_integer(format, cursor)
						precision = found_precision and parsed_precision or 0
						cursor = next_cursor
					end
				end

				while cursor <= length do
					local modifier<const> = byte(format, cursor)
					if modifier ~= 108 and modifier ~= 76 and modifier ~= 104 then
						break
					end
					cursor = cursor + 1
				end
				if cursor > length then
					error('string.format incomplete format specifier.')
				end

				local specifier<const> = byte(format, cursor)
				local formatted
				if specifier == 115 then
					local value<const> = select(argument_index, ...)
					argument_index = argument_index + 1
					formatted = tostring(value)
					if precision ~= nil then
						formatted = sub(formatted, 1, precision)
					end
					output = output .. apply_padding(formatted, '', '', width, left_align, false)
				elseif specifier == 99 then
					local value<const> = select(argument_index, ...)
					argument_index = argument_index + 1
					formatted = char(trunc(value))
					output = output .. apply_padding(formatted, '', '', width, left_align, false)
				elseif specifier == 100 or specifier == 105 or specifier == 117 or specifier == 111 or specifier == 120 or specifier == 88 then
					local raw<const> = select(argument_index, ...)
					argument_index = argument_index + 1
					local unsigned<const> = specifier == 117 or specifier == 111 or specifier == 120 or specifier == 88
					local integer<const> = unsigned and uint32(raw) or trunc(raw)
					local negative<const> = not unsigned and integer < 0
					local sign = ''
					if specifier == 100 or specifier == 105 then
						sign = negative and '-' or sign_prefix(integer, plus, space)
					end
					local magnitude<const> = negative and -integer or integer
					local base = 10
					if specifier == 111 then
						base = 8
					elseif specifier == 120 or specifier == 88 then
						base = 16
					end
					local digits = unsigned_to_base(magnitude, base, specifier == 88)
					if precision ~= nil then
						if #digits < precision then
							digits = rep('0', precision - #digits) .. digits
						end
						if precision == 0 and magnitude == 0 then
							digits = ''
						end
					end
					local prefix = ''
					if alternate then
						if (specifier == 120 or specifier == 88) and magnitude ~= 0 then
							prefix = specifier == 120 and '0x' or '0X'
						elseif specifier == 111 then
							if #digits == 0 then
								digits = '0'
							elseif byte(digits, 1) ~= ascii_zero then
								digits = '0' .. digits
							end
						end
					end
					output = output .. apply_padding(digits, sign, prefix, width, left_align, zero_pad and precision == nil)
				elseif specifier == 102 or specifier == 70 or specifier == 101 or specifier == 69 or specifier == 103 or specifier == 71 then
					local number<const> = select(argument_index, ...)
					argument_index = argument_index + 1
					local uppercase<const> = specifier == 70 or specifier == 69 or specifier == 71
					local special<const> = finite_text(number, uppercase)
					local sign<const> = sign_prefix(number, plus, space)
					if special ~= nil then
						formatted = special
					elseif specifier == 102 or specifier == 70 then
						formatted = fixed_digits(abs_number(number), precision == nil and 6 or precision, alternate)
					elseif specifier == 101 or specifier == 69 then
						formatted = scientific_digits(abs_number(number), precision == nil and 6 or precision, alternate, uppercase)
					else
						formatted = general_digits(abs_number(number), precision, alternate, uppercase)
					end
					output = output .. apply_padding(formatted, sign, '', width, left_align, zero_pad)
				elseif specifier == 113 then
					local value<const> = select(argument_index, ...)
					argument_index = argument_index + 1
					formatted = quoted(value)
					output = output .. apply_padding(formatted, '', '', width, left_align, false)
				else
					error('string.format unsupported format specifier \'%' .. char(specifier) .. '\'.')
				end
				index = cursor + 1
			end
		end
	end
	return output
end

return {
	format = format,
}
