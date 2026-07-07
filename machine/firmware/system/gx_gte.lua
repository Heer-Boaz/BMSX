local gx_gte<const> = {}

local data<const>: *word[32] = 0x08010374
local control<const>: *word[32] = 0x080103f4
local command<const>: *word = 0x08010474
local cycles<const>: *word = 0x08010478

local opcode_rtsf<const> = 0x00080000
local opcode_rtps<const> = 0x00000001
local opcode_nclip<const> = 0x00000006
local opcode_rtpt<const> = 0x00000030

local q12_one<const> = 0x00001000

local pack_i16_pair<const> = function(lo, hi)
	return (lo & 0x0000ffff) | ((hi & 0x0000ffff) << 16)
end

local sx<const> = function(sxy)
	local value<const> = sxy & 0x0000ffff
	return value >= 0x00008000 and value - 0x00010000 or value
end

local sy<const> = function(sxy)
	local value<const> = (sxy >> 16) & 0x0000ffff
	return value >= 0x00008000 and value - 0x00010000 or value
end

function gx_gte.set_screen_offset(x, y)
	control[24] = x << 16
	control[25] = y << 16
end

function gx_gte.set_projection_h(h)
	control[26] = h
end

function gx_gte.set_y_rotation_translation(sin_q12, cos_q12, tx, ty, tz)
	control[0] = pack_i16_pair(cos_q12, 0)
	control[1] = pack_i16_pair(sin_q12, 0)
	control[2] = pack_i16_pair(q12_one, 0)
	control[3] = pack_i16_pair(0 - sin_q12, 0)
	control[4] = cos_q12
	control[5] = tx
	control[6] = ty
	control[7] = tz
end

function gx_gte.rtps(x, y, z)
	data[0] = pack_i16_pair(x, y)
	data[1] = z & 0x0000ffff
	*command = opcode_rtsf | opcode_rtps
	local sxy2<const> = data[14]
	return sx(sxy2), sy(sxy2), data[19]
end

function gx_gte.rtpt(x0, y0, z0, x1, y1, z1, x2, y2, z2)
	data[0] = pack_i16_pair(x0, y0)
	data[1] = z0 & 0x0000ffff
	data[2] = pack_i16_pair(x1, y1)
	data[3] = z1 & 0x0000ffff
	data[4] = pack_i16_pair(x2, y2)
	data[5] = z2 & 0x0000ffff
	*command = opcode_rtsf | opcode_rtpt
	local sxy0<const> = data[12]
	local sxy1<const> = data[13]
	local sxy2<const> = data[14]
	return sx(sxy0), sy(sxy0), data[17],
		sx(sxy1), sy(sxy1), data[18],
		sx(sxy2), sy(sxy2), data[19]
end

function gx_gte.nclip()
	*command = opcode_nclip
	return data[24]
end

gx_gte.data = data
gx_gte.control = control
gx_gte.command = command
gx_gte.cycles = cycles
gx_gte.pack_i16_pair = pack_i16_pair
gx_gte.opcode_rtsf = opcode_rtsf
gx_gte.opcode_rtps = opcode_rtps
gx_gte.opcode_nclip = opcode_nclip
gx_gte.opcode_rtpt = opcode_rtpt

return gx_gte
