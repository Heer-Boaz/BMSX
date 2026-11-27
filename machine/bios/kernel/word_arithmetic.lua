module<const>

-- The Integer datapath stores raw 32-bit words. Widening uses pairs of
-- words (high, low), not Float. Split products use 16-bit limbs; division
-- consumes the low word one bit at a time after dividing the high word.
local limb_mask<const> = 0xffff
local sign_bit<const> = 0x80000000

local multiply_add_words<const> = function(left, right, addend)
	local ll<const>, lh<const> = left & limb_mask, left >> 16
	local rl<const>, rh<const> = right & limb_mask, right >> 16
	local first<const> = ll * rl
	local middle<const> = lh * rl + (first >> 16)
	local upper_low<const> = (middle & limb_mask) + ll * rh
	local high<const> = lh * rh + (middle >> 16) + (upper_low >> 16)
	local low<const> = (upper_low << 16) | (first & limb_mask)
	local sum<const> = low + addend
	local carry<const> = (sum ~ sign_bit) < (low ~ sign_bit) and 1 or 0
	return high + carry, sum
end

local divide_word<const> = function(numerator, divisor)
	if divisor < 0 then
		return (numerator ~ sign_bit) >= (divisor ~ sign_bit) and 1 or 0
	end
	if numerator >= 0 then return numerator // divisor end
	-- The halved dividend and unsigned divisor fit the signed divide.
	local half<const> = numerator >> 1
	local quotient<const> = half // divisor
	local remainder<const> = 2 * (half - quotient * divisor) + (numerator & 1)
	local bit<const> = (remainder ~ sign_bit) >= (divisor ~ sign_bit) and 1 or 0
	return 2 * quotient + bit
end

local divide_words_by_word<const> = function(high, low, divisor)
	if high == 0 then
		local quotient<const> = divide_word(low, divisor)
		return 0, quotient
	end
	local ordered_divisor<const> = divisor ~ sign_bit
	local quotient_high = 0
	local remainder = high
	if (high ~ sign_bit) >= ordered_divisor then
		quotient_high = divide_word(high, divisor)
		remainder = high - quotient_high * divisor
	end
	local quotient_low = 0
	for index = 31, 0, -1 do
		local carry<const> = remainder >> 31
		remainder = (remainder << 1) | ((low >> index) & 1)
		if carry ~= 0 or (remainder ~ sign_bit) >= ordered_divisor then
			remainder = remainder - divisor
			quotient_low = quotient_low | (1 << index)
		end
	end
	return quotient_high, quotient_low
end

-- TS numeric.ts:71-80; C++ numeric.h:93-103: unsigned word truncation.
local float_to_word<const> = function(bits)
	local encoded<const> = (bits >> 23) & 0xff
	if encoded == 255 then return 0, false end
	local exponent<const> = encoded - 127
	local magnitude = 0
	if exponent >= 0 and exponent < 55 then
		local significand<const> = (bits & 0x7fffff) | 0x800000
		magnitude = exponent < 23 and (significand >> (23 - exponent)) or (significand << (exponent - 23))
	end
	return bits < 0 and -magnitude or magnitude, true
end

return {
	float_to_word = float_to_word,
	internal = { divide_word = divide_word },
	multiply_add_words = multiply_add_words,
	divide_words_by_word = divide_words_by_word,
}
