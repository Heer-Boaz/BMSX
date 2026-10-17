module<entry>

local gte<const> = require('cartlib/gx/gte')

local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
local data<const>: *word[32] = gte.data
local control<const>: *word[32] = gte.control
local command<const>: *word = gte.command
local pmode<const>: *word = 0x08010354
local framebuffer<const>: *word = 0x0801035c
local source<const>: *word = 0x08010360
local display_extent<const>: *word = 0x08010368
local pcrtc_csr<const>: *word = 0x080103d4

local vblank_sequence = 0

function irq(flags)
	*irq_ack = flags
	vblank_sequence = vblank_sequence + 1
end

*irq_mask = 0
*pcrtc_csr = 0x00000200
*source = 0x00000000
*display_extent = 0x000bf3ff

-- Rotation: Q12 identity. Translation: integer position units.
control[gte.control_r11r12] = gte.pack_i16_pair(4096, 0)
control[gte.control_r13r21] = gte.pack_i16_pair(0, 0)
control[gte.control_r22r23] = gte.pack_i16_pair(4096, 0)
control[gte.control_r31r32] = gte.pack_i16_pair(0, 0)
control[gte.control_r33] = 4096
control[gte.control_trx] = 0x00000000
control[gte.control_try] = 0x00000000
control[gte.control_trz] = 0x00000000
-- Project onto a 256 x 192 drawing area centred at (128,96).
control[gte.control_ofx] = 128 << 16
control[gte.control_ofy] = 96 << 16
control[gte.control_h] = 256
control[gte.control_dqa] = 0x00000000
control[gte.control_dqb] = 0x00000000

-- Light and color matrices: Q12 identity, zero ambient.
control[gte.control_l11l12] = gte.pack_i16_pair(4096, 0)
control[gte.control_l13l21] = gte.pack_i16_pair(0, 0)
control[gte.control_l22l23] = gte.pack_i16_pair(4096, 0)
control[gte.control_l31l32] = gte.pack_i16_pair(0, 0)
control[gte.control_l33] = 4096
control[gte.control_rbk] = 0x00000000
control[gte.control_gbk] = 0x00000000
control[gte.control_bbk] = 0x00000000
control[gte.control_lr1lr2] = gte.pack_i16_pair(4096, 0)
control[gte.control_lr3lg1] = gte.pack_i16_pair(0, 0)
control[gte.control_lg2lg3] = gte.pack_i16_pair(4096, 0)
control[gte.control_lb1lb2] = gte.pack_i16_pair(0, 0)
control[gte.control_lb3] = 4096

*gp0 = 0xe1000400
*gp0 = 0xe6000000
*irq_ack = 0xffffffff
*irq_mask = 0x00000004

local back = 0
local frame = 0

while true do
	local base_y<const> = back << 8
	*gp0 = 0xe3000000 | (base_y << 10)
	*gp0 = 0xe40000ff | ((base_y + 191) << 10)
	*gp0 = 0xe5000000 | (base_y << 11)
	*gp0 = 0x02000000
	*gp0 = base_y << 16
	*gp0 = 0x00c00100

	control[gte.control_trx] = ((frame >> 5) & 1) << 5
	data[gte.data_vxy0] = gte.pack_i16_pair(-64, -64)
	data[gte.data_vz0] = 0x00000200
	data[gte.data_vxy1] = gte.pack_i16_pair(64, -64)
	data[gte.data_vz1] = 0x00000200
	data[gte.data_vxy2] = gte.pack_i16_pair(0, 64)
	data[gte.data_vz2] = 0x00000200
	*command = gte.opcode_rtpt | gte.command_sf_shift_12
	local xy0<const> = data[gte.data_sxy0]
	local xy1<const> = data[gte.data_sxy1]
	local xy2<const> = data[gte.data_sxy2]
	*command = gte.opcode_nclip
	local doubled_area<const> = data[gte.data_mac0]

	-- MAC0 is read as a raw word; select positive signed area, excluding zero.
	if doubled_area ~= 0 and (doubled_area & 0x80000000) == 0 then
		-- Supplied vertex-lighting directions, not triangle positions.
		data[gte.data_vxy0] = gte.pack_i16_pair(4096, 0)
		data[gte.data_vz0] = 0x00000000
		data[gte.data_vxy1] = gte.pack_i16_pair(0, 4096)
		data[gte.data_vz1] = 0x00000000
		data[gte.data_vxy2] = gte.pack_i16_pair(0, 0)
		data[gte.data_vz2] = 4096
		data[gte.data_rgb] = 0x004080a0
		*command = gte.opcode_ncct | gte.command_sf_shift_12 | gte.command_lm_positive
		*gp0 = 0x30000000 | (data[gte.data_rgb0] & 0x00ffffff)
		*gp0 = xy0
		*gp0 = data[gte.data_rgb1] & 0x00ffffff
		*gp0 = xy1
		*gp0 = data[gte.data_rgb2] & 0x00ffffff
		*gp0 = xy2
	end

	while (*gp1 & 0x04000000) == 0 do
	end
	*framebuffer = 0x000fa000 | (back << 6)
	*pmode = 0x0000ff21
	local before<const> = vblank_sequence
	while vblank_sequence == before do
		halt_until_irq
	end
	back = 1 - back
	frame = frame + 1
end
