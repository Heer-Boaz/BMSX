local fixed<const> = {}
local word_sign<const> = 0x80000000
local word_range<const> = 0x100000000
local s16_16_scale<const> = 0x00010000

-- Decodes one raw signed S16.16 device word at the fixed-point owner.
function fixed.decode_s16_16(word)
	local signed = word
	if signed >= word_sign then
		signed = signed - word_range
	end
	return signed / s16_16_scale
end

return fixed
