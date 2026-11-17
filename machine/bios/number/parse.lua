local byte<const> = __bmsx_string_byte
local decimal_float<const> = require('number/decimal')
local parse<const> = {}

local is_space<const> = function(code)
	return code == 32 or (code >= 9 and code <= 13)
end
local digit_value<const> = function(code)
	if code >= 48 and code <= 57 then return code - 48 end
	if code >= 65 and code <= 90 then return code - 65 + 10 end
	if code >= 97 and code <= 122 then return code - 97 + 10 end
	return nil
end
local bounds<const> = function(text)
	local first = 1
	local last = #text
	while first <= last and is_space(byte(text, first)) do first = first + 1 end
	while last >= first and is_space(byte(text, last)) do last = last - 1 end
	local negative = false
	if first <= last then
		local code<const> = byte(text, first)
		if code == 43 or code == 45 then negative = code == 45; first = first + 1 end
	end
	return first, last, negative
end
local exponent_digits<const> = function(text, index, last, limit)
	local negative = false
	if index <= last then
		local code<const> = byte(text, index)
		if code == 43 or code == 45 then negative = code == 45; index = index + 1 end
	end
	local first<const> = index
	local exponent = 0
	while index <= last do
		local code<const> = byte(text, index)
		if code < 48 or code > 57 then break end
		-- Saturation is numeric parsing, not a word conversion. Beyond this
		-- bound no significand in this String can bring the value into range.
		if exponent < limit then
			exponent = exponent * 10 + code - 48
			if exponent > limit then exponent = limit end
		end
		index = index + 1
	end
	if index == first then return nil, index end
	if negative then exponent = -exponent end
	return exponent, index
end
local based<const> = function(text, first, last, base)
	if first > last then return nil end
	local word = 0
	for index = first, last do
		local digit<const> = digit_value(byte(text, index))
		if digit == nil or digit >= base then return nil end
		word = word * base + digit
	end
	return word
end

function parse.based_integer(text, base)
	local first<const>, last<const>, negative<const> = bounds(text)
	local value<const> = based(text, first, last, base)
	if value == nil then return nil end
	if negative then return -value end
	return value
end

