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
	-- Background, then a uniform 96 x 64 direct-color texture at (640,0).
	0x02181008, 0, 256 | (192 << 16),
	0x02684838, 640, 96 | (64 << 16),
	-- Modulated quad, dither off. All four UVs select the same texel.
	0x2ca0647c,
	16 | (24 << 16), 0,
	112 | (24 << 16), 0x010a << 16,
	16 | (88 << 16), 0,
	112 | (88 << 16), 0,
	-- Same material and dimensions, with draw-mode bit 9 set.
	0xe100070a,
	0x2ca0647c,
	144 | (24 << 16), 0,
	240 | (24 << 16), 0x010a << 16,
	144 | (88 << 16), 0,
	240 | (88 << 16), 0,
	-- Rectangle controls. UV advances across the uniform source patch.
	0xe100050a,
	0x64a0647c, 16 | (112 << 16), 0, 96 | (64 << 16),
	0xe100070a,
	0x64a0647c, 144 | (112 << 16), 0, 96 | (64 << 16),
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

-- Explicit drawing state; allow both field parities and clear mask controls.
*gp0 = 0xe1000400
*gp0 = 0xe2000000
*gp0 = 0xe3000000
*gp0 = 0xe40000ff | (191 << 10)
*gp0 = 0xe5000000
*gp0 = 0xe6000000
for index = 0, #drawing_commands - 1 do
	*gp0 = drawing_commands[index]
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
