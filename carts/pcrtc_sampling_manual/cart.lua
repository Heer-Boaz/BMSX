module<entry>

local state<const> = require('results')
local result<const>: *pcrtc_sampling_result = state.result
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

-- Sixteen adjacent GX16 source pixels: red levels 0..15, stored bit 15 set.
rodata pixels: u16[16] = {
	0x8000, 0x8001, 0x8002, 0x8003, 0x8004, 0x8005, 0x8006, 0x8007,
	0x8008, 0x8009, 0x800a, 0x800b, 0x800c, 0x800d, 0x800e, 0x800f,
}

function irq(flags)
	if (flags & 0x00000004) ~= 0 then
		result.vblank_sequence = result.vblank_sequence + 1
	end
	*irq_ack = flags & 0x00000004
end

-- Own GP0, circuit 1, the VBlank handler and raw row16, X32..47.
*irq_mask = 0
*pcrtc_csr = 0x00000200
*pmode = 0
*framebuffer = 0x000fa000
*source = 0x00008020
*window = 0x010252aa
*extent = 0x0000001f
*gp1 = 0x09000000
*gp0 = 0xe6000000

-- GP0 packs Y at bit16; DISPFB above packs source Y at bit11.
*gp0 = 0xa0000000
*gp0 = 32 | (16 << 16)
*gp0 = 16 | (1 << 16)
local pixel_words<const>: *word = pixels
for index = 0, sizeof(u16[16]) // 4 - 1 do
	*gp0 = pixel_words[index]
end
*gp0 = 0xc0000000
*gp0 = 32 | (16 << 16)
*gp0 = 16 | (1 << 16)
for index = 0, 7 do
	while (*gp1 & 0x08000000) == 0 do
	end
	result.source_words[index] = *gp0
end
while (*gp1 & 0x04000000) == 0 do
end

-- Publish the single circuit: 32 signal units become eight output pixels.
*pmode = 0x0000ff21
*irq_ack = 0x00000004
local before<const> = result.vblank_sequence
result.before_vblank = before
*irq_mask = 0x00000004
while result.vblank_sequence == before do
	halt_until_irq
end
result.after_vblank = result.vblank_sequence
result.programmed_source = *source
result.programmed_window = *window
result.programmed_extent = *extent
result.completed = 1
while true do
	halt_until_irq
end
