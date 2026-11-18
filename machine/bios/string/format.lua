local string<const> = require('string/base')
local table<const> = require('table')
local math<const> = require('math')
local byte<const> = string.byte
local char<const> = string.char
local sub<const> = string.sub
local rep<const> = string.rep
local concat<const> = table.concat
local modf<const> = math.modf
local tointeger<const> = math.tointeger
local float_digits<const> = require('number/format')

local ascii_percent<const> = 37
local ascii_zero<const> = 48
local ascii_nine<const> = 57
local ascii_upper_a<const> = 65
local ascii_lower_a<const> = 97

local integer_argument<const> = function(value)
	local integer<const> = tointeger((modf(value)))
	if integer == nil then error('string.format integer out of range.') end
	return integer
end

local read_integer<const> = function(format, index)
	local value = 0
	local found = false
	while index <= #format do
		local code<const> = byte(format, index)
		if code < ascii_zero or code > ascii_nine then
			break
		end
		found = true
		local digit<const> = code - ascii_zero
		if value > 214748364 or (value == 214748364 and digit > 7) then
			error('string.format field out of range.')
		end
		value = value * 10 + digit
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

local sign_prefix<const> = function(negative, plus, space)
	if negative then
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
	if value == 0 then return '0' end
	local out = ''
	if base ~= 10 then
		local shift<const> = base == 8 and 3 or 4
		repeat
			out = base_digit(value & (base - 1), uppercase) .. out
			value = value >> shift
		until value == 0
		return out
	end
	if value < 0 then
		-- Unsigned division of one raw word; the quotient then fits an Integer.
		local half<const> = value >> 1
		local half_quotient<const> = half // base
		local digit = (half - half_quotient * base) * 2 + (value & 1)
		value = half_quotient * 2
		if digit >= base then digit = digit - base; value = value + 1 end
		out = base_digit(digit, uppercase)
	end
	while value > 0 do
		local quotient<const> = value // base
		out = base_digit(value - quotient * base, uppercase) .. out
		value = quotient
	end
	return out
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
			out = out .. '\\' .. pad_left('' .. code, 3, ascii_zero)
		else
			out = out .. char(code)
		end
	end
	return out .. '"'
end

local format<const> = function(format, ...)
	local argument_index = 1
	local length<const> = #format
	local output<const> = {}
	local index = 1
	while index <= length do
		local code<const> = byte(format, index)
		if code ~= ascii_percent then
			local first<const> = index
			repeat index = index + 1 until index > length or byte(format, index) == ascii_percent
			output[#output + 1] = sub(format, first, index - 1)
		else
			if index == length then
				error('string.format incomplete format specifier.')
			end
			if byte(format, index + 1) == ascii_percent then
				output[#output + 1] = '%'
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
					local width_arg<const> = integer_argument(width_value)
					if width_arg == 0x80000000 then error('string.format field out of range.') end
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
						local precision_arg<const> = integer_argument(precision_value)
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
					output[#output + 1] = apply_padding(formatted, '', '', width, left_align, false)
				elseif specifier == 99 then
					local value<const> = select(argument_index, ...)
					argument_index = argument_index + 1
					formatted = char((modf(value)))
					output[#output + 1] = apply_padding(formatted, '', '', width, left_align, false)
				elseif specifier == 100 or specifier == 105 or specifier == 117 or specifier == 111 or specifier == 120 or specifier == 88 then
					local raw<const> = select(argument_index, ...)
					argument_index = argument_index + 1
					local unsigned<const> = specifier == 117 or specifier == 111 or specifier == 120 or specifier == 88
					local integer<const> = integer_argument(raw)
					local negative<const> = not unsigned and integer < 0
					local sign = ''
					if specifier == 100 or specifier == 105 then
						sign = sign_prefix(negative, plus, space)
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
					output[#output + 1] = apply_padding(digits, sign, prefix, width, left_align, zero_pad and precision == nil)
				elseif specifier == 102 or specifier == 70 or specifier == 101 or specifier == 69 or specifier == 103 or specifier == 71 then
					local number<const> = select(argument_index, ...)
					argument_index = argument_index + 1
					local text<const>, negative<const> = float_digits(number, specifier, precision, alternate)
					output[#output + 1] = apply_padding(text, sign_prefix(negative, plus, space), '', width, left_align, zero_pad)
				elseif specifier == 113 then
					local value<const> = select(argument_index, ...)
					argument_index = argument_index + 1
					formatted = quoted(value)
					output[#output + 1] = apply_padding(formatted, '', '', width, left_align, false)
				else
					error('string.format unsupported format specifier \'%' .. char(specifier) .. '\'.')
				end
				index = cursor + 1
			end
		end
	end
	return concat(output)
end

return {
	format = format,
}
