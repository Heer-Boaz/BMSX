-- Binary32 kernels adapted from newlib's kf_sin.c, kf_cos.c and kf_tan.c:
-- https://github.com/mirror/newlib-cygwin/tree/master/newlib/libm/math
-- Conversion to float by Ian Lance Taylor, Cygnus Support.
-- Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
-- Developed at SunPro, a Sun Microsystems, Inc. business.
-- Permission to use, copy, modify, and distribute this software is freely
-- granted, provided that this notice is preserved.

local reduce<const> = require('math/trig/reduce')

local kernel_sin<const> = function(x, y)
	if (blua32.float_bits(x) & 0x7fffffff) < 0x32000000 then return x end
	local z<const> = x * x
	local v<const> = z * x
	local r<const> = 8.3333337680e-3 + z * (-1.9841270114e-4
		+ z * (2.7557314297e-6 + z * (-2.5050759689e-8 + z * 1.5896910177e-10)))
	return x - ((z * (0.5 * y - v * r) - y) - v * -1.6666667163e-1)
end

local kernel_cos<const> = function(x, y)
	local magnitude<const> = blua32.float_bits(x) & 0x7fffffff
	if magnitude < 0x32000000 then return 1.0 end
	local z<const> = x * x
	local r<const> = z * (4.1666667908e-2 + z * (-1.3888889225e-3
		+ z * (2.4801587642e-5 + z * (-2.7557314297e-7
			+ z * (2.0875723372e-9 + z * -1.1359647598e-11)))))
	if magnitude < 0x3e99999a then return 1.0 - (0.5 * z - (z * r - x * y)) end
	local qx = 0.28125
	if magnitude <= 0x3f480000 then qx = blua32.float_from_bits(magnitude - 0x01000000) end
	local half_z<const> = 0.5 * z - qx
	local head<const> = 1.0 - qx
	return head - (half_z - (z * r - x * y))
end

local kernel_tan<const> = function(x, y, reciprocal)
	local word<const> = blua32.float_bits(x)
	local magnitude<const> = word & 0x7fffffff
	if magnitude < 0x31800000 then
		if reciprocal == 1 then return x end
		return -1.0 / x
	end
	local transformed<const> = magnitude >= 0x3f2ca140
	if transformed then
		if word < 0 then x, y = -x, -y end
		x = (7.8539812565e-1 - x) + (3.7748947079e-8 - y)
		y = 0.0
	end
	local z<const> = x * x
	local w<const> = z * z
	local r = 1.3333334029e-1 + w * (2.1869488060e-2
		+ w * (3.5920790397e-3 + w * (5.8804126456e-4
			+ w * (7.8179444245e-5 + w * -1.8558637748e-5))))
	local v = z * (5.3968254477e-2 + w * (8.8632395491e-3
		+ w * (1.4562094584e-3 + w * (2.4646313977e-4
			+ w * (7.1407252108e-5 + w * 2.5907305826e-5)))))
	local s<const> = z * x
	r = y + z * (s * (r + v) + y)
	r = r + 3.3333334327e-1 * s
	local result<const> = x + r
	if transformed then
		local sign<const> = word < 0 and -1.0 or 1.0
		return sign * (reciprocal - 2.0 * (x - (result * result / (result + reciprocal) - r)))
	end
	if reciprocal == 1 then return result end
	-- Split the reciprocal so cancellation does not discard its low part.
	local head<const> = blua32.float_from_bits(blua32.float_bits(result) & 0xfffff000)
	v = r - (head - x)
	local inverse<const> = -1.0 / result
	local inverse_head<const> = blua32.float_from_bits(blua32.float_bits(inverse) & 0xfffff000)
	return inverse_head + inverse * ((1.0 + inverse_head * head) + inverse_head * v)
end

local sin<const> = function(x)
	-- Multiplication converts Integer inputs and preserves a Float zero's sign.
	x = x * 1.0
	local magnitude<const> = blua32.float_bits(x) & 0x7fffffff
	if magnitude <= 0x3f490fd8 then return kernel_sin(x, 0.0) end
	if magnitude >= 0x7f800000 then return x - x end
	local n<const>, head<const>, tail<const> = reduce(x)
	local quadrant<const> = n & 3
	if quadrant == 0 then return kernel_sin(head, tail) end
	if quadrant == 1 then return kernel_cos(head, tail) end
	if quadrant == 2 then return -kernel_sin(head, tail) end
	return -kernel_cos(head, tail)
end

local cos<const> = function(x)
	x = x * 1.0
	local magnitude<const> = blua32.float_bits(x) & 0x7fffffff
	if magnitude <= 0x3f490fd8 then return kernel_cos(x, 0.0) end
	if magnitude >= 0x7f800000 then return x - x end
	local n<const>, head<const>, tail<const> = reduce(x)
	local quadrant<const> = n & 3
	if quadrant == 0 then return kernel_cos(head, tail) end
	if quadrant == 1 then return -kernel_sin(head, tail) end
	if quadrant == 2 then return -kernel_cos(head, tail) end
	return kernel_sin(head, tail)
end

local tan<const> = function(x)
	x = x * 1.0
	local magnitude<const> = blua32.float_bits(x) & 0x7fffffff
	if magnitude <= 0x3f490fd8 then return kernel_tan(x, 0.0, 1) end
	if magnitude >= 0x7f800000 then return x - x end
	local n<const>, head<const>, tail<const> = reduce(x)
	return kernel_tan(head, tail, 1 - 2 * (n & 1))
end

return { sin = sin, cos = cos, tan = tan }
