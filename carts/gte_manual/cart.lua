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

-- Fixed ROM operands. Matrix coefficients use the Q12 convention.
rodata model_to_view: gte_transform = {
	rotation = {
		rows = { { 4096, 0, 0 }, { 0, 4096, 0 }, { 0, 0, 4096 } },
		pad = 0,
	},
	translation = { 0, 0, 0 },
}

rodata projection: gte_projection = {
	offset_x = 128 << 16,
	offset_y = 96 << 16,
	h = 256,
	cue_gain = 0,
	cue_offset = 0,
}

rodata light_directions: gte_matrix = {
	rows = { { 4096, 0, 0 }, { 0, 4096, 0 }, { 0, 0, 4096 } },
	pad = 0,
}
rodata light_colors: gte_matrix = {
	rows = { { 4096, 0, 0 }, { 0, 4096, 0 }, { 0, 0, 4096 } },
	pad = 0,
}
rodata ambient: word[3] = { 0, 0, 0 }

rodata triangle: gte_vector[3] = {
	{ x = -64, y = -64, z = 512, pad = 0 },
	{ x = 64, y = -64, z = 512, pad = 0 },
	{ x = 0, y = 64, z = 512, pad = 0 },
}
-- Deliberately supplied vertex-lighting directions, not positions.
rodata normals: gte_vector[3] = {
	{ x = 4096, y = 0, z = 0, pad = 0 },
	{ x = 0, y = 4096, z = 0, pad = 0 },
	{ x = 0, y = 0, z = 4096, pad = 0 },
}

bss vblank_sequence: word
bss back_buffer: word
bss frame_number: word

function irq(flags)
	*irq_ack = flags
	*vblank_sequence = *vblank_sequence + 1
end

*irq_mask = 0
*pcrtc_csr = 0x00000200
*source = 0x00000000
*display_extent = 0x000bf3ff

-- Copy raw words from the authored operands; MMIO never uses halfword stores.
local transform_words<const>: *word = model_to_view
for index = 0, sizeof(gte_transform) // 4 - 1 do
	control[gte.control_r11r12 + index] = transform_words[index]
end
local projection_words<const>: *word = projection
for index = 0, sizeof(gte_projection) // 4 - 1 do
	control[gte.control_ofx + index] = projection_words[index]
end
local direction_words<const>: *word = light_directions
local color_words<const>: *word = light_colors
for index = 0, sizeof(gte_matrix) // 4 - 1 do
	control[gte.control_l11l12 + index] = direction_words[index]
	control[gte.control_lr1lr2 + index] = color_words[index]
end
for channel = 0, #ambient - 1 do
	control[gte.control_rbk + channel] = ambient[channel]
end
local position_words<const>: *word = triangle
local normal_words<const>: *word = normals

*gp0 = 0xe1000400
*gp0 = 0xe6000000
*irq_ack = 0xffffffff
*irq_mask = 0x00000004

while true do
	local base_y<const> = *back_buffer << 8
	*gp0 = 0xe3000000 | (base_y << 10)
	*gp0 = 0xe40000ff | ((base_y + 191) << 10)
	*gp0 = 0xe5000000 | (base_y << 11)
	*gp0 = 0x02000000
	*gp0 = base_y << 16
	*gp0 = 0x00c00100

	control[gte.control_trx] = ((*frame_number >> 5) & 1) << 5
	for index = 0, sizeof(gte_vector[3]) // 4 - 1 do
		data[gte.data_vxy0 + index] = position_words[index]
	end
	*command = gte.opcode_rtpt | gte.command_sf_shift_12
	local xy0<const> = data[gte.data_sxy0]
	local xy1<const> = data[gte.data_sxy1]
	local xy2<const> = data[gte.data_sxy2]
	*command = gte.opcode_nclip
	local doubled_area<const> = data[gte.data_mac0]

	-- MAC0 is read as a raw word; select positive signed area, excluding zero.
	if doubled_area ~= 0 and (doubled_area & 0x80000000) == 0 then
		for index = 0, sizeof(gte_vector[3]) // 4 - 1 do
			data[gte.data_vxy0 + index] = normal_words[index]
		end
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
	*framebuffer = 0x000fa000 | (*back_buffer << 6)
	*pmode = 0x0000ff21
	local before<const> = *vblank_sequence
	while *vblank_sequence == before do
		halt_until_irq
	end
	*back_buffer = 1 - *back_buffer
	*frame_number = *frame_number + 1
end
