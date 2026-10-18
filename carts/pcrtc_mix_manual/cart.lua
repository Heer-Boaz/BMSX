module<entry>

local state<const> = require('results')
local system_vram_region<const> = require('gpu/system_vram_region')
local result<const>: *pcrtc_mix_result = state.result
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
local pmode<const>: *word = 0x08010354
local framebuffer1<const>: *word = 0x0801035c
local source1<const>: *word = 0x08010360
local window1<const>: *word = 0x08010364
local extent1<const>: *word = 0x08010368
local framebuffer2<const>: *word = 0x0801036c
local source2<const>: *word = 0x08010370
local window2<const>: *word = 0x08010374
local extent2<const>: *word = 0x08010378
local background<const>: *word = 0x0801037c
local pcrtc_csr<const>: *word = 0x080103d4

-- A: constant; B: source alpha; C: background; D: circuit-2 output alpha.
rodata modes: word[4] = { 0x00008023, 0x00008003, 0x00008083, 0x00008043 }
rodata probes: word[3] = {
	64 | (96 << 16), 192 | (96 << 16), 64 | (352 << 16),
}

function irq(flags)
	if (flags & 0x00000004) ~= 0 then
		result.vblank_sequence = result.vblank_sequence + 1
	end
	*irq_ack = flags & 0x00000004
end

-- Own both reading circuits, GPU ports, handler and both 256x192 sources.
result.system_origin, result.system_size = system_vram_region()
*irq_mask = 0
*pcrtc_csr = 0x00000200
*pmode = 0
*framebuffer1 = 0x000fa000
*source1 = 0
*window1 = 0x018252a8
*extent1 = 0x000bf3ff
*framebuffer2 = 0x000fa040
*source2 = 0
*window2 = 0x018252a8
*extent2 = 0x000bf3ff
*background = 0x0000ff00
*gp1 = 0x09000000
*gp0 = 0xe1000400
*gp0 = 0xe2000000
*gp0 = 0xe3000000
*gp0 = 0xe40000ff | (191 << 10)
*gp0 = 0xe5000000

-- Circuit 1 is red throughout, but its two halves have different stored bit15.
*gp0 = 0xe6000000
*gp0 = 0x600000ff
*gp0 = 0
*gp0 = 128 | (192 << 16)
*gp0 = 0xe6000001
*gp0 = 0x600000ff
*gp0 = 128
*gp0 = 128 | (192 << 16)

-- Circuit 2 is opaque blue at raw rows256..447, not a display source-Y shift.
*gp0 = 0xe3000000 | (256 << 10)
*gp0 = 0xe40000ff | (447 << 10)
*gp0 = 0xe5000000 | (256 << 11)
*gp0 = 0x60ff0000
*gp0 = 0
*gp0 = 256 | (192 << 16)

-- C0 takes absolute raw positions, independent of E5.
for index = 0, 2 do
	*gp0 = 0xc0000000
	*gp0 = probes[index]
	*gp0 = 0x00010001
	while (*gp1 & 0x08000000) == 0 do
	end
	result.source_words[index] = *gp0
end
while (*gp1 & 0x04000000) == 0 do
end

-- Source pixels and both source/window settings remain unchanged from here.
for phase = 0, 3 do
	*irq_mask = 0
	*pmode = modes[phase]
	result.programmed_pmode[phase] = *pmode
	*irq_ack = 0x00000004
	local before<const> = result.vblank_sequence
	result.before_vblank[phase] = before
	*irq_mask = 0x00000004
	while result.vblank_sequence == before do
		halt_until_irq
	end
	result.after_vblank[phase] = result.vblank_sequence
	result.completed_phase = phase + 1
	if phase < 3 then
		local hold<const> = result.vblank_sequence
		while result.vblank_sequence - hold < 2 do
			halt_until_irq
		end
	end
end
while true do
	halt_until_irq
end
