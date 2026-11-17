module<const>

-- IEEE narrowing by retained significand, guard and sticky bits, as in
-- compiler-rt's fp_trunc_impl.inc. The binary64 field stays two raw words.
return function(high, low, byte_count)
	high = high & -1
	if byte_count == 4 then return blua32.float_from_bits(high) end
	low = low & -1
	local sign<const> = high & 0x80000000
	local exponent<const> = (high >> 20) & 0x7ff
	local fraction<const> = high & 0xfffff
	if exponent == 0x7ff then
		if fraction ~= 0 or low ~= 0 then return blua32.float_from_bits(0x7fc00000) end
		return blua32.float_from_bits(sign | 0x7f800000)
	end
	if exponent > 1150 then return blua32.float_from_bits(sign | 0x7f800000) end
	if exponent < 873 then return blua32.float_from_bits(sign) end
	local significand<const> = fraction | 0x100000
	local retained
	local guard
	local sticky
	if exponent >= 897 then
		retained = (significand << 3) | (low >> 29)
		guard = low & 0x10000000
		sticky = low & 0x0fffffff
		if guard ~= 0 and (sticky ~= 0 or (retained & 1) ~= 0) then retained = retained + 1 end
		-- Carry from the significand naturally advances the encoded exponent.
		return blua32.float_from_bits(sign | ((exponent - 897) << 23) + retained)
	end
	local shift<const> = 926 - exponent
	if shift < 32 then
		retained = (significand << (32 - shift)) | (low >> shift)
		guard = low & (1 << (shift - 1))
		sticky = low & ((1 << (shift - 1)) - 1)
	elseif shift == 32 then
		retained = significand
		guard = low & 0x80000000
		sticky = low & 0x7fffffff
	else
		local high_shift<const> = shift - 32
		retained = significand >> high_shift
		guard = significand & (1 << (high_shift - 1))
		sticky = (significand & ((1 << (high_shift - 1)) - 1)) | low
	end
	if guard ~= 0 and (sticky ~= 0 or (retained & 1) ~= 0) then retained = retained + 1 end
	return blua32.float_from_bits(sign | retained)
end
