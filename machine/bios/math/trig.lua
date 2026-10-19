-- Binary64 trigonometry, adapted from Sun fdlibm / OpenLibm:
-- https://github.com/JuliaMath/openlibm/tree/master/src
-- k_sin.c, k_cos.c, k_tan.c, e_rem_pio2.c and k_rem_pio2.c.
-- Copyright (C) 1993, 2004 Sun Microsystems, Inc. All rights reserved.
-- Developed at SunSoft, a Sun Microsystems, Inc. business.
-- Permission to use, copy, modify, and distribute this software is freely
-- granted, provided that this notice is preserved.

-- Two leading zero limbs let the three-term product address the omitted
-- integer prefix directly. The remaining limbs are 24-bit digits of 2/pi.
rodata two_over_pi: word[68] = {
	0, 0,
	0xa2f983, 0x6e4e44, 0x1529fc, 0x2757d1, 0xf534dd, 0xc0db62,
	0x95993c, 0x439041, 0xfe5163, 0xabdebb, 0xc561b7, 0x246e3a,
	0x424dd2, 0xe00649, 0x2eea09, 0xd1921c, 0xfe1deb, 0x1cb129,
	0xa73ee8, 0x8235f5, 0x2ebb44, 0x84e99c, 0x7026b4, 0x5f7e41,
	0x3991d6, 0x398353, 0x39f49c, 0x845f8b, 0xbdf928, 0x3b1ff8,
	0x97ffde, 0x05980f, 0xef2f11, 0x8b5a0a, 0x6d1f6d, 0x367ecf,
	0x27cb09, 0xb74f46, 0x3f669e, 0x5fea2d, 0x7527ba, 0xc7ebe5,
	0xf17b3d, 0x0739f7, 0x8a5292, 0xea6bfb, 0x5fb11f, 0x8d5d08,
	0x560330, 0x46fc7b, 0x6babf0, 0xcfbc20, 0x9af436, 0x1da9e3,
	0x91615e, 0xe61b08, 0x659985, 0x5f14a0, 0x68408d, 0xffd880,
	0x4d7327, 0x310606, 0x1556ca, 0x73a8c9, 0x60e27b, 0xc08c6b,
}

rodata pi_over_two: f64[5] = {
	1.57079625129699707031,
	7.54978941586159635335e-8,
	5.39030252995776476554e-15,
	3.28200341580791294123e-22,
	1.27065575308067607349e-29,
}

local quarter_pi<const> = 0.78539816339744830962
local huge<const> = 1 / 0
local two24<const> = 16777216
local inv_two24<const> = 1 / two24
local two256<const> = 2 ^ 256
local inv_two256<const> = 2 ^ -256
local invpio2<const> = 6.36619772367581382433e-1
local pio2_1<const> = 1.57079632673412561417
local pio2_1t<const> = 6.07710050650619224932e-11
local pio2_2<const> = 6.07710050630396597660e-11
local pio2_2t<const> = 2.02226624879595063154e-21
local pio2_3<const> = 2.02226624871116645580e-21
local pio2_3t<const> = 8.47842766036889956997e-32

local kernel_sin<const> = function(x, y)
	local z<const> = x * x
	local w<const> = z * z
	local r<const> = 8.33333333332248946124e-3
		+ z * (-1.98412698298579493134e-4 + z * 2.75573137070700676789e-6)
		+ z * w * (-2.50507602534068634195e-8 + z * 1.58969099521155010221e-10)
	local v<const> = z * x
	return x - ((z * (0.5 * y - v * r) - y) - v * -1.66666666666666324348e-1)
end

local kernel_cos<const> = function(x, y)
	local z<const> = x * x
	local w<const> = z * z
	local r<const> = z * (4.16666666666666019037e-2
		+ z * (-1.38888888888741095749e-3 + z * 2.48015872894767294178e-5))
		+ w * w * (-2.75573143513906633035e-7
			+ z * (2.08757232129817482790e-9 + z * -1.13596475577881948265e-11))
	local half_z<const> = 0.5 * z
	local head<const> = 1 - half_z
	return head + (((1 - head) - half_z) + (z * r - x * y))
