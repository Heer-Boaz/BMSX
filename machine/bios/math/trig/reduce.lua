-- Binary32 argument reduction adapted from newlib's ef_rem_pio2.c and
-- kf_rem_pio2.c (https://github.com/mirror/newlib-cygwin/tree/master/newlib/libm/math).
-- Conversion to float by Ian Lance Taylor, Cygnus Support.
-- Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
-- Developed at SunPro, a Sun Microsystems, Inc. business.
-- Permission to use, copy, modify, and distribute this software is freely
-- granted, provided that this notice is preserved.

-- Eight-bit digits keep the three-term convolution exact in a single word.
-- Two leading zeros address the omitted prefix without a per-term branch.
rodata two_over_pi: u8[77] = {
	0, 0,
	0xa2, 0xf9, 0x83, 0x6e, 0x4e, 0x44, 0x15, 0x29, 0xfc,
	0x27, 0x57, 0xd1, 0xf5, 0x34, 0xdd, 0xc0, 0xdb, 0x62,
	0x95, 0x99, 0x3c, 0x43, 0x90, 0x41, 0xfe, 0x51, 0x63,
	0xab, 0xde, 0xbb, 0xc5, 0x61, 0xb7, 0x24, 0x6e, 0x3a,
	0x42, 0x4d, 0xd2, 0xe0, 0x06, 0x49, 0x2e, 0xea, 0x09,
	0xd1, 0x92, 0x1c, 0xfe, 0x1d, 0xeb, 0x1c, 0xb1, 0x29,
	0xa7, 0x3e, 0xe8, 0x82, 0x35, 0xf5, 0x2e, 0xbb, 0x44,
	0x84, 0xe9, 0x9c, 0x70, 0x26, 0xb4, 0x5f, 0x7e, 0x41,
	0x39, 0x91, 0xd6,
}
rodata pi_over_two: f32[10] = {
	1.5703125000, 4.5776367188e-4, 2.5987625122e-5, 7.5437128544e-8,
	6.0026650317e-11, 7.3896444519e-13, 5.3845816694e-15,
	5.6378512969e-18, 8.3009228831e-20, 3.2756352257e-22,
}

local pio2_1<const> = 1.5707855225
local pio2_1t<const> = 1.0804334124e-5
local pio2_2<const> = 1.0804273188e-5
local pio2_2t<const> = 6.0770999344e-11
local pio2_3<const> = 6.0770943833e-11
local pio2_3t<const> = 6.1232342629e-17

local reduce_large<const> = function(word)
	local exponent<const> = (word >> 23) - 134
	local significand<const> = (word & 0x7fffff) | 0x800000
	local x0<const> = significand >> 16
	local x1<const> = (significand >> 8) & 0xff
	local x2<const> = significand & 0xff
	local jv = (exponent - 3) // 8
	if jv < 0 then jv = 0 end
	local q0<const> = exponent - 8 * (jv + 1)
	-- q0 is in [-8, 2]; this is its exact normal power of two.
	local scale = blua32.float_from_bits((q0 + 127) << 23)
	local digits<const>: *u8 = two_over_pi
	local pio2<const>: *f32 = pi_over_two
	-- Invocation-local workspaces also permit an IRQ to enter trigonometry.
	local q<const> = {}
	local iq<const> = {}
	local fq<const> = {}
	local jz = 9
	for i = 0, jz do
		q[i] = x0 * digits[jv + i + 2] + x1 * digits[jv + i + 1] + x2 * digits[jv + i]
	end
	local n
	local z
	local ih
	while true do
		local carry = q[jz]
		for i = 0, jz - 1 do
			iq[i] = carry & 0xff
			carry = q[jz - i - 1] + (carry >> 8)
		end
		z = carry * scale
		z = z - 8.0 * ((z * 0.125) // 1)
		n = (z // 1) & -1
		z = z - n
		ih = 0
		if q0 > 0 then
			local top<const> = iq[jz - 1] >> (8 - q0)
			n = n + top
			iq[jz - 1] = iq[jz - 1] - (top << (8 - q0))
			ih = iq[jz - 1] >> (7 - q0)
		elseif q0 == 0 then
			ih = iq[jz - 1] >> 7
		elseif z >= 0.5 then
			ih = 2
		end
		if ih > 0 then
			n = n + 1
			carry = 0
			for i = 0, jz - 1 do
				local digit<const> = iq[i]
				if carry == 0 then
					if digit ~= 0 then carry = 1; iq[i] = 256 - digit end
				else
					iq[i] = 255 - digit
				end
			end
			if q0 > 0 then iq[jz - 1] = iq[jz - 1] & (0xff >> q0) end
			if ih == 2 then
				z = 1.0 - z
				if carry ~= 0 then z = z - scale end
			end
		end
		if z ~= 0 then break end
		local cancellation = 0
		for i = jz - 1, 9, -1 do cancellation = cancellation | iq[i] end
		if cancellation ~= 0 then break end
		local extra = 1
		while iq[9 - extra] == 0 do extra = extra + 1 end
		for i = jz + 1, jz + extra do
			q[i] = x0 * digits[jv + i + 2] + x1 * digits[jv + i + 1] + x2 * digits[jv + i]
		end
		jz = jz + extra
	end
	if z == 0 then
		jz = jz - 1
		scale = scale * 0.00390625
		while iq[jz] == 0 do jz = jz - 1; scale = scale * 0.00390625 end
	else
		z = z / scale
		if z >= 256.0 then
			local carry<const> = (z // 256.0) & -1
			iq[jz] = (z - 256.0 * carry) & -1
			jz = jz + 1
			scale = scale * 256.0
			iq[jz] = carry
		else
			iq[jz] = z & -1
		end
	end
	for i = jz, 0, -1 do q[i] = scale * iq[i]; scale = scale * 0.00390625 end
	for i = jz, 0, -1 do
		local sum = 0.0
		local last = jz - i
		if last > 9 then last = 9 end
		for k = 0, last do sum = sum + pio2[k] * q[i + k] end
		fq[jz - i] = sum
	end
	local head = 0.0
	for i = jz, 0, -1 do head = head + fq[i] end
	local tail = fq[0] - head
	for i = 1, jz do tail = tail + fq[i] end
	if ih ~= 0 then return n & 7, -head, -tail end
	return n & 7, head, tail
end

-- The caller supplies a finite Float; this function retains a two-Float
-- remainder so the kernels can compensate cancellation close to quadrants.
return function(x)
	local word<const> = blua32.float_bits(x)
	local magnitude<const> = word & 0x7fffffff
	if magnitude <= 0x3f490fd8 then return 0, x, 0.0 end
	local sign<const> = word < 0 and -1 or 1
	if magnitude <= 0x43490f80 then
		local value<const> = blua32.float_from_bits(magnitude)
		local n<const> = ((value * 6.3661980629e-1 + 0.5) // 1) & -1
		local r = value - n * pio2_1
		local w = n * pio2_1t
		local head = r - w
		local exponent<const> = magnitude >> 23
		if exponent - ((blua32.float_bits(head) >> 23) & 0xff) > 8 then
			local previous<const> = r
			w = n * pio2_2
			r = previous - w
			w = n * pio2_2t - ((previous - r) - w)
			head = r - w
			if exponent - ((blua32.float_bits(head) >> 23) & 0xff) > 25 then
				local previous<const> = r
				w = n * pio2_3
				r = previous - w
				w = n * pio2_3t - ((previous - r) - w)
				head = r - w
			end
		end
		return sign * n, sign * head, sign * ((r - head) - w)
	end
	local n<const>, head<const>, tail<const> = reduce_large(magnitude)
	return sign * n, sign * head, sign * tail
end
