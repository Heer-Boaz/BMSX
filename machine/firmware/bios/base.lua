local byte<const> = string.byte
local print_char<const>: *word = sys_print_char
local print_flush<const>: *word = sys_print_flush

local ascii_tab<const> = 9
local ascii_carriage_return<const> = 13
local ascii_space<const> = 32
local ascii_plus<const> = 43
local ascii_minus<const> = 45
local ascii_dot<const> = 46
local ascii_digit_0<const> = 48
local ascii_digit_9<const> = 57
local ascii_upper_a<const> = 65
local ascii_upper_e<const> = 69
local ascii_upper_x<const> = 88
local ascii_upper_z<const> = 90
local ascii_lower_a<const> = 97
local ascii_lower_e<const> = 101
local ascii_lower_x<const> = 120
local ascii_lower_z<const> = 122

local is_space<const> = function(code)
	return code == ascii_space or (code >= ascii_tab and code <= ascii_carriage_return)
end

local skip_spaces<const> = function(text, index, length)
	while index <= length and is_space(byte(text, index)) do
		index = index + 1
	end
	return index
end

local digit_value<const> = function(code)
	if code >= ascii_digit_0 and code <= ascii_digit_9 then
		return code - ascii_digit_0
	end
	if code >= ascii_upper_a and code <= ascii_upper_z then
		return code - ascii_upper_a + 10
	end
	if code >= ascii_lower_a and code <= ascii_lower_z then
		return code - ascii_lower_a + 10
	end
	return nil
end

local decimal_scale<const> = function(value, exponent)
	while exponent > 0 do
		value = value * 10
		exponent = exponent - 1
	end
	while exponent < 0 do
		value = value / 10
		exponent = exponent + 1
	end
	return value
end

local parse_based_integer<const> = function(text, base)
	local length<const> = #text
	local index = skip_spaces(text, 1, length)
	if index > length then
		return nil
	end
	local sign = 1
	local code<const> = byte(text, index)
	if code == ascii_minus then
		sign = -1
		index = index + 1
	elseif code == ascii_plus then
		index = index + 1
	end
	local value = 0
	local digit_count = 0
	while index <= length do
		local digit<const> = digit_value(byte(text, index))
		if digit == nil or digit >= base then
			break
		end
		value = value * base + digit
		digit_count = digit_count + 1
		index = index + 1
	end
	if digit_count == 0 then
		return nil
	end
	index = skip_spaces(text, index, length)
	if index <= length then
		return nil
	end
	return sign * value
end

local parse_decimal<const> = function(text)
	local length<const> = #text
	local index = skip_spaces(text, 1, length)
	if index > length then
		return nil
	end
	local sign = 1
	local code = byte(text, index)
	if code == ascii_minus then
		sign = -1
		index = index + 1
	elseif code == ascii_plus then
		index = index + 1
	end
	if index + 1 <= length and byte(text, index) == ascii_digit_0 then
		code = byte(text, index + 1)
		if code == ascii_upper_x or code == ascii_lower_x then
			index = index + 2
			local hex_value = 0
			local hex_digit_count = 0
			while index <= length do
				local digit<const> = digit_value(byte(text, index))
				if digit == nil or digit >= 16 then
					break
				end
				hex_value = hex_value * 16 + digit
				hex_digit_count = hex_digit_count + 1
				index = index + 1
			end
			if hex_digit_count == 0 then
				return nil
			end
			index = skip_spaces(text, index, length)
			if index <= length then
				return nil
			end
			return sign * hex_value
		end
	end
	local value = 0
	local digit_count = 0
	while index <= length do
		local digit<const> = digit_value(byte(text, index))
		if digit == nil or digit > 9 then
			break
		end
		value = value * 10 + digit
		digit_count = digit_count + 1
		index = index + 1
	end
	if index <= length and byte(text, index) == ascii_dot then
		index = index + 1
		local divisor = 10
		while index <= length do
			local digit<const> = digit_value(byte(text, index))
			if digit == nil or digit > 9 then
				break
			end
			value = value + digit / divisor
			divisor = divisor * 10
			digit_count = digit_count + 1
			index = index + 1
		end
	end
	if digit_count == 0 then
		return nil
	end
	if index <= length then
		code = byte(text, index)
		if code == ascii_upper_e or code == ascii_lower_e then
			index = index + 1
			local exponent_sign = 1
			code = byte(text, index)
			if code == ascii_minus then
				exponent_sign = -1
				index = index + 1
			elseif code == ascii_plus then
				index = index + 1
			end
			local exponent = 0
			local exponent_digit_count = 0
			while index <= length do
				local digit<const> = digit_value(byte(text, index))
				if digit == nil or digit > 9 then
					break
				end
				exponent = exponent * 10 + digit
				exponent_digit_count = exponent_digit_count + 1
				index = index + 1
			end
			if exponent_digit_count == 0 then
				return nil
			end
			value = decimal_scale(value, exponent * exponent_sign)
		end
	end
	index = skip_spaces(text, index, length)
	if index <= length then
		return nil
	end
	return sign * value
end

assert = function(condition, ...)
	if condition then
		return condition, ...
	end
	if select('#', ...) > 0 then
		error((select(1, ...)))
	end
	error('assertion failed!')
end


rawequal = function(left, right)
	return left == right
end


tostring = function(value)
	return '' .. value
end


tonumber = function(value, base)
	local value_type<const> = type(value)
	if base == nil then
		if value_type == 'number' then
			return value
		end
		if value_type ~= 'string' then
			return nil
		end
		return parse_decimal(value)
	end
	if value_type ~= 'string' then
		error('bad argument #1 to tonumber (string expected)')
	end
	local integer_base<const> = base // 1
	if integer_base ~= base then
		error('bad argument #2 to tonumber (integer expected)')
	end
	if integer_base < 2 or integer_base > 36 then
		error('bad argument #2 to tonumber (base out of range)')
	end
	return parse_based_integer(value, integer_base)
end


print = function(...)
	local count<const> = select('#', ...)
	for value_index = 1, count do
		if value_index > 1 then
			print_char[0] = ascii_tab
		end
		local text<const> = tostring(select(value_index, ...))
		local char_index = 1
		local code = byte(text, char_index)
		while code ~= nil do
			print_char[0] = code
			char_index = char_index + 1
			code = byte(text, char_index)
		end
	end
	print_flush[0] = 1
end



local ipairs_iterator<const> = function(target, index)
	local next_index<const> = index + 1
	local value<const> = target[next_index]
	if value == nil then
		return nil
	end
	return next_index, value
end


ipairs = function(target)
	return ipairs_iterator, target, 0
end


pairs = function(target)
	return next, target, nil
end
