module<entry>

local state<const> = require('results')
local system_vram_region<const> = require('gpu/system_vram_region')
local result<const>: *display_manual_result = state.result
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
local pmode<const>: *word = 0x08010354
local framebuffer<const>: *word = 0x0801035c
local source<const>: *word = 0x08010360
local display_origin<const>: *word = 0x08010364
local display_extent<const>: *word = 0x08010368
local pcrtc_csr<const>: *word = 0x080103d4

-- A: red at (0,0), white square at display (16,64).
-- B: blue at (0,256), white square at display (208,64).
rodata initial_commands: word[] = {
	0x020000ff, 0, 256 | (192 << 16),
	0x02ffffff, 16 | (64 << 16), 32 | (32 << 16),
	0x02ff0000, 256 << 16, 256 | (192 << 16),
	0x02ffffff, 208 | (320 << 16), 32 | (32 << 16),
}
rodata reused_commands: word[] = {
	0x0200ff00, 0, 256 | (192 << 16),
	0x02ffffff, 112 | (80 << 16), 32 | (32 << 16),
}
rodata probe_positions: word[2] = { 0, 256 << 16 }

function irq(flags)
	if (flags & 0x00000004) ~= 0 then
		result.vblank_sequence = result.vblank_sequence + 1
	end
	*irq_ack = flags & 0x00000004
end

-- This isolated example owns GP0, circuit 1 and the VBlank handler.
-- Its two fixed regions exclude the installed firmware region reported here.
result.system_origin, result.system_size = system_vram_region()
*irq_mask = 0
*pcrtc_csr = 0x00000200
*pmode = 0
*framebuffer = 0x000fa000
*source = 0
*display_origin = 0x01800000
*display_extent = 0x000bf3ff
*gp1 = 0x09000000

for index = 0, #initial_commands - 1 do
	*gp0 = initial_commands[index]
end
for index = 0, #probe_positions - 1 do
	*gp0 = 0xc0000000
	*gp0 = probe_positions[index]
	*gp0 = 0x00010001
	while (*gp1 & 0x08000000) == 0 do
	end
	result.samples[index] = *gp0
end
while (*gp1 & 0x04000000) == 0 do
end

-- Publish A. Discard stale VBlank pending only AFTER the final display write.
*pmode = 0x0000ff21
*irq_ack = 0x00000004
local before_a<const> = result.vblank_sequence
result.before_vblank[0] = before_a
*irq_mask = 0x00000004
while result.vblank_sequence == before_a do
	halt_until_irq
end
result.after_vblank[0] = result.vblank_sequence
result.programmed_framebuffer[0] = *framebuffer
result.completed_phase = 1

local hold_a<const> = result.vblank_sequence
while result.vblank_sequence - hold_a < 2 do
	halt_until_irq
end

-- Switch only FBP; GX16, pitch, offsets and display geometry stay unchanged.
*irq_mask = 0
*framebuffer = 0x000fa040
*irq_ack = 0x00000004
local before_b<const> = result.vblank_sequence
result.before_vblank[1] = before_b
*irq_mask = 0x00000004
while result.vblank_sequence == before_b do
	halt_until_irq
end
result.after_vblank[1] = result.vblank_sequence
result.programmed_framebuffer[1] = *framebuffer

-- B is selected. Rebuild only A, then read both regions through ordered C0.
for index = 0, #reused_commands - 1 do
	*gp0 = reused_commands[index]
end
for index = 0, #probe_positions - 1 do
	*gp0 = 0xc0000000
	*gp0 = probe_positions[index]
	*gp0 = 0x00010001
	while (*gp1 & 0x08000000) == 0 do
	end
	result.samples[index + 2] = *gp0
end
while (*gp1 & 0x04000000) == 0 do
end
result.completed_phase = 2

local hold_b<const> = result.vblank_sequence
while result.vblank_sequence - hold_b < 2 do
	halt_until_irq
end

-- Select A again: the same storage now contains green, not its old red image.
*irq_mask = 0
*framebuffer = 0x000fa000
*irq_ack = 0x00000004
local before_reuse<const> = result.vblank_sequence
result.before_vblank[2] = before_reuse
*irq_mask = 0x00000004
while result.vblank_sequence == before_reuse do
	halt_until_irq
end
result.after_vblank[2] = result.vblank_sequence
result.programmed_framebuffer[2] = *framebuffer
result.completed_phase = 3

while true do
	halt_until_irq
end
