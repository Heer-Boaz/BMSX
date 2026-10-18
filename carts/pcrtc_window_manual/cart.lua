module<entry>

local state<const> = require('results')
local system_vram_region<const> = require('gpu/system_vram_region')
local result<const>: *pcrtc_window_result = state.result
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
local pcrtc_csr<const>: *word = 0x080103d4

-- Twelve 64x64 cells, a white L, a black square and a small red square.
-- All packets are opaque, untextured rectangles; E6 forces stored bit 15.
rodata scene: word[] = {
	0x600000ff, 0, 0x00400040,
	0x6000ff00, 64, 0x00400040,
	0x60ff0000, 128, 0x00400040,
	0x6000ffff, 192, 0x00400040,
	0x60ffff00, 64 << 16, 0x00400040,
	0x60ff00ff, 64 | (64 << 16), 0x00400040,
	0x60ffffff, 128 | (64 << 16), 0x00400040,
	0x60202020, 192 | (64 << 16), 0x00400040,
	0x600080ff, 128 << 16, 0x00400040,
	0x60800080, 64 | (128 << 16), 0x00400040,
	0x60808000, 128 | (128 << 16), 0x00400040,
	0x60808080, 192 | (128 << 16), 0x00400040,
	0x60ffffff, 8 | (8 << 16), 4 | (40 << 16),
	0x60ffffff, 8 | (8 << 16), 40 | (4 << 16),
	0x60000000, 96 | (64 << 16), 16 | (16 << 16),
	0x600000ff, 144 | (96 << 16), 8 | (8 << 16),
}
rodata probes: word[3] = { 8 | (8 << 16), 96 | (64 << 16), 144 | (96 << 16) }

function irq(flags)
	if (flags & 0x00000004) ~= 0 then
		result.vblank_sequence = result.vblank_sequence + 1
	end
	*irq_ack = flags & 0x00000004
end

-- Sole ownership of GP0, both reading circuits and raw (0,0)..(255,191).
result.system_origin, result.system_size = system_vram_region()
*irq_mask = 0
*pcrtc_csr = 0x00000200
*pmode = 0
*framebuffer1 = 0x000fa000
*source1 = 0
*window1 = 0x018553a8
*extent1 = 0x0005f1ff
*framebuffer2 = 0x000fa000
*source2 = 0
*window2 = 0x018252a8
*extent2 = 0x000bf3ff
*gp1 = 0x09000000
*gp0 = 0xe1000400
*gp0 = 0xe2000000
*gp0 = 0xe3000000
*gp0 = 0xe40000ff | (191 << 10)
*gp0 = 0xe5000000
*gp0 = 0xe6000001
for index = 0, #scene - 1 do
	*gp0 = scene[index]
end
for index = 0, #probes - 1 do
	*gp0 = 0xc0000000
	*gp0 = probes[index]
	*gp0 = 0x00010001
	while (*gp1 & 0x08000000) == 0 do
	end
	result.samples[index] = *gp0
end
while (*gp1 & 0x04000000) == 0 do
end

-- A: source(0,0), cutout destination(64,48), fixed circuit-2 canvas.
*pmode = 0x0000ff23
*irq_ack = 0x00000004
local before_a<const> = result.vblank_sequence
result.before_vblank[0] = before_a
*irq_mask = 0x00000004
while result.vblank_sequence == before_a do
	halt_until_irq
end
result.after_vblank[0] = result.vblank_sequence
result.programmed_source[0] = *source1
result.programmed_window[0] = *window1
result.completed_phase = 1
local hold_a<const> = result.vblank_sequence
while result.vblank_sequence - hold_a < 2 do
	halt_until_irq
end

-- B: change only the circuit-1 source origin, not pixels or display geometry.
*irq_mask = 0
*source1 = 0x00008020
*irq_ack = 0x00000004
local before_b<const> = result.vblank_sequence
result.before_vblank[1] = before_b
*irq_mask = 0x00000004
while result.vblank_sequence == before_b do
	halt_until_irq
end
result.after_vblank[1] = result.vblank_sequence
result.programmed_source[1] = *source1
result.programmed_window[1] = *window1
result.completed_phase = 2
local hold_b<const> = result.vblank_sequence
while result.vblank_sequence - hold_b < 2 do
	halt_until_irq
end

-- C: keep the new source; move its window 32 output pixels to the right.
*irq_mask = 0
*window1 = 0x01855428
*irq_ack = 0x00000004
local before_c<const> = result.vblank_sequence
result.before_vblank[2] = before_c
*irq_mask = 0x00000004
while result.vblank_sequence == before_c do
	halt_until_irq
end
result.after_vblank[2] = result.vblank_sequence
result.programmed_source[2] = *source1
result.programmed_window[2] = *window1
result.completed_phase = 3
while true do
	halt_until_irq
end