end

local kernel_tan<const> = function(x, y, reciprocal)
	local magnitude = x
	local sign = 1
	if x < 0 then
		magnitude = -x
		sign = -1
	end
	local transformed<const> = magnitude >= 0.6743354797363281
	if transformed then
		x = sign * x
		y = sign * y
		x = (quarter_pi - x) + (3.06161699786838301793e-17 - y)
		y = 0
	end
	local z<const> = x * x
	local w<const> = z * z
	local r = 1.33333333333201242699e-1 + w * (2.18694882948595424599e-2
		+ w * (3.59207910759131235356e-3 + w * (5.88041240820264096874e-4
			+ w * (7.81794442939557092300e-5 + w * -1.85586374855275456654e-5))))
	local v<const> = z * (5.39682539762260521377e-2 + w * (8.86323982359930005737e-3
		+ w * (1.45620945432529025516e-3 + w * (2.46463134818469906812e-4
			+ w * (7.14072491382608190305e-5 + w * 2.59073051863633712884e-5)))))
	local s<const> = z * x
	r = y + z * (s * (r + v) + y) + 3.33333333333334091986e-1 * s
	local result<const> = x + r
	if transformed then
		return sign * (reciprocal - 2 * (x - (result * result / (result + reciprocal) - r)))
	end
	if reciprocal == 1 then
		return result
	end
	-- fdlibm's direct reciprocal variant has a two-ULP error bound.
	return -1 / result
end

