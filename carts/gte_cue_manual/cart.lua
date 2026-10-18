module<entry>

local gte<const> = require('cartlib/gx/gte')
local state<const> = require('results')
local system_vram_region<const> = require('gpu/system_vram_region')
local result<const>: *gte_cue_result = state.result
local data<const>: *word[32] = gte.data
local control<const>: *word[32] = gte.control
local command<const>: *word = gte.command
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
local pmode<const>: *word = 0x08010354
local framebuffer<const>: *word = 0x0801035c
local source<const>: *word = 0x08010360
local window<const>: *word = 0x08010364
local extent<const>: *word = 0x08010368
local pcrtc_csr<const>: *word = 0x080103d4

-- Fixed ROM operands, not heap tables or a mutable register image.
rodata model_to_view: gte_transform = {
	rotation = {
		rows = { { 4096, 0, 0 }, { 0, 4096, 0 }, { 0, 0, 4096 } },
		pad = 0,
	},
	translation = { 0, 0, 0 },
}
rodata projection: gte_projection = {
	offset_x = 0,
	offset_y = 0,
	h = 128,
	cue_gain = -768,
	cue_offset = 0x01800100,
}
rodata light_directions: gte_matrix = {
	rows = { { 3072, 0, 2048 }, { -2048, 0, 3072 }, { 0, 0, -4096 } },
	pad = 0,
}
rodata light_colors: gte_matrix = {
	rows = { { 4096, 1024, 0 }, { 2048, 4096, 0 }, { 1024, 2048, 4096 } },
	pad = 0,
}
rodata ambient: word[3] = { 256, 512, 128 }
rodata far_color: word[3] = { 80 << 4, 96 << 4, 160 << 4 }
rodata normal: gte_vector = { x = 2458, y = 0, z = 3277, pad = 0 }
rodata positions: gte_vector[4] = {
	{ x = 0, y = 0, z = 256, pad = 0 },
	{ x = 0, y = 0, z = 384, pad = 0 },
	{ x = 0, y = 0, z = 512, pad = 0 },
	{ x = 0, y = 0, z = 768, pad = 0 },
}
rodata swatch_x: word[4] = { 16, 76, 136, 196 }
rodata material_x: word[3] = { 20, 100, 180 }
rodata materials: word[3] = { 0x34c060a0, 0x34c060a0, 0x34a0c040 }

function irq(flags)
	if (flags & 0x00000004) ~= 0 then
		result.vblank_sequence = result.vblank_sequence + 1
	end
	*irq_ack = flags & 0x00000004
end

-- Own GTE, ports, display, handler and both raw 256x192 surfaces.
result.system_origin, result.system_size = system_vram_region()
*irq_mask = 0
*pcrtc_csr = 0x00000200
*pmode = 0
*framebuffer = 0x000fa000
*source = 0
*window = 0x018252a8
*extent = 0x000bf3ff
*gp1 = 0x09000000

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
for channel = 0, 2 do
	control[gte.control_rbk + channel] = ambient[channel]
	control[gte.control_rfc + channel] = far_color[channel]
end
data[gte.data_rgb] = 0x34c060a0
local position_words<const>: *word = positions
local normal_words<const>: *word = normal

-- Opaque, untextured rectangles, no dither, stored mask bit set.
*gp0 = 0xe1000400
*gp0 = 0xe2000000
*gp0 = 0xe3000000
*gp0 = 0xe40000ff | (191 << 10)
*gp0 = 0xe5000000
*gp0 = 0xe6000001
*gp0 = 0x60000000
*gp0 = 0
*gp0 = 256 | (192 << 16)

