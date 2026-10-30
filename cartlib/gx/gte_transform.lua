module<const>

local gte<const> = require('cartlib/gx/gte')

-- A complete origin is one operand publication. Rounding is inline, so this
-- encoder has no per-coefficient calls or mutable global math lookups.
local write_origin<const> = function(x, y, z)
	local control<const>: *word = gte.control
	if x >= 0 then x = (x + 0.5) // 1
	else x = -(((-x) + 0.5) // 1) end
	control[5] = x
	if y >= 0 then y = (y + 0.5) // 1
	else y = -(((-y) + 0.5) // 1) end
	control[6] = y
	if z >= 0 then z = (z + 0.5) // 1
	else z = -(((-z) + 0.5) // 1) end
	control[7] = z
end

-- Column-major Number affines become the GTE's row-major Q12 matrix and
-- integer translation here. Object/model composition remains unnarrowed until
-- this datapath boundary; representable overflow keeps the register bit rules.
local write_affine<const> = function(xx, xy, xz, yx, yy, yz, zx, zy, zz, ox, oy, oz)
	local control<const>: *word = gte.control
	xx = xx * 4096
	if xx >= 0 then xx = (xx + 0.5) // 1
	else xx = -(((-xx) + 0.5) // 1) end
	xy = xy * 4096
	if xy >= 0 then xy = (xy + 0.5) // 1
	else xy = -(((-xy) + 0.5) // 1) end
	xz = xz * 4096
	if xz >= 0 then xz = (xz + 0.5) // 1
	else xz = -(((-xz) + 0.5) // 1) end
	yx = yx * 4096
	if yx >= 0 then yx = (yx + 0.5) // 1
	else yx = -(((-yx) + 0.5) // 1) end
	yy = yy * 4096
	if yy >= 0 then yy = (yy + 0.5) // 1
	else yy = -(((-yy) + 0.5) // 1) end
	yz = yz * 4096
	if yz >= 0 then yz = (yz + 0.5) // 1
	else yz = -(((-yz) + 0.5) // 1) end
	zx = zx * 4096
	if zx >= 0 then zx = (zx + 0.5) // 1
	else zx = -(((-zx) + 0.5) // 1) end
	zy = zy * 4096
	if zy >= 0 then zy = (zy + 0.5) // 1
	else zy = -(((-zy) + 0.5) // 1) end
	zz = zz * 4096
	if zz >= 0 then zz = (zz + 0.5) // 1
	else zz = -(((-zz) + 0.5) // 1) end
	control[0] = (xx & 0xffff) | ((yx & 0xffff) << 16)
	control[1] = (zx & 0xffff) | ((xy & 0xffff) << 16)
	control[2] = (yy & 0xffff) | ((zy & 0xffff) << 16)
	control[3] = (xz & 0xffff) | ((yz & 0xffff) << 16)
	control[4] = zz
	write_origin(ox, oy, oz)
end

return { write_affine = write_affine, write_origin = write_origin }