local reduce_large<const> = function(x)
	-- Normalize arithmetically; no writable bit-cast scratch or shared work
	-- buffer is needed. Convolution products use exact 24-bit integer limbs.
	local z = x
	local exponent = 0
	while z >= two256 * 8388608 do
		z = z * inv_two256
		exponent = exponent + 256
	end
	while z >= two24 * 8388608 do
		z = z * inv_two24
		exponent = exponent + 24
	end
	while z >= two24 do
		z = z * 0.5
		exponent = exponent + 1
	end
	while z < 8388608 do
		z = z * 2
		exponent = exponent - 1
	end
	local x0<const> = z // 1
	z = (z - x0) * two24
	local x1<const> = z // 1
	local x2<const> = (z - x1) * two24
	local jv = (exponent - 3) // 24
	if jv < 0 then jv = 0 end
	local q0 = exponent - 24 * (jv + 1)
	local digits<const>: *word = two_over_pi
	local pio2<const>: *f64 = pi_over_two
	-- Only the large-argument path needs convolution workspaces. They belong
	-- to this invocation, so IRQ re-entry cannot overwrite another reduction.
	local q<const> = {}
	local iq<const> = {}
	local fq<const> = {}
	local jz = 4
	for i = 0, jz do
		q[i] = x0 * digits[jv + i + 2] + x1 * digits[jv + i + 1] + x2 * digits[jv + i]
	end
	local n
	local ih
	while true do
		z = q[jz]
		for i = 0, jz - 1 do
			local carry<const> = (z * inv_two24) // 1
			iq[i] = z - two24 * carry
			z = q[jz - i - 1] + carry
		end
		z = z * 2 ^ q0
		z = z - 8 * ((z * 0.125) // 1)
		n = z // 1
		z = z - n
		ih = 0
		if q0 > 0 then
			local top<const> = iq[jz - 1] >> (24 - q0)
			n = n + top
			iq[jz - 1] = iq[jz - 1] - (top << (24 - q0))
			ih = iq[jz - 1] >> (23 - q0)
		elseif q0 == 0 then
			ih = iq[jz - 1] >> 23
		elseif z >= 0.5 then
			ih = 2
		end
		if ih > 0 then
			n = n + 1
			local carry = 0
			for i = 0, jz - 1 do
				local digit<const> = iq[i]
				if carry == 0 then
					if digit ~= 0 then
						carry = 1
						iq[i] = two24 - digit
					end
				else
					iq[i] = 16777215 - digit
				end
			end
			if q0 > 0 then
				iq[jz - 1] = iq[jz - 1] & (16777215 >> q0)
			end
			if ih == 2 then
				z = 1 - z
				if carry ~= 0 then z = z - 2 ^ q0 end
			end
		end
		local cancellation = 0
		if z == 0 then
			for i = jz - 1, 4, -1 do cancellation = cancellation | iq[i] end
		else
			break
		end
		if cancellation ~= 0 then break end
		local extra = 1
		while iq[4 - extra] == 0 do extra = extra + 1 end
		for i = jz + 1, jz + extra do
			q[i] = x0 * digits[jv + i + 2] + x1 * digits[jv + i + 1] + x2 * digits[jv + i]
		end
		jz = jz + extra
	end
	if z == 0 then
		jz = jz - 1
		q0 = q0 - 24
		while iq[jz] == 0 do
			jz = jz - 1
			q0 = q0 - 24
		end
	else
		z = z * 2 ^ -q0
		if z >= two24 then
			local carry<const> = (z * inv_two24) // 1
			iq[jz] = z - two24 * carry
			jz = jz + 1
			q0 = q0 + 24
			iq[jz] = carry
		else
			iq[jz] = z // 1
		end
	end
	local scale = 2 ^ q0
	for i = jz, 0, -1 do
		q[i] = scale * iq[i]
		scale = scale * inv_two24
	end
	for i = jz, 0, -1 do
		local sum = 0
		local last = jz - i
		if last > 4 then last = 4 end
		for k = 0, last do sum = sum + pio2[k] * q[i + k] end
		fq[jz - i] = sum
	end
	local head = 0
	for i = jz, 0, -1 do head = head + fq[i] end
	local tail = fq[0] - head
	for i = 1, jz do tail = tail + fq[i] end
	if ih ~= 0 then return n & 7, -head, -tail end
	return n & 7, head, tail
end

local reduce<const> = function(x)
	local magnitude = x
	local sign = 1
	if x < 0 then
		magnitude = -x
		sign = -1
	end
	if magnitude <= quarter_pi then return 0, x, 0 end
	-- IEEE infinities and NaNs produce NaN, not a converted phase word.
	if not (magnitude < huge) then return 0, x - x, 0 end
	if magnitude < 1647099 then
		local n = magnitude * invpio2 + 6755399441055744
		n = n - 6755399441055744
		local r = magnitude - n * pio2_1
		local w = n * pio2_1t
		local head = r - w
		if head <= magnitude / 65536 and head >= -magnitude / 65536 then
			local previous<const> = r
			w = n * pio2_2
			r = previous - w
			w = n * pio2_2t - ((previous - r) - w)
			head = r - w
			if head <= magnitude / 562949953421312 and head >= -magnitude / 562949953421312 then
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

local sin<const> = function(x)
	if x > -1.490116119384765625e-8 and x < 1.490116119384765625e-8 then return x end
	local n<const>, head<const>, tail<const> = reduce(x)
	local quadrant<const> = n & 3
	if quadrant == 0 then return kernel_sin(head, tail) end
	if quadrant == 1 then return kernel_cos(head, tail) end
	if quadrant == 2 then return -kernel_sin(head, tail) end
	return -kernel_cos(head, tail)
end

local cos<const> = function(x)
	local n<const>, head<const>, tail<const> = reduce(x)
	local quadrant<const> = n & 3
	if quadrant == 0 then return kernel_cos(head, tail) end
	if quadrant == 1 then return -kernel_sin(head, tail) end
	if quadrant == 2 then return -kernel_cos(head, tail) end
	return kernel_sin(head, tail)
end

local tan<const> = function(x)
	if x > -7.450580596923828125e-9 and x < 7.450580596923828125e-9 then return x end
	local n<const>, head<const>, tail<const> = reduce(x)
	return kernel_tan(head, tail, 1 - 2 * (n & 1))
end

return { sin = sin, cos = cos, tan = tan }
