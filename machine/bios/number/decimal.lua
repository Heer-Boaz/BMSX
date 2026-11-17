-- Decimal-to-binary32 conversion. The short path has one correctly-rounded
-- operation on exact operands. Longer inputs refine a Float estimate against
-- exact adjacent-float midpoints, as in double-conversion's Strtof:
-- https://github.com/google/double-conversion/blob/master/double-conversion/strtod.cc
local byte<const> = __bmsx_string_byte
local bits<const> = __bmsx_float_bits
local from_bits<const> = __bmsx_float_from_bits

rodata power_ten_data: f32[11] = {
	1.0, 10.0, 100.0, 1000.0, 10000.0, 100000.0,
	1000000.0, 10000000.0, 100000000.0, 1000000000.0, 10000000000.0,
}
local powers<const>: *f32 = power_ten_data

local scale<const> = function(value, exponent)
	while exponent > 10 do value = value * powers[10]; exponent = exponent - 10 end
	while exponent < -10 do value = value / powers[10]; exponent = exponent + 10 end
	if exponent < 0 then return value / powers[-exponent] end
	return value * powers[exponent]
end

-- Compare the original decimal with the midpoint above a positive Float word.
-- Base-10000 limbs keep every multiply, carry and quotient within one Integer.
-- A binary32 midpoint needs at most 113 decimal digits (29 limbs).
local compare_midpoint<const> = function(text, first, last_nonzero, point, order, lower, limbs)
	local encoded_exponent<const> = lower >> 23
	local mantissa = lower & 0x7fffff
	local shift = -150
	if encoded_exponent ~= 0 then
		mantissa = mantissa | 0x800000
		shift = encoded_exponent - 151
	end
	local coefficient<const> = mantissa * 2 + 1
	limbs[1] = coefficient % 10000
	limbs[2] = coefficient // 10000
	local count = limbs[2] == 0 and 1 or 2
	local factor = 2
	local decimal_places = 0
	local iterations = shift
	if shift < 0 then
		factor = 5
		decimal_places = -shift
		iterations = -shift
	end
	for _ = 1, iterations do
		local carry = 0
		for index = 1, count do
			local product<const> = limbs[index] * factor + carry
			limbs[index] = product % 10000
			carry = product // 10000
		end
		if carry ~= 0 then count = count + 1; limbs[count] = carry end
	end
	local high<const> = limbs[count]
	local high_digits = 1
	local divisor = 1
	if high >= 1000 then high_digits = 4; divisor = 1000
	elseif high >= 100 then high_digits = 3; divisor = 100
	elseif high >= 10 then high_digits = 2; divisor = 10 end
	local midpoint_order<const> = (count - 1) * 4 + high_digits - decimal_places
	if order < midpoint_order then return -1 end
	if order > midpoint_order then return 1 end
	local source_index = first
	for index = count, 1, -1 do
		local word<const> = limbs[index]
		while divisor > 0 do
			if source_index == point then source_index = source_index + 1 end
			local digit = 0
			if source_index <= last_nonzero then digit = byte(text, source_index) - 48 end
			local midpoint_digit<const> = (word // divisor) % 10
			if digit < midpoint_digit then return -1 end
			if digit > midpoint_digit then return 1 end
			source_index = source_index + 1
			divisor = divisor // 10
		end
		divisor = 1000
	end
	if source_index <= last_nonzero then return 1 end
	return 0
end

return function(text, first, last_nonzero, point, significant_digits, prefix, prefix_digits, exponent)
	if first == 0 then return 0.0 end
	local order<const> = significant_digits + exponent
	if order > 39 then return from_bits(0x7f800000) end
	if order < -45 then return 0.0 end
	if significant_digits == prefix_digits and prefix <= 16777216 and exponent >= -10 and exponent <= 10 then
		return scale(prefix * 1.0, exponent)
	end
	local estimate<const> = scale(prefix * 1.0, exponent + significant_digits - prefix_digits)
	local candidate = bits(estimate)
	if candidate == 0x7f800000 then candidate = 0x7f7fffff end
	-- Scratch belongs to this call, not shared BSS: an interrupt can parse too.
	local limbs<const> = {0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0}
	while true do
		local upper<const> = compare_midpoint(text, first, last_nonzero, point, order, candidate, limbs)
		if upper > 0 or (upper == 0 and (candidate & 1) ~= 0) then
			candidate = candidate + 1
			if candidate == 0x7f800000 then return from_bits(candidate) end
		elseif candidate == 0 then
			return 0.0
		else
			local lower<const> = compare_midpoint(text, first, last_nonzero, point, order, candidate - 1, limbs)
			if lower > 0 or (lower == 0 and (candidate & 1) == 0) then return from_bits(candidate) end
			candidate = candidate - 1
		end
	end
end
