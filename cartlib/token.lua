local string_byte<const> = string.byte

local token<const> = {}
local fnv_prime_low<const> = 0x1b3
local u32_mod<const> = 0x100000000

-- Produces the same raw FNV-1a 64-bit token pair stored in the ROM TOC.
function token.hash(id)
	local lo = 0x84222325
	local hi = 0xcbf29ce4
	for index = 1, #id do
		local xored_lo<const> = (lo ~ string_byte(id, index)) % u32_mod
		local lo_mul<const> = xored_lo * fnv_prime_low
		local carry<const> = lo_mul // u32_mod
		local hi_mul<const> = hi * fnv_prime_low + carry
		lo = lo_mul % u32_mod
		hi = ((hi_mul % u32_mod) + ((xored_lo * 256) % u32_mod)) % u32_mod
	end
	return lo, hi
end

return token
