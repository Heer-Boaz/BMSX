local types<const> = require('kernel/value_type')

return function(value, byte_count)
	local tag<const> = blua32.tag(value)
	if tag ~= types.integer_tag and tag ~= types.float_tag then error('string.pack float value must be a number.') end
	if byte_count == 4 then
		if tag == types.integer_tag then value = value * 1.0 end
		return blua32.float_bits(value)
	end
	if tag == types.integer_tag then
		if value == 0 then return 0, 0 end
		local sign = 0
		if value < 0 then sign = 0x80000000; value = -value end
		local exponent = 31
		while (value & 0x80000000) == 0 do value = value << 1; exponent = exponent - 1 end
		return sign | ((exponent + 1023) << 20) | ((value >> 11) & 0xfffff), value << 21
	end
	local word<const> = blua32.float_bits(value)
	local sign<const> = word & 0x80000000
	local exponent = (word >> 23) & 0xff
	local fraction = word & 0x7fffff
	if exponent == 0xff then
		if fraction ~= 0 then return 0x7ff80000, 0 end
		return sign | 0x7ff00000, 0
	end
	if exponent == 0 then
		if fraction == 0 then return sign, 0 end
		exponent = 1
		while (fraction & 0x800000) == 0 do fraction = fraction << 1; exponent = exponent - 1 end
		fraction = fraction & 0x7fffff
	end
	return sign | ((exponent + 896) << 20) | (fraction >> 3), fraction << 29
end