for index = 0, 3 do
	-- A position chooses this sample's cue; save it before reusing V0.
	data[gte.data_vxy0] = position_words[index * 2]
	data[gte.data_vz0] = position_words[index * 2 + 1]
	*command = gte.opcode_rtps | gte.command_sf_shift_12
	result.projected_xy[index] = data[gte.data_sxy2]
	result.projected_z[index] = data[gte.data_sz3]
	result.ir0[index] = data[gte.data_ir0]
	result.projection_flags[index] = control[gte.control_flag]

	-- Restore the same supplied normal, not the position; retain IR0.
	data[gte.data_vxy0] = normal_words[0]
	data[gte.data_vz0] = normal_words[1]
	*command = gte.opcode_ncds | gte.command_sf_shift_12 | gte.command_lm_positive
	local rgb<const> = data[gte.data_rgb2]
	result.ir0_after_color[index] = data[gte.data_ir0]
	result.rgb2[index] = rgb
	result.color_flags[index] = control[gte.control_flag]

	-- CODE is not a GP0 opcode. Draw equal 44x96 screen-space swatches.
	*gp0 = 0x60000000 | (rgb & 0x00ffffff)
	*gp0 = swatch_x[index] | (48 << 16)
	*gp0 = 44 | (96 << 16)
end
for index = 0, 3 do
	*gp0 = 0xc0000000
	*gp0 = (swatch_x[index] + 22) | (96 << 16)
	*gp0 = 0x00010001
	while (*gp1 & 0x08000000) == 0 do
	end
	result.swatch_words[index] = *gp0
end
while (*gp1 & 0x04000000) == 0 do
end

*pmode = 0x0000ff21
*irq_ack = 0x00000004
local before<const> = result.vblank_sequence
result.before_vblank = before
*irq_mask = 0x00000004
while result.vblank_sequence == before do
	halt_until_irq
end
result.after_vblank = result.vblank_sequence
result.completed = 1
local hold<const> = result.vblank_sequence
while result.vblank_sequence - hold < 2 do
	halt_until_irq
end

-- Keep the first surface selected while drawing only into rows 256..447.
*irq_mask = 0
*gp0 = 0xe3000000 | (256 << 10)
*gp0 = 0xe40000ff | (447 << 10)
*gp0 = 0xe5000000 | (256 << 11)
*gp0 = 0x60000000
*gp0 = 0
*gp0 = 256 | (192 << 16)

-- NCS and NCCS do not use the IR0 left by the depth-cue comparison.
data[gte.data_vxy0] = normal_words[0]
data[gte.data_vz0] = normal_words[1]
for index = 0, 2 do
	data[gte.data_rgb] = materials[index]
	if index == 0 then
		*command = (gte.opcode_ncs
			| gte.command_sf_shift_12 | gte.command_lm_positive)
	else
		*command = (gte.opcode_nccs
			| gte.command_sf_shift_12 | gte.command_lm_positive)
	end
	local rgb<const> = data[gte.data_rgb2]
	result.material_rgb2[index] = rgb
	result.material_flags[index] = control[gte.control_flag]
	*gp0 = 0x60000000 | (rgb & 0x00ffffff)
	*gp0 = material_x[index] | (48 << 16)
	*gp0 = 56 | (96 << 16)
end
result.material_ir0 = data[gte.data_ir0]

-- Drawing offset affects rectangles, not C0 transfer coordinates.
for index = 0, 2 do
	*gp0 = 0xc0000000
	*gp0 = (material_x[index] + 28) | (352 << 16)
	*gp0 = 0x00010001
	while (*gp1 & 0x08000000) == 0 do
	end
	result.material_words[index] = *gp0
end
for index = 0, 3 do
	*gp0 = 0xc0000000
	*gp0 = (swatch_x[index] + 22) | (96 << 16)
	*gp0 = 0x00010001
	while (*gp1 & 0x08000000) == 0 do
	end
	result.preserved_depth_words[index] = *gp0
end
while (*gp1 & 0x04000000) == 0 do
end

-- Only change the framebuffer after the second image is complete.
*framebuffer = 0x000fa040
*irq_ack = 0x00000004
local material_before<const> = result.vblank_sequence
result.material_before_vblank = material_before
*irq_mask = 0x00000004
while result.vblank_sequence == material_before do
	halt_until_irq
end
result.material_after_vblank = result.vblank_sequence
result.completed = 2
while true do
	halt_until_irq
end
