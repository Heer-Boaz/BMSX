module<entry>

local gte<const> = require('cartlib/gx/gte')
local state<const> = require('results')
local system_vram_region<const> = require('gpu/system_vram_region')
local result<const>: *gte_clip_result = state.result
local data<const>: *word[32] = gte.data
local control<const>: *word[32] = gte.control
local command<const>: *word = gte.command
local cycles<const>: *word = gte.cycles
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

-- These positions are already in view space.
rodata transform: gte_transform = {
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
rodata quad_indices: u8[6] = { 0, 1, 2, 0, 2, 3 }
rodata probe_xy: word[2] = { 128 | (64 << 16), 128 | (112 << 16) }
local near_z<const> = 256

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
local transform_words<const>: *word = transform
for index = 0, sizeof(gte_transform) // 4 - 1 do
	control[gte.control_r11r12 + index] = transform_words[index]
end
local projection_words<const>: *word = projection
for index = 0, sizeof(gte_projection) // 4 - 1 do
	control[gte.control_ofx + index] = projection_words[index]
end
-- Seed only the old depth that will become SZ0 after the first RTPT.
data[gte.data_sz3] = 0
*gp0 = 0xe1000400
*gp0 = 0xe2000000
*gp0 = 0xe6000001

-- Compute in numeric locals; i16 storage reads are raw unsigned halves.
local ax<const> = 0
local ay<const> = -32
local az<const> = 128
local by<const> = 64
local bz<const> = 512
result.original[0].x = ax
result.original[0].y = ay
result.original[0].z = az
result.original[0].pad = 0
-- One known outside vertex, two inside: construct D,B,C,E in BSS.
for edge = 1, 2 do
	local bx = 96
	local slot = 0
	if edge == 2 then
		bx = -96
		slot = 3
	end
	result.original[edge].x = bx
	result.original[edge].y = by
	result.original[edge].z = bz
	result.original[edge].pad = 0
	local cut<const>: *gte_vector = &result.quad[slot]
	local numerator<const> = near_z - az
	local denominator<const> = bz - az
	cut.x = ax + (bx - ax) * numerator // denominator
	cut.y = ay + (by - ay) * numerator // denominator
	cut.z = near_z
	cut.pad = 0
	result.quad[edge].x = bx
	result.quad[edge].y = by
	result.quad[edge].z = bz
	result.quad[edge].pad = 0
end

for stage = 0, 1 do
	local base_y<const> = stage << 8
	*irq_mask = 0
	*gp0 = 0xe3000000 | (base_y << 10)
	*gp0 = 0xe40000ff | ((base_y + 191) << 10)
	*gp0 = 0xe5000000 | (base_y << 11)
	*gp0 = 0x60000000
	*gp0 = 0
	*gp0 = 256 | (192 << 16)

	-- Stage 0 projects ABC; stage 1 projects DBC followed by DCE.
	for face = 0, stage do
		local sample<const> = stage + face
		for vertex = 0, 2 do
			local input: *word = &result.original[vertex]
			if stage == 1 then
				input = &result.quad[quad_indices[face * 3 + vertex]]
			end
			data[vertex * 2] = input[0]
			data[vertex * 2 + 1] = input[1]
		end
		*command = gte.opcode_rtpt | gte.command_sf_shift_12
		result.projection_flags[sample] = control[gte.control_flag]
		result.projection_cycles[sample] = *cycles
		result.ir0[sample] = data[gte.data_ir0]
		for vertex = 0, 2 do
			result.screen[sample][vertex] = data[gte.data_sxy0 + vertex]
		end
		for index = 0, 3 do
			result.depth[sample][index] = data[gte.data_sz0 + index]
		end
		-- NCLIP replaces FLAG; it does not clip or reject anything.
		*command = gte.opcode_nclip
		result.area[sample] = data[gte.data_mac0]
		result.area_flags[sample] = control[gte.control_flag]
		*gp0 = 0x20e0a040
		for vertex = 0, 2 do
			*gp0 = result.screen[sample][vertex]
		end
	end

	-- Absolute C0 positions do not inherit the drawing offset.
	for probe = 0, 1 do
		*gp0 = 0xc0000000
		*gp0 = probe_xy[probe] + (base_y << 16)
		*gp0 = 0x00010001
		while (*gp1 & 0x08000000) == 0 do
		end
		result.probe_words[stage][probe] = *gp0
	end
	while (*gp1 & 0x04000000) == 0 do
	end
	*framebuffer = 0x000fa000 | (stage << 6)
	*pmode = 0x0000ff21
	*irq_ack = 0x00000004
	local before<const> = result.vblank_sequence
	result.before_vblank[stage] = before
	*irq_mask = 0x00000004
	while result.vblank_sequence == before do
		halt_until_irq
	end
	result.after_vblank[stage] = result.vblank_sequence
	result.completed = stage + 1
	if stage == 0 then
		local hold<const> = result.vblank_sequence
		while result.vblank_sequence - hold < 2 do
			halt_until_irq
		end
	end
end
-- Neither displayed surface is ever reused by this finite example.
while true do
	halt_until_irq
end
