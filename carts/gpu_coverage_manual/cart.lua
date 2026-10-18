module<entry>

local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
local pmode<const>: *word = 0x08010354
local framebuffer<const>: *word = 0x0801035c
local source<const>: *word = 0x08010360
local display_extent<const>: *word = 0x08010368
local pcrtc_csr<const>: *word = 0x080103d4

rodata drawing_commands: word[] = {
	-- Black background; the two quads use the same additive material.
	0x02000000, 0, 256 | (192 << 16),
	-- Normal ordering: (0,1,2), then (2,1,3).
	0x2a204060,
	16 | (24 << 16), 112 | (24 << 16),
	16 | (56 << 16), 112 | (56 << 16),
	-- Move only vertex 3 inward. The second triangle overlaps the first.
	0x2a204060,
	144 | (24 << 16), 240 | (24 << 16),
	144 | (56 << 16), 160 | (40 << 16),
}

function irq(flags)
	*irq_ack = flags
end

*irq_mask = 0
*pcrtc_csr = 0x00000200
*pmode = 0
*framebuffer = 0x000fa000
*source = 0
*display_extent = 0x000bf3ff
*gp1 = 0x09000000

-- Additive blending, dither off, both field parities, clear mask controls.
*gp0 = 0xe1000420
*gp0 = 0xe2000000
*gp0 = 0xe3000000
*gp0 = 0xe40000ff | (191 << 10)
*gp0 = 0xe5000000
*gp0 = 0xe6000000
for index = 0, #drawing_commands - 1 do
	*gp0 = drawing_commands[index]
end

-- Draw 24 separate polylines: each segment includes the shared endpoint.
for y = 112, 135 do
	*gp0 = 0x4a204060
	*gp0 = 16 | (y << 16)
	*gp0 = 64 | (y << 16)
	*gp0 = 112 | (y << 16)
	*gp0 = 0x50005000
end

-- Complete the command stream before enabling the display.
*gp0 = 0x1f000000
while (*gp1 & 0x01000000) == 0 do
end
*gp1 = 0x02000000
*irq_ack = 0x00000040
while (*gp1 & 0x04000000) == 0 do
end
*pmode = 0x0000ff21
*irq_ack = 0xffffffff
*irq_mask = 0x00000004
while true do
	halt_until_irq
end
