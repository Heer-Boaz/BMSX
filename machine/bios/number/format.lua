-- Exact binary32 decimal construction, followed by one decimal rounding.
-- Like musl's fmt_fp, large coefficients use decimal limbs; base 10000 and
-- bounded multipliers keep every product and carry inside a signed word.
-- https://github.com/ifduyue/musl/blob/master/src/stdio/vfprintf.c
local string<const> = require('string/base')
local concat<const> = require('table').concat
local byte<const> = string.byte
local char<const> = string.char
local sub<const> = string.sub
local rep<const> = string.rep
local number_type<const> = __bmsx_number_type

rodata powers_five_data: word[8] = { 1, 5, 25, 125, 625, 3125, 15625, 78125 }
local powers_five<const>: *word = powers_five_data

-- Return decimal digits and the position of the decimal point within them.
local decimal<const> = function(word)
	if word == 0 then return '0', 1 end
	local exponent<const> = word >> 23
	local coefficient = word & 0x7fffff
	local shift = -149
	if exponent ~= 0 then coefficient = coefficient | 0x800000; shift = exponent - 150 end
	if (coefficient & 0xffff) == 0 then coefficient = coefficient >> 16; shift = shift + 16 end
	if (coefficient & 0xff) == 0 then coefficient = coefficient >> 8; shift = shift + 8 end
	if (coefficient & 15) == 0 then coefficient = coefficient >> 4; shift = shift + 4 end
	if (coefficient & 3) == 0 then coefficient = coefficient >> 2; shift = shift + 2 end
	if (coefficient & 1) == 0 then coefficient = coefficient >> 1; shift = shift + 1 end
	local places = 0
	local remaining = shift
	if shift < 0 then
		places = -shift
		remaining = places
		while remaining > 0 and coefficient <= 429496729 do
			coefficient = coefficient * 5
			remaining = remaining - 1
		end
	elseif shift < 31 and coefficient <= (0x7fffffff >> shift) then
		coefficient = coefficient << shift
		remaining = 0
	end
	if remaining == 0 then
		local digits<const> = ('' .. coefficient)
		return digits, #digits - places
	end
	-- Invocation-local scratch: formatting can also be entered by an interrupt.
	local limbs<const> = { coefficient % 10000, (coefficient // 10000) % 10000, coefficient // 100000000 }
	local count = limbs[3] ~= 0 and 3 or (limbs[2] ~= 0 and 2 or 1)
	while remaining > 0 do
		local step = remaining
		local factor
		if shift < 0 then
			if step > 7 then step = 7 end
			factor = powers_five[step]
		else
			if step > 17 then step = 17 end
			factor = 1 << step
		end
		local carry = 0
		for index = 1, count do
			local product<const> = limbs[index] * factor + carry
			limbs[index] = product % 10000
			carry = product // 10000
		end
		while carry ~= 0 do
			count = count + 1
			limbs[count] = carry % 10000
			carry = carry // 10000
		end
		remaining = remaining - step
	end
	-- Reuse the limb array as the concatenation buffer, most significant first.
	for index = 1, count // 2 do
		local opposite<const> = count - index + 1
		limbs[index], limbs[opposite] = limbs[opposite], limbs[index]
	end
	for index = 1, count do
		local digits<const> = ('' .. limbs[index])
		limbs[index] = index == 1 and digits or rep('0', 4 - #digits) .. digits
	end
	-- The constructor's unused high limbs must not become concat elements.
	for index = count + 1, 3 do limbs[index] = nil end
	local digits<const> = concat(limbs)
	return digits, #digits - places
end

-- No padding here: general format without # need not create discarded zeros.
local rounded_prefix<const> = function(digits, keep)
	if keep >= #digits then return digits end
	if keep < 0 then return '0' end
	if byte(digits, keep + 1) < 53 then
		return keep == 0 and '0' or sub(digits, 1, keep)
	end
	local index = keep
	while index > 0 and byte(digits, index) == 57 do index = index - 1 end
	if index == 0 then return '1' .. rep('0', keep) end
	return sub(digits, 1, index - 1) .. char(byte(digits, index) + 1) .. rep('0', keep - index)
end

local fixed<const> = function(digits, point, precision, alternate)
	local whole
	local fraction
	if point <= 0 then
		whole = '0'
		fraction = rep('0', -point) .. digits
	elseif point >= #digits then
		whole = digits .. rep('0', point - #digits)
		fraction = ''
	else
		whole = sub(digits, 1, point)
		fraction = sub(digits, point + 1)
	end
	if precision > 0 then return whole .. '.' .. fraction .. rep('0', precision - #fraction) end
	return alternate and whole .. '.' or whole
end

local scientific<const> = function(digits, exponent, precision, alternate, uppercase)
	local mantissa<const> = fixed(digits, 1, precision, alternate)
	local sign = '+'
	if exponent < 0 then sign = '-'; exponent = -exponent end
	local suffix = '' .. exponent
	if exponent < 10 then suffix = '0' .. suffix end
	return mantissa .. (uppercase and 'E' or 'e') .. sign .. suffix
end

return function(value, specifier, precision, alternate)
	if number_type(value) == 'integer' then value = value * 1.0 end
	local bits<const> = blua32.float_bits(value)
	local magnitude<const> = bits & 0x7fffffff
	local negative<const> = bits < 0
	local uppercase<const> = specifier == 70 or specifier == 69 or specifier == 71
	if magnitude > 0x7f800000 then return uppercase and 'NAN' or 'nan', false end
	if magnitude == 0x7f800000 then return uppercase and 'INF' or 'inf', negative end
	if precision == nil then precision = 6 end
	local digits, point = decimal(magnitude)
	if specifier == 102 or specifier == 70 then
		local whole_digits<const> = point > 0 and point or 1
		if precision > 0x7fffffff - whole_digits - 1 then error('string.format result too long.') end
		local keep<const> = point + precision
		if keep < #digits then
			digits = rounded_prefix(digits, keep)
			point = #digits - precision
		end
		return fixed(digits, point, precision, alternate), negative
	end
	local general<const> = specifier == 103 or specifier == 71
	local significant = precision
	if general then
		if significant == 0 then significant = 1 end
	else
		if precision > 0x7fffffff - 6 then error('string.format result too long.') end
		significant = precision + 1
	end
	local rounded<const> = rounded_prefix(digits, significant)
	if #rounded > significant then
		point = point + 1
		digits = sub(rounded, 1, significant)
	else
		digits = rounded
	end
	local requested_significant<const> = significant
	if general and not alternate then
		local last = #digits
		while last > 1 and byte(digits, last) == 48 do last = last - 1 end
		digits = sub(digits, 1, last)
		significant = #digits
	end
	local exponent<const> = point - 1
	if general and exponent >= -4 and exponent < requested_significant then
		local places = significant - point
		if places < 0 then places = 0 end
		if places > 0x7fffffff - (point > 0 and point or 1) - 1 then error('string.format result too long.') end
		return fixed(digits, point, places, alternate), negative
	end
	if significant > 0x7fffffff - 5 then error('string.format result too long.') end
	return scientific(digits, exponent, significant - 1, alternate, uppercase), negative
end