local decimal<const> = function(text, first, last, negative)
	local index = first
	local point = 0
	local digits = 0
	local fractional_digits = 0
	local first_significant = 0
	local last_nonzero = 0
	local significant_digits = 0
	local prefix = 0
	local prefix_digits = 0
	local integer = 0
	local fits_integer = true
	local limit_digit<const> = negative and 8 or 7
	while index <= last do
		local code<const> = byte(text, index)
		if code >= 48 and code <= 57 then
			local digit<const> = code - 48
			digits = digits + 1
			if point ~= 0 then fractional_digits = fractional_digits + 1 end
			if digit ~= 0 then
				if first_significant == 0 then first_significant = index end
				last_nonzero = index
			end
			if first_significant ~= 0 then
				significant_digits = significant_digits + 1
				if prefix_digits < 9 then prefix = prefix * 10 + digit; prefix_digits = prefix_digits + 1 end
			end
			if fits_integer then
				if integer < 0 or integer > 214748364 or (integer == 214748364 and digit > limit_digit) then
					fits_integer = false
				else integer = integer * 10 + digit end
			end
		elseif code == 46 and point == 0 then
			point = index
		else break end
		index = index + 1
	end
	if digits == 0 then return nil end
	local has_exponent = false
	local exponent = 0
	if index <= last then
		local code<const> = byte(text, index)
		if code ~= 69 and code ~= 101 then return nil end
		has_exponent = true
		exponent, index = exponent_digits(text, index + 1, last, #text + 1024)
		if exponent == nil then return nil end
	end
	if index <= last then return nil end
	if point == 0 and not has_exponent and fits_integer then
		if negative then return -integer end
		return integer
	end
	exponent = exponent - fractional_digits
	if first_significant ~= 0 then
		local retained_digits<const> = last_nonzero - first_significant + 1
			- ((point > first_significant and point < last_nonzero) and 1 or 0)
		exponent = exponent + significant_digits - retained_digits
		significant_digits = retained_digits
		while prefix_digits > retained_digits do prefix = prefix // 10; prefix_digits = prefix_digits - 1 end
	end
	local value<const> = decimal_float(text, first_significant, last_nonzero, point,
		significant_digits, prefix, prefix_digits, exponent)
	if negative then return -value end
	return value
end

-- A hexadecimal Float retains the leading 28 bits and a sticky remainder.
-- The final shift extracts 24 (or fewer subnormal) bits and rounds only once.
local hexadecimal<const> = function(text, first, last)
	local index = first
	local digits = 0
	local point = false
	local fractional_digits = 0
	local significant_digits = 0
	local prefix = 0
	local prefix_digits = 0
	local leading_bits = 0
	local sticky = false
	while index <= last do
		local code<const> = byte(text, index)
		local digit<const> = digit_value(code)
		if digit ~= nil and digit < 16 then
			digits = digits + 1
			if point then fractional_digits = fractional_digits + 1 end
			if leading_bits == 0 and digit ~= 0 then
				leading_bits = digit >= 8 and 4 or digit >= 4 and 3 or digit >= 2 and 2 or 1
			end
			if leading_bits ~= 0 then
				significant_digits = significant_digits + 1
				if prefix_digits < 7 then prefix = prefix * 16 + digit; prefix_digits = prefix_digits + 1
				elseif digit ~= 0 then sticky = true end
			end
		elseif code == 46 and not point then point = true
		else break end
		index = index + 1
	end
	if digits == 0 then return nil end
	local exponent = 0
	local has_exponent = false
	if index <= last then
		local code<const> = byte(text, index)
		if code ~= 80 and code ~= 112 then return nil end
		has_exponent = true
		exponent, index = exponent_digits(text, index + 1, last, #text * 4 + 1024)
		if exponent == nil then return nil end
	end
	if index <= last then return nil end
	if not point and not has_exponent then return based(text, first, last, 16) end
	if leading_bits == 0 then return 0.0 end
	local binary_exponent = (significant_digits - 1) * 4 + leading_bits - 1 + exponent - fractional_digits * 4
	if binary_exponent > 127 then return blua32.float_from_bits(0x7f800000) end
	if binary_exponent < -150 then return 0.0 end
	local retained_bits = 24
	if binary_exponent < -126 then retained_bits = binary_exponent + 150 end
	local shift<const> = (prefix_digits - 1) * 4 + leading_bits - retained_bits
	local significand
	if shift <= 0 then significand = prefix << -shift
	else
		significand = prefix >> shift
		local remainder<const> = prefix & ((1 << shift) - 1)
		local half<const> = 1 << (shift - 1)
		if remainder > half or (remainder == half and (sticky or (significand & 1) ~= 0)) then
			significand = significand + 1
		end
	end
	if binary_exponent < -126 then return blua32.float_from_bits(significand) end
	if significand == 0x1000000 then significand = significand >> 1; binary_exponent = binary_exponent + 1 end
	if binary_exponent > 127 then return blua32.float_from_bits(0x7f800000) end
	return blua32.float_from_bits(((binary_exponent + 127) << 23) | (significand & 0x7fffff))
end

function parse.number(text)
	local first<const>, last<const>, negative<const> = bounds(text)
	if first > last then return nil end
	if first < last and byte(text, first) == 48 then
		local code<const> = byte(text, first + 1)
		if code == 88 or code == 120 then
			local value<const> = based(text, first + 2, last, 16)
			if value == nil then return nil end
			if negative then return -value end
			return value
		end
	end
	return decimal(text, first, last, negative)
end

function parse.literal(text)
	if #text > 1 and byte(text, 1) == 48 then
		local code<const> = byte(text, 2)
		if code == 88 or code == 120 then return hexadecimal(text, 3, #text) end
	end
	return decimal(text, 1, #text, false)
end

return parse
